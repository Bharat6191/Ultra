import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"
import type { InvoiceDisplayLine } from "@/components/invoices/invoice-line-types"
import { InvoicePdfDownloadButton } from "@/components/invoices/invoice-pdf"
import { InvoicePreview } from "@/components/invoices/invoice-preview"

type BillableLine = {
  work_order_id: number
  work_order_number: string
  work_order_item_id: number
  part_code?: string | null
  part_name?: string | null
  unit_type?: string | null
  pricing_method?: string | null
  billing_basis?: string | null
  allow_manual_amount_override?: boolean
  rate_unit_type?: string | null
  rate_basis_label?: string | null
  weight_per_piece?: number | null
  approved_line_taxable_ex_vat: number
  approved_line_qty_basis: number | null
  /** @deprecated legacy API */
  job_type?: string
  unit?: string
  progress_type: string
  approved_quantity: number | null
  completed_quantity: number | null
  completed_percentage: number | null
  previously_invoiced_qty: number
  remaining_invoiceable_qty_hint: number | null
  approved_rate: number
  /** Same commercial cap as approved_line_taxable_ex_vat; echoed from API. */
  planned_contract_value?: number
  permissible_value_with_tolerance: number
  previously_invoiced_value?: number
  remaining_invoiceable_value: number | null
  completion_vs_billing_pct_hint: number | null
  near_tolerance_warning: boolean
}

type PreflightResp = {
  tolerance_pct: number
  lines: BillableLine[]
}

type DraftLineQty = {
  qty: string
  tax_pct: string
  notes: string
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function q2Money(n: number): number {
  const sign = n < 0 ? -1 : 1
  const x = Math.abs(n)
  return sign * (Math.round(x * 100 + 1e-10) / 100)
}

/** Aligns with Part Master / preflight ``billing_basis`` (falls back from ``pricing_method``). */
function effectiveBillingBasis(ln: BillableLine): "WEIGHT" | "PCS" | "MANUAL" {
  const raw = (ln.billing_basis ?? "").toString().trim().toUpperCase()
  if (raw === "WEIGHT" || raw === "PCS" || raw === "MANUAL") return raw
  const pm = (ln.pricing_method ?? "").toLowerCase()
  if (pm === "weight_based") return "WEIGHT"
  return "PCS"
}

/** Quantity (WO UOM, e.g. pieces) used for commercial math on this screen / submit. */
function autoWoDerivedBillQtyPieces(ln: BillableLine): number | null {
  const rem = ln.remaining_invoiceable_qty_hint
  if (rem != null && Number.isFinite(rem) && rem > 0) return rem
  const aq = ln.approved_quantity
  if (aq != null && Number.isFinite(aq) && aq > 0) return aq
  const basis = ln.approved_line_qty_basis
  if (basis != null && Number.isFinite(basis) && basis > 0) return basis
  return null
}

function autoWoDerivedBillQtyString(ln: BillableLine): string {
  const n = autoWoDerivedBillQtyPieces(ln)
  return n != null ? String(n) : ""
}

/** Quantity (WO UOM, e.g. pieces) used for commercial math on this screen / submit. */
function billQtyPiecesForLine(ln: BillableLine, inp: DraftLineQty | undefined): number | null {
  if (effectiveBillingBasis(ln) === "WEIGHT") {
    return autoWoDerivedBillQtyPieces(ln)
  }
  const qRaw = inp?.qty?.trim() ?? ""
  if (!qRaw) return null
  const q = Number(qRaw.replace(/,/g, ""))
  if (!Number.isFinite(q) || q <= 0) return null
  return q
}

/** Ex-tax from WO proration (non-weight or fallback when weight snapshot missing). */
function lineExTax(ln: BillableLine, invoiceQty: number): number | null {
  const basis = ln.approved_line_qty_basis
  const tv = ln.approved_line_taxable_ex_vat
  if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) return null
  if (basis == null || !Number.isFinite(basis) || basis <= 0) return null
  if (!Number.isFinite(tv) || tv < 0) return null
  return q2Money(invoiceQty * (tv / basis))
}

/** Taxable ex-VAT: weight billing uses ``qty × weight_per_unit × rate_per_kg`` (X × qty × rate). */
function lineTaxableExVat(ln: BillableLine, invoiceQty: number): number | null {
  if (effectiveBillingBasis(ln) === "WEIGHT") {
    const x = ln.weight_per_piece
    const rate = ln.approved_rate
    if (x != null && Number.isFinite(x) && x > 0 && Number.isFinite(rate) && rate >= 0) {
      if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) return null
      return q2Money(invoiceQty * x * rate)
    }
  }
  return lineExTax(ln, invoiceQty)
}

/** Approved ex-VAT cap for this work order line (matches backend ``WorkOrderItem.taxable_value``). */
function approvedLineCapExVat(ln: BillableLine): number {
  const v = ln.approved_line_taxable_ex_vat
  if (Number.isFinite(v)) return v
  const p = ln.planned_contract_value
  return Number.isFinite(p ?? NaN) ? (p as number) : 0
}

type LineCommercialGate = "pending" | "pass" | "line_cap" | "wo_cap"

function lineCommercialGate(
  ln: BillableLine,
  lineTaxable: number | null,
  woDraftSum: Map<number, number>,
  woCapSum: Map<number, number>,
  woPriorSum: Map<number, number>,
): LineCommercialGate {
  if (lineTaxable == null || lineTaxable <= 0) return "pending"
  const prev = ln.previously_invoiced_value != null && Number.isFinite(ln.previously_invoiced_value) ? ln.previously_invoiced_value : 0
  const lineCap = approvedLineCapExVat(ln)
  if (lineCap > 0 && q2Money(prev + lineTaxable) > q2Money(lineCap)) return "line_cap"
  const wid = ln.work_order_id
  const cap = woCapSum.get(wid) ?? 0
  const prior = woPriorSum.get(wid) ?? 0
  const draft = woDraftSum.get(wid) ?? 0
  if (cap > 0 && q2Money(prior + draft) > q2Money(cap)) return "wo_cap"
  return "pass"
}

export function InvoiceCreatePage() {
  const navigate = useNavigate()
  const canCreate = hasPermission("invoices.create")
  const canValidate = hasPermission("invoices.validate")

  const [creating, setCreating] = React.useState(false)
  const [loadingPreflight, setLoadingPreflight] = React.useState(false)
  const [contractors, setContractors] = React.useState<{ id: number; name: string }[]>([])
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])
  const [selectedWoId, setSelectedWoId] = React.useState<number | "">("")
  const [pendingItemId, setPendingItemId] = React.useState<number | "">("")
  const [selectedLineIds, setSelectedLineIds] = React.useState<Set<number>>(() => new Set())
  const [preflight, setPreflight] = React.useState<PreflightResp | null>(null)

  const [lineInputs, setLineInputs] = React.useState<Record<number, DraftLineQty>>({})

  const [form, setForm] = React.useState({
    contractor_id: "",
    org_unit_id: "",
    invoice_number: "",
    invoice_date: new Date().toISOString().slice(0, 10),
  })
  const [showInvoicePreview, setShowInvoicePreview] = React.useState(false)
  const invoiceNumberTouchedRef = React.useRef(false)
  const suggestReqId = React.useRef(0)

  React.useEffect(() => {
    if (!canCreate) return
    if (!form.contractor_id || !form.org_unit_id) {
      suggestReqId.current += 1
      setForm((f) => (f.invoice_number ? { ...f, invoice_number: "" } : f))
      return
    }
    invoiceNumberTouchedRef.current = false
    const rid = ++suggestReqId.current
    void (async () => {
      try {
        const q = new URLSearchParams({
          contractor_id: form.contractor_id,
          org_unit_id: form.org_unit_id,
        })
        const { invoice_number } = await getJson<{ invoice_number: string }>(`/invoices/suggested-number?${q}`)
        if (suggestReqId.current !== rid) return
        if (invoiceNumberTouchedRef.current) return
        setForm((f) => ({ ...f, invoice_number }))
      } catch {
        if (suggestReqId.current !== rid) return
        if (!invoiceNumberTouchedRef.current) {
          setForm((f) => (f.invoice_number ? { ...f, invoice_number: "" } : f))
        }
      }
    })()
  }, [form.contractor_id, form.org_unit_id, canCreate])

  React.useEffect(() => {
    if (!canCreate) return
    void (async () => {
      try {
        const [clist, plist] = await Promise.all([
          getJson<{ id: number; name: string }[]>("/contractors/lookup?limit=200&status=active").catch(() => []),
          canListOrgUnitsForAssignments()
            ? getJson<{ id: number; name: string }[]>("/admin/org-units?type=PLANT").catch(() => [])
            : Promise.resolve([]),
        ])
        setContractors(clist)
        setPlants(plist)
      } catch {
        setContractors([])
        setPlants([])
      }
    })()
  }, [canCreate])

  React.useEffect(() => {
    setSelectedWoId("")
    setPendingItemId("")
    setSelectedLineIds(new Set())
    setPreflight(null)
  }, [form.contractor_id, form.org_unit_id])

  const loadPreflight = React.useCallback(async () => {
    if (!form.contractor_id || !form.org_unit_id) {
      setPreflight(null)
      return
    }
    setLoadingPreflight(true)
    try {
      const q = new URLSearchParams({
        contractor_id: form.contractor_id,
        org_unit_id: form.org_unit_id,
      })
      const data = await getJson<PreflightResp>(`/invoices/preflight-billables?${q}`)
      setPreflight(data)
      setLineInputs((prev) => {
        const next = { ...prev }
        for (const ln of data.lines) {
          if (!next[ln.work_order_item_id]) next[ln.work_order_item_id] = { qty: "", tax_pct: "", notes: "" }
        }
        return next
      })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Preflight failed")
      setPreflight(null)
    } finally {
      setLoadingPreflight(false)
    }
  }, [form.contractor_id, form.org_unit_id])

  React.useEffect(() => {
    if (!form.contractor_id || !form.org_unit_id) return
    const t = setTimeout(() => void loadPreflight(), 280)
    return () => clearTimeout(t)
  }, [form.contractor_id, form.org_unit_id, loadPreflight])

  const selectedLineIdsKey = React.useMemo(() => [...selectedLineIds].sort((a, b) => a - b).join(","), [selectedLineIds])

  /** Keep WEIGHT lines’ stored qty in sync with work order (preflight) — no manual invoice qty. */
  React.useEffect(() => {
    if (!preflight) return
    setLineInputs((prev) => {
      const next = { ...prev }
      let changed = false
      for (const ln of preflight.lines) {
        if (effectiveBillingBasis(ln) !== "WEIGHT") continue
        if (!selectedLineIds.has(ln.work_order_item_id)) continue
        const auto = autoWoDerivedBillQtyString(ln)
        const cur = next[ln.work_order_item_id] ?? { qty: "", tax_pct: "", notes: "" }
        if (auto && cur.qty !== auto) {
          next[ln.work_order_item_id] = { ...cur, qty: auto }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [preflight, selectedLineIdsKey])

  const workOrdersInScope = React.useMemo(() => {
    if (!preflight) return []
    const map = new Map<number, { id: number; work_order_number: string }>()
    for (const ln of preflight.lines) {
      map.set(ln.work_order_id, { id: ln.work_order_id, work_order_number: ln.work_order_number })
    }
    return [...map.values()].sort((a, b) => a.work_order_number.localeCompare(b.work_order_number))
  }, [preflight])

  const billableByItemId = React.useMemo(() => {
    const m = new Map<number, BillableLine>()
    for (const ln of preflight?.lines ?? []) m.set(ln.work_order_item_id, ln)
    return m
  }, [preflight])

  const selectedWoLines = React.useMemo(() => {
    if (!preflight || selectedWoId === "") return []
    return preflight.lines.filter((l) => l.work_order_id === selectedWoId)
  }, [preflight, selectedWoId])

  const selectedInvoiceLines = React.useMemo(() => {
    if (!preflight) return []
    const ids = [...selectedLineIds]
    const lines: BillableLine[] = []
    for (const id of ids) {
      const ln = billableByItemId.get(id)
      if (ln) lines.push(ln)
    }
    lines.sort((a, b) => {
      const ak = `${a.work_order_number}${a.part_code ?? a.job_type ?? ""}`
      const bk = `${b.work_order_number}${b.part_code ?? b.job_type ?? ""}`
      return ak.localeCompare(bk)
    })
    return lines
  }, [billableByItemId, preflight, selectedLineIds])

  const woCommercialSums = React.useMemo(() => {
    const woCapSum = new Map<number, number>()
    const woPriorSum = new Map<number, number>()
    if (!preflight) return { woCapSum, woPriorSum }
    for (const l of preflight.lines) {
      const wid = l.work_order_id
      woCapSum.set(wid, q2Money((woCapSum.get(wid) ?? 0) + approvedLineCapExVat(l)))
      const prev =
        l.previously_invoiced_value != null && Number.isFinite(l.previously_invoiced_value) ? l.previously_invoiced_value : 0
      woPriorSum.set(wid, q2Money((woPriorSum.get(wid) ?? 0) + prev))
    }
    return { woCapSum, woPriorSum }
  }, [preflight])

  const woDraftTaxSum = React.useMemo(() => {
    const m = new Map<number, number>()
    for (const ln of selectedInvoiceLines) {
      const inp = lineInputs[ln.work_order_item_id]
      const q = billQtyPiecesForLine(ln, inp)
      const ex = q != null && q > 0 ? lineTaxableExVat(ln, q) : null
      if (ex == null || !Number.isFinite(ex) || ex <= 0) continue
      const wid = ln.work_order_id
      m.set(wid, q2Money((m.get(wid) ?? 0) + ex))
    }
    return m
  }, [selectedInvoiceLines, lineInputs])

  function defaultInvoiceQtyFromCompletion(ln: BillableLine): string {
    if (ln.progress_type === "percentage") {
      const cp = ln.completed_percentage
      if (cp != null && Number.isFinite(cp)) return String(cp / 100)
      return ""
    }
    const cq = ln.completed_quantity
    if (cq != null && Number.isFinite(cq)) return String(cq)
    return ""
  }

  function addPendingLine() {
    if (pendingItemId === "" || !preflight) return
    const ln = billableByItemId.get(pendingItemId)
    if (!ln) return
    setSelectedLineIds((prev) => {
      const n = new Set(prev)
      n.add(ln.work_order_item_id)
      return n
    })
    setLineInputs((m) => {
      const next = { ...m }
      const cur = next[ln.work_order_item_id] ?? { qty: "", tax_pct: "", notes: "" }
      if (effectiveBillingBasis(ln) === "WEIGHT") {
        next[ln.work_order_item_id] = { ...cur, qty: autoWoDerivedBillQtyString(ln) }
      } else if (!cur.qty.trim()) {
        next[ln.work_order_item_id] = { ...cur, qty: defaultInvoiceQtyFromCompletion(ln) }
      } else {
        next[ln.work_order_item_id] = cur
      }
      return next
    })
    setPendingItemId("")
  }

  function totalsPreview() {
    if (!preflight) return { count: 0, gross: 0 }
    let gross = 0
    let count = 0
    for (const ln of selectedInvoiceLines) {
      const inp = lineInputs[ln.work_order_item_id]
      const q = billQtyPiecesForLine(ln, inp)
      if (q == null || q <= 0) continue
      count += 1
      const base = lineTaxableExVat(ln, q)
      if (base === null) continue
      gross += base
    }
    return { count, gross }
  }

  const { count: draftLineCount, gross: draftGross } = totalsPreview()

  const lineDetailColSpan = 11

  const contractorName = React.useMemo(() => {
    const id = Number(form.contractor_id)
    return contractors.find((c) => c.id === id)?.name ?? (form.contractor_id ? `Contractor #${form.contractor_id}` : "—")
  }, [contractors, form.contractor_id])

  const plantName = React.useMemo(() => {
    const id = Number(form.org_unit_id)
    return plants.find((p) => p.id === id)?.name ?? (form.org_unit_id ? `Plant #${form.org_unit_id}` : "—")
  }, [plants, form.org_unit_id])

  const previewLines = React.useMemo(() => {
    if (!preflight) return []
    const out: InvoiceDisplayLine[] = []
    for (const ln of selectedInvoiceLines) {
      const inp = lineInputs[ln.work_order_item_id]
      const qty = billQtyPiecesForLine(ln, inp)
      if (qty == null || qty <= 0) continue
      const ex = lineTaxableExVat(ln, qty)
      if (ex === null) continue
      const unitPrice = ln.approved_rate
      const taxable = ex
      const totalInclTax = taxable
      const bb = effectiveBillingBasis(ln)
      const w = ln.weight_per_piece
      const weightKg =
        bb === "WEIGHT" && w != null && Number.isFinite(w) && w > 0 ? w : null
      out.push({
        description: `${ln.work_order_number} · ${ln.part_code ?? ln.job_type ?? "—"}`,
        qty,
        weightKg,
        unit: ln.unit_type ?? ln.unit ?? "—",
        unitPrice,
        taxable,
        taxAmount: 0,
        totalInclTax,
      })
    }
    return out
  }, [preflight, selectedInvoiceLines, lineInputs])

  const pdfData = React.useMemo(() => {
    const due = new Date(form.invoice_date)
    if (Number.isFinite(due.getTime())) due.setDate(due.getDate() + 30)
    const dueDate = Number.isFinite(due.getTime()) ? due.toISOString().slice(0, 10) : undefined
    return {
      invoiceNo: form.invoice_number.trim() || "—",
      invoiceDate: form.invoice_date || "—",
      dueDate,
      issuedTo: { name: contractorName, address: plantName !== "—" ? plantName : undefined },
      payTo: {
        name: "Ultra Workspace",
        bank: "—",
        accountName: "—",
        accountNoMasked: "—",
      },
      currencySymbol: "₹",
      taxPct: 0,
      lines: previewLines,
    }
  }, [contractorName, form.invoice_date, form.invoice_number, plantName, previewLines])

  async function createInvoice() {
    if (!form.contractor_id) return toast.error("Contractor is required.")
    if (!form.org_unit_id) return toast.error("Plant is required.")
    if (!form.invoice_number.trim()) return toast.error("Invoice number is required.")
    if (!preflight?.lines?.length) return toast.error("No billable work order rows in scope.")

    const lines: { work_order_item_id: number; quantity: string; tax_pct: number | null; notes?: string | null }[] = []
    for (const ln of selectedInvoiceLines) {
      const inp = lineInputs[ln.work_order_item_id]
      const q = billQtyPiecesForLine(ln, inp)
      if (q == null || q <= 0) continue
      const taxRaw = inp?.tax_pct?.trim()
      lines.push({
        work_order_item_id: ln.work_order_item_id,
        quantity: String(q),
        tax_pct:
          taxRaw === undefined || taxRaw === ""
            ? null
            : (() => {
                const tp = Number(taxRaw.replace(",", ""))
                return Number.isFinite(tp) ? tp : null
              })(),
        notes: inp?.notes?.trim() ? inp.notes.trim() : null,
      })
    }
    if (!lines.length)
      return toast.error(
        "No billable quantities: for WEIGHT lines the work order must have remaining billable qty (or approved qty). For PCS lines, enter invoice qty.",
      )

    setCreating(true)
    try {
      const inv = await postJson<any>("/invoices", {
        contractor_id: Number(form.contractor_id),
        org_unit_id: Number(form.org_unit_id),
        invoice_number: form.invoice_number.trim(),
        invoice_date: form.invoice_date,
        lines,
      })

      toast.success("Invoice created (draft)")

      if (canValidate) {
        await postJson(`/invoices/${inv.id}/submit`, {})
        await postJson(`/invoices/${inv.id}/validate`, {})
      }
      navigate(`/dashboard/invoices/${inv.id}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Create failed")
    } finally {
      setCreating(false)
    }
  }

  if (!canCreate) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Permission denied</AlertTitle>
        <AlertDescription>You don’t have permission to create invoices.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">New invoice</h2>
          <p className="text-sm text-muted-foreground">
            Full-screen creation: select contractor + work orders, then enter invoice quantities with real-time preflight.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/dashboard/invoices">Back</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowInvoicePreview((v) => !v)}
            className="gap-1.5"
          >
            {showInvoicePreview ? (
              <>
                <EyeOff className="size-4" />
                Hide preview
              </>
            ) : (
              <>
                <Eye className="size-4" />
                Preview invoice
              </>
            )}
          </Button>
          <Button asChild variant="outline" disabled={!previewLines.length}>
            <InvoicePdfDownloadButton
              data={pdfData}
              filename={`${(form.invoice_number || "invoice").replace(/\s+/g, "_")}.pdf`}
            />
          </Button>
          <Button onClick={() => void createInvoice()} disabled={creating || !preflight}>
            {creating ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Step 1 · Header</CardTitle>
          <CardDescription>Select contractor first, then plant + work orders.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label showRequired>Contractor</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
              value={form.contractor_id}
              onChange={(e) => setForm((f) => ({ ...f, contractor_id: e.target.value }))}
            >
              <option value="">Pick contractor…</option>
              {contractors.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label showRequired>Plant</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
              value={form.org_unit_id}
              onChange={(e) => setForm((f) => ({ ...f, org_unit_id: e.target.value }))}
              disabled={!form.contractor_id}
            >
              <option value="">Pick plant…</option>
              {plants.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label showRequired>Invoice number</Label>
            <Input
              value={form.invoice_number}
              onChange={(e) => {
                invoiceNumberTouchedRef.current = true
                setForm((f) => ({ ...f, invoice_number: e.target.value }))
              }}
              placeholder="INV000001"
            />
          </div>
          <div className="grid gap-1.5">
            <Label showRequired>Invoice date</Label>
            <Input type="date" value={form.invoice_date} onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Step 2 · Work order</CardTitle>
          <CardDescription>
            Select a work order, then add line items. Rates come from the approved work order.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {!form.contractor_id ? (
            <div className="sm:col-span-2 text-xs text-muted-foreground">Select contractor first.</div>
          ) : !form.org_unit_id ? (
            <div className="sm:col-span-2 text-xs text-muted-foreground">Select plant to load billable work orders.</div>
          ) : !preflight ? (
            <div className="sm:col-span-2 text-xs text-muted-foreground">Loading billable work orders…</div>
          ) : workOrdersInScope.length === 0 ? (
            <div className="sm:col-span-2 text-xs text-muted-foreground">No active billables for this contractor in this plant.</div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label showRequired>Work order</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
                  value={selectedWoId === "" ? "" : String(selectedWoId)}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : ""
                    setSelectedWoId(Number.isFinite(v as number) ? (v as number) : "")
                    setPendingItemId("")
                  }}
                >
                  <option value="">Pick work order…</option>
                  {workOrdersInScope.map((wo) => (
                    <option key={wo.id} value={String(wo.id)}>
                      {wo.work_order_number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label showRequired>Line item</Label>
                <div className="flex gap-2">
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
                    value={pendingItemId === "" ? "" : String(pendingItemId)}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : ""
                      setPendingItemId(Number.isFinite(v as number) ? (v as number) : "")
                    }}
                    disabled={selectedWoId === ""}
                  >
                    <option value="">{selectedWoId === "" ? "Pick work order first…" : "Pick line item…"}</option>
                    {selectedWoLines
                      .filter((l) => !selectedLineIds.has(l.work_order_item_id))
                      .map((l) => (
                        <option key={l.work_order_item_id} value={String(l.work_order_item_id)}>
                          {l.part_code ?? l.job_type ?? "—"} · {l.unit_type ?? l.unit ?? "—"}
                        </option>
                      ))}
                  </select>
                  <Button type="button" variant="outline" disabled={pendingItemId === ""} onClick={() => addPendingLine()}>
                    Add
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {loadingPreflight ? <div className="text-xs text-muted-foreground">Refreshing billables…</div> : null}

      {preflight && preflight.lines.length > 0 ? (
        <>
          <div
            className={
              showInvoicePreview
                ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] items-start"
                : "grid gap-4 items-start"
            }
          >
            <div className="min-w-0 space-y-3">
              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Step 3 · Invoice line items</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {selectedInvoiceLines.length === 0 ? (
                    <div className="px-6 py-10 text-sm text-muted-foreground">Pick a work order and add at least one line item.</div>
                  ) : (
                    <div className="border-t">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="w-[128px]">Value check</TableHead>
                              <TableHead className="w-[120px]">Work order</TableHead>
                              <TableHead>Line item</TableHead>
                              <TableHead className="w-[88px] text-right">WT (kg)</TableHead>
                              <TableHead className="w-[56px]">Unit</TableHead>
                              <TableHead className="min-w-[88px] text-right">Unit rate</TableHead>
                              <TableHead className="w-[112px] text-right">Qty (WO)</TableHead>
                              <TableHead className="text-right">Taxable</TableHead>
                              <TableHead className="text-right">Incl. tax</TableHead>
                              <TableHead className="w-[180px]">Note</TableHead>
                              <TableHead className="w-[50px]" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedInvoiceLines.map((ln) => {
                              const bb = effectiveBillingBasis(ln)
                              const isWeight = bb === "WEIGHT"
                              const inp = lineInputs[ln.work_order_item_id] ?? { qty: "", tax_pct: "", notes: "" }
                              const billQ = billQtyPiecesForLine(ln, inp)
                              const baseEx = billQ != null && billQ > 0 ? lineTaxableExVat(ln, billQ) : null
                              const base = baseEx ?? 0
                              const gross = baseEx !== null ? baseEx : base
                              const wpu =
                                ln.weight_per_piece != null && Number.isFinite(ln.weight_per_piece)
                                  ? ln.weight_per_piece
                                  : null
                              const rateLabel =
                                isWeight ? (
                                  <div className="text-right">
                                    <div className="text-xs tabular-nums">{money(ln.approved_rate)}</div>
                                    <div className="text-[10px] text-muted-foreground">per kg</div>
                                  </div>
                                ) : (
                                  <div className="text-right">
                                    <div className="text-xs tabular-nums">{money(ln.approved_rate)}</div>
                                    <div className="text-[10px] text-muted-foreground">per unit</div>
                                  </div>
                                )
                              const gate = lineCommercialGate(
                                ln,
                                baseEx,
                                woDraftTaxSum,
                                woCommercialSums.woCapSum,
                                woCommercialSums.woPriorSum,
                              )
                              return (
                                <React.Fragment key={ln.work_order_item_id}>
                                  <TableRow>
                                    <TableCell className="align-middle">
                                      {gate === "pass" ? (
                                        <Badge variant="success" className="font-normal">
                                          Passed
                                        </Badge>
                                      ) : gate === "line_cap" ? (
                                        <Badge variant="destructive" className="max-w-[118px] whitespace-normal text-left font-normal leading-snug">
                                          Blocked · over line total
                                        </Badge>
                                      ) : gate === "wo_cap" ? (
                                        <Badge variant="destructive" className="max-w-[118px] whitespace-normal text-left font-normal leading-snug">
                                          Blocked · over WO total
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary" className="font-normal">
                                          —
                                        </Badge>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs font-mono">{ln.work_order_number}</TableCell>
                                    <TableCell className="text-xs">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium">{ln.part_code ?? ln.job_type ?? "—"}</span>
                                        <span
                                          className={
                                            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase " +
                                            (isWeight
                                              ? "bg-sky-500/15 text-sky-800 dark:text-sky-200"
                                              : "bg-muted text-muted-foreground")
                                          }
                                        >
                                          {bb}
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-muted-foreground">
                                        {ln.part_name ?? "—"} ·{" "}
                                        <span className="uppercase tracking-wide">{ln.progress_type}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                                      {isWeight && wpu != null ? (
                                        <span className="tabular-nums" title="Weight per WO qty unit (read-only)">
                                          {money(wpu)}
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {ln.unit_type ?? ln.unit ?? "—"}
                                    </TableCell>
                                    <TableCell>{rateLabel}</TableCell>
                                    <TableCell>
                                      {isWeight ? (
                                        <div className="text-right text-xs tabular-nums font-medium text-foreground">
                                          {billQ != null && billQ > 0
                                            ? billQ.toLocaleString(undefined, { maximumFractionDigits: 3 })
                                            : "—"}
                                        </div>
                                      ) : (
                                        <Input
                                          className="h-8 text-xs tabular-nums text-right"
                                          value={inp.qty}
                                          onChange={(e) =>
                                            setLineInputs((m) => ({
                                              ...m,
                                              [ln.work_order_item_id]: { ...inp, qty: e.target.value },
                                            }))
                                          }
                                          placeholder="0"
                                        />
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right text-xs tabular-nums">
                                      {baseEx === null && billQ != null && billQ > 0 ? "—" : money(base)}
                                    </TableCell>
                                    <TableCell className="text-right text-xs tabular-nums">
                                      {baseEx === null && billQ != null && billQ > 0 ? "—" : money(gross)}
                                    </TableCell>
                                    <TableCell>
                                      <Input
                                        className="h-8 text-xs"
                                        value={inp.notes}
                                        onChange={(e) =>
                                          setLineInputs((m) => ({
                                            ...m,
                                            [ln.work_order_item_id]: { ...inp, notes: e.target.value },
                                          }))
                                        }
                                        placeholder="Optional note for approval…"
                                      />
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <button
                                        type="button"
                                        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                        onClick={() => {
                                          setSelectedLineIds((prev) => {
                                            const n = new Set(prev)
                                            n.delete(ln.work_order_item_id)
                                            return n
                                          })
                                          setLineInputs((m) => ({
                                            ...m,
                                            [ln.work_order_item_id]: {
                                              ...(m[ln.work_order_item_id] ?? { qty: "", tax_pct: "", notes: "" }),
                                              qty: "",
                                            },
                                          }))
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </TableCell>
                                  </TableRow>
                                  <TableRow className="border-b bg-muted/20 hover:bg-muted/20">
                                    <TableCell colSpan={lineDetailColSpan} className="border-t border-border/60 py-2.5">
                                      <div className="flex flex-wrap items-baseline justify-end gap-x-8 gap-y-2 text-xs">
                                        <div className="text-right tabular-nums">
                                          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            Total taxable value
                                          </div>
                                          <div className="font-medium text-foreground">
                                            ₹
                                            {baseEx === null && billQ != null && billQ > 0
                                              ? "—"
                                              : baseEx != null
                                                ? money(baseEx)
                                                : "—"}
                                          </div>
                                        </div>
                                        <div className="text-right tabular-nums">
                                          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            Invoice value
                                          </div>
                                          <div className="text-sm font-semibold text-foreground">
                                            ₹
                                            {baseEx === null && billQ != null && billQ > 0 ? "—" : money(gross)}
                                          </div>
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                </React.Fragment>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {showInvoicePreview ? (
              <div className="min-w-0 max-w-full lg:sticky lg:top-16 lg:self-start">
                <div className="overflow-x-auto overscroll-x-contain">
                  <InvoicePreview data={pdfData} />
                </div>
              </div>
            ) : null}
          </div>

          <div className="sticky bottom-0 z-10 rounded-xl border bg-background shadow-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              Lines with qty:&nbsp;<span className="font-semibold">{draftLineCount}</span>
            </div>
            <div className="text-sm tabular-nums">
              Estimated total (incl tax):{" "}
              <span className="font-semibold">
                {draftGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">Pick contractor + plant for billable line suggestions.</div>
      )}
    </div>
  )
}

export default InvoiceCreatePage

