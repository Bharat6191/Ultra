import * as React from "react"
import { Eye, Plus, Trash2, TriangleAlert } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
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
  approved_invoiced_value?: number
}

type PreflightResp = {
  tolerance_pct: number
  lines: BillableLine[]
  work_order_id?: number
  work_order_number?: string
  approved_value_total?: number
  approved_invoiced_ex_tax_total?: number
  committed_invoiced_ex_tax_total?: number
  remaining_invoiceable_value?: number
  remaining_after_passed_ex_tax?: number
}

type DraftLineQty = {
  qty: string
  tax_pct: string
  notes: string
}

type ExtraLineDraft = {
  clientId: string
  description: string
  unit: string
  qty: string
  unitPrice: string
  taxable: string
}

function newExtraLineDraft(): ExtraLineDraft {
  return {
    clientId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    description: "",
    unit: "",
    qty: "",
    unitPrice: "",
    taxable: "",
  }
}

function parseNumInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "")
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function extraLineUsesCalc(row: ExtraLineDraft): boolean {
  const q = parseNumInput(row.qty)
  const p = parseNumInput(row.unitPrice)
  return q != null && q > 0 && p != null && p >= 0
}

function extraLineTaxableExVat(row: ExtraLineDraft): number | null {
  if (extraLineUsesCalc(row)) {
    return q2Money(parseNumInput(row.qty)! * parseNumInput(row.unitPrice)!)
  }
  const t = parseNumInput(row.taxable)
  if (t == null || t <= 0) return null
  return q2Money(t)
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

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

function formatQtyInput(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ""
  const s = n.toLocaleString(undefined, { maximumFractionDigits: 6 })
  return s
}

/** Max invoice qty for this WO line (pieces, or 0–1 lot fraction for % progress). */
function workOrderLineMaxQty(ln: BillableLine): number | null {
  if (ln.progress_type === "percentage") return 1
  const aq = ln.approved_quantity ?? ln.approved_line_qty_basis
  if (aq != null && Number.isFinite(aq) && aq > 0) return aq
  return null
}

/** Default invoice qty from latest WO line completion (capped at WO planned qty). */
function defaultInvoiceQtyFromCompletion(ln: BillableLine): string {
  const max = workOrderLineMaxQty(ln)
  if (ln.progress_type === "percentage") {
    const cp = ln.completed_percentage
    if (cp == null || !Number.isFinite(cp) || cp <= 0) return ""
    const q = cp / 100
    return formatQtyInput(max != null ? Math.min(q, max) : q)
  }
  const cq = ln.completed_quantity
  if (cq == null || !Number.isFinite(cq) || cq <= 0) return ""
  const q = max != null ? Math.min(cq, max) : cq
  return formatQtyInput(q)
}

function clampInvoiceQtyInput(ln: BillableLine, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  const q = Number(trimmed.replace(/,/g, ""))
  if (!Number.isFinite(q)) return raw
  const max = workOrderLineMaxQty(ln)
  if (max == null) return raw
  if (q > max) return formatQtyInput(max)
  if (q < 0) return "0"
  return raw
}

/** Quantity (WO UOM, e.g. pieces) used for commercial math on this screen / submit. */
function billQtyPiecesForLine(ln: BillableLine, inp: DraftLineQty | undefined): number | null {
  const qRaw = inp?.qty?.trim() ?? ""
  if (!qRaw) return null
  const q = Number(qRaw.replace(/,/g, ""))
  if (!Number.isFinite(q) || q <= 0) return null
  const max = workOrderLineMaxQty(ln)
  if (max != null && q > max + 1e-9) return max
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

export function InvoiceCreatePage() {
  const navigate = useNavigate()
  const { id: editIdRaw } = useParams()
  const editInvoiceId =
    editIdRaw != null && Number.isFinite(Number(editIdRaw)) && Number(editIdRaw) > 0 ? Number(editIdRaw) : null
  const isEdit = editInvoiceId != null

  const canCreate = hasPermission("invoices.create")
  const canUpdate = hasPermission("invoices.update")
  const canSubmit = hasPermission("invoices.submit")
  const [creating, setCreating] = React.useState(false)
  const [loadingDraft, setLoadingDraft] = React.useState(isEdit)
  const [loadingPreflight, setLoadingPreflight] = React.useState(false)
  const [contractors, setContractors] = React.useState<{ id: number; name: string }[]>([])
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])
  const [selectedWoId, setSelectedWoId] = React.useState<number | "">("")
  const [pendingItemId, setPendingItemId] = React.useState<number | "">("")
  const [selectedLineIds, setSelectedLineIds] = React.useState<Set<number>>(() => new Set())
  const [preflight, setPreflight] = React.useState<PreflightResp | null>(null)

  const [lineInputs, setLineInputs] = React.useState<Record<number, DraftLineQty>>({})
  const [extraLines, setExtraLines] = React.useState<ExtraLineDraft[]>([])

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
      if (selectedWoId !== "") q.set("work_order_ids", String(selectedWoId))
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
  }, [form.contractor_id, form.org_unit_id, selectedWoId])

  React.useEffect(() => {
    if (!form.contractor_id || !form.org_unit_id) return
    const t = setTimeout(() => void loadPreflight(), 280)
    return () => clearTimeout(t)
  }, [form.contractor_id, form.org_unit_id, selectedWoId, loadPreflight])

  const selectedLineIdsKey = React.useMemo(() => [...selectedLineIds].sort((a, b) => a - b).join(","), [selectedLineIds])

  /** Prefill qty from WO completion when a line is selected and qty is still empty. */
  React.useEffect(() => {
    if (!preflight) return
    setLineInputs((prev) => {
      const next = { ...prev }
      let changed = false
      for (const ln of preflight.lines) {
        if (!selectedLineIds.has(ln.work_order_item_id)) continue
        const cur = next[ln.work_order_item_id] ?? { qty: "", tax_pct: "", notes: "" }
        if (cur.qty.trim()) continue
        const def = defaultInvoiceQtyFromCompletion(ln)
        if (!def) continue
        next[ln.work_order_item_id] = { ...cur, qty: def }
        changed = true
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

  React.useEffect(() => {
    if (!isEdit || !preflight || selectedWoId !== "" || selectedLineIds.size === 0) return
    const first = preflight.lines.find((l) => selectedLineIds.has(l.work_order_item_id))
    if (first) setSelectedWoId(first.work_order_id)
  }, [isEdit, preflight, selectedLineIds, selectedWoId])

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
      next[ln.work_order_item_id] = { ...cur, qty: defaultInvoiceQtyFromCompletion(ln) }
      return next
    })
    setPendingItemId("")
  }

  const extraExVatNum = React.useMemo(() => {
    let sum = 0
    for (const row of extraLines) {
      const tx = extraLineTaxableExVat(row)
      if (tx != null && tx > 0) sum += tx
    }
    return q2Money(sum)
  }, [extraLines])

  function totalsPreview() {
    if (!preflight) return { count: 0, exVat: 0, gross: 0 }
    let exVat = 0
    let gross = 0
    let count = 0
    for (const ln of selectedInvoiceLines) {
      const inp = lineInputs[ln.work_order_item_id]
      const q = billQtyPiecesForLine(ln, inp)
      if (q == null || q <= 0) continue
      count += 1
      const base = lineTaxableExVat(ln, q)
      if (base === null) continue
      exVat += base
      gross += base
    }
    exVat = q2Money(exVat + extraExVatNum)
    gross = q2Money(gross + extraExVatNum)
    return { count, exVat, gross }
  }

  const { count: draftLineCount, exVat: draftExVat } = totalsPreview()

  const woPassedRemainingExVat = React.useMemo(() => {
    if (preflight?.approved_value_total == null) return null
    const base =
      preflight.remaining_after_passed_ex_tax ??
      q2Money(Math.max(0, (preflight.approved_value_total ?? 0) - (preflight.approved_invoiced_ex_tax_total ?? 0)))
    return q2Money(base - draftExVat)
  }, [preflight, draftExVat])

  const invoiceOverWoCap = React.useMemo(() => {
    if (preflight?.approved_value_total == null || draftExVat <= 0) return null
    const cap = preflight.approved_value_total ?? 0
    if (cap <= 0) return null
    const priorPassed = preflight.approved_invoiced_ex_tax_total ?? 0
    const invoiceTotal = q2Money(priorPassed + draftExVat)
    if (invoiceTotal <= cap) return null
    return {
      cap,
      priorPassed,
      draftExVat,
      invoiceTotal,
      overBy: q2Money(invoiceTotal - cap),
      workOrderNumber: preflight.work_order_number ?? null,
    }
  }, [preflight, draftExVat])

  const lockedWorkOrderNumber = React.useMemo(() => {
    if (selectedWoId === "") return null
    return workOrdersInScope.find((wo) => wo.id === selectedWoId)?.work_order_number ?? null
  }, [selectedWoId, workOrdersInScope])

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
    for (const ex of extraLines) {
      if (!ex.description.trim()) continue
      const taxable = extraLineTaxableExVat(ex)
      if (taxable == null || taxable <= 0) continue
      const q = parseNumInput(ex.qty)
      const p = parseNumInput(ex.unitPrice)
      out.push({
        description: ex.description.trim(),
        qty: q != null && q > 0 ? q : 1,
        unit: ex.unit.trim() || "—",
        unitPrice: p != null && p >= 0 ? p : taxable,
        taxable,
        taxAmount: 0,
        totalInclTax: taxable,
      })
    }
    return out
  }, [preflight, selectedInvoiceLines, lineInputs, extraLines])

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

  React.useEffect(() => {
    if (!isEdit || editInvoiceId == null) {
      setLoadingDraft(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoadingDraft(true)
      try {
        const inv = await getJson<{
          id: number
          status: string
          contractor_id: number
          org_unit_id: number
          invoice_number: string
          invoice_date: string
          lines: { work_order_item_id: number; quantity: string | number; tax_pct?: number | null; notes?: string | null }[]
          extra_lines?: {
            description: string
            quantity?: string | number | null
            unit?: string | null
            unit_price?: string | number | null
            amount_ex_vat: string | number
          }[]
        }>(`/invoices/${editInvoiceId}`)
        if (cancelled) return
        if (inv.status !== "draft" && inv.status !== "rejected") {
          toast.error("Only draft invoices can be edited")
          navigate(`/dashboard/invoices/${inv.id}`, { replace: true })
          return
        }
        invoiceNumberTouchedRef.current = true
        setForm({
          contractor_id: String(inv.contractor_id),
          org_unit_id: String(inv.org_unit_id),
          invoice_number: inv.invoice_number,
          invoice_date: String(inv.invoice_date).slice(0, 10),
        })
        const lineIds = new Set<number>()
        const inputs: Record<number, DraftLineQty> = {}
        for (const l of inv.lines ?? []) {
          lineIds.add(l.work_order_item_id)
          inputs[l.work_order_item_id] = {
            qty: formatQtyInput(Number(l.quantity)),
            tax_pct: l.tax_pct != null ? String(l.tax_pct) : "",
            notes: l.notes ?? "",
          }
        }
        setSelectedLineIds(lineIds)
        setLineInputs(inputs)
        const extras: ExtraLineDraft[] = (inv.extra_lines ?? []).map((x) => ({
          ...newExtraLineDraft(),
          description: x.description,
          unit: x.unit ?? "",
          qty: x.quantity != null ? String(x.quantity) : "",
          unitPrice: x.unit_price != null ? String(x.unit_price) : "",
          taxable: String(x.amount_ex_vat),
        }))
        setExtraLines(extras)
      } catch (e) {
        if (!cancelled) toast.error(e instanceof ApiError ? e.message : "Failed to load invoice")
      } finally {
        if (!cancelled) setLoadingDraft(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editInvoiceId, isEdit, navigate])

  function buildInvoicePayload():
    | {
        ok: true
        body: {
          contractor_id: number
          org_unit_id: number
          invoice_number: string
          invoice_date: string
          lines: { work_order_item_id: number; quantity: string; tax_pct: number | null; notes?: string | null }[]
          extra_lines: {
            description: string
            quantity?: string
            unit?: string | null
            unit_price?: string
            amount_ex_vat?: string
          }[]
          extra_amount_ex_vat: string
        }
      }
    | { ok: false } {
    if (!form.contractor_id) {
      toast.error("Contractor is required.")
      return { ok: false }
    }
    if (!form.org_unit_id) {
      toast.error("Plant is required.")
      return { ok: false }
    }
    if (!form.invoice_number.trim()) {
      toast.error("Invoice number is required.")
      return { ok: false }
    }
    if (!preflight?.lines?.length) {
      toast.error("No billable work order rows in scope.")
      return { ok: false }
    }

    const lines: { work_order_item_id: number; quantity: string; tax_pct: number | null; notes?: string | null }[] = []
    for (const ln of selectedInvoiceLines) {
      const inp = lineInputs[ln.work_order_item_id]
      const q = billQtyPiecesForLine(ln, inp)
      if (q == null || q <= 0) continue
      const maxQ = workOrderLineMaxQty(ln)
      if (maxQ != null && q > maxQ + 1e-9) {
        toast.error(
          `Quantity for ${ln.part_code ?? "line"} cannot exceed work order quantity (${formatQtyInput(maxQ)}).`,
        )
        return { ok: false }
      }
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
    if (!lines.length) {
      toast.error("Enter a quantity greater than zero on at least one line (from completion or edited).")
      return { ok: false }
    }

    const woIds = new Set(selectedInvoiceLines.map((ln) => ln.work_order_id))
    if (woIds.size !== 1) {
      toast.error("An invoice can only include line items from one work order.")
      return { ok: false }
    }

    const extraPayload: {
      description: string
      quantity?: string
      unit?: string | null
      unit_price?: string
      amount_ex_vat?: string
    }[] = []
    for (const row of extraLines) {
      const desc = row.description.trim()
      if (!desc) continue
      const taxable = extraLineTaxableExVat(row)
      if (taxable == null || taxable <= 0) {
        toast.error(`Extra charge "${desc}" needs quantity × unit price or a taxable amount.`)
        return { ok: false }
      }
      if (extraLineUsesCalc(row)) {
        extraPayload.push({
          description: desc,
          quantity: row.qty.trim(),
          unit: row.unit.trim() || null,
          unit_price: row.unitPrice.trim(),
        })
      } else {
        extraPayload.push({
          description: desc,
          unit: row.unit.trim() || null,
          amount_ex_vat: String(taxable),
        })
      }
    }

    const header = {
      invoice_number: form.invoice_number.trim(),
      invoice_date: form.invoice_date,
      lines,
      extra_lines: extraPayload,
      extra_amount_ex_vat: String(extraExVatNum),
    }
    return {
      ok: true,
      body: {
        contractor_id: Number(form.contractor_id),
        org_unit_id: Number(form.org_unit_id),
        ...header,
      },
    }
  }

  async function persistDraft(): Promise<{ id: number } | null> {
    const built = buildInvoicePayload()
    if (!built.ok) return null
    if (isEdit && editInvoiceId != null) {
      if (!canUpdate) {
        toast.error("You don't have permission to update invoices.")
        return null
      }
      const inv = await patchJson<{ id: number }>(`/invoices/${editInvoiceId}`, {
        invoice_number: built.body.invoice_number,
        invoice_date: built.body.invoice_date,
        lines: built.body.lines,
        extra_lines: built.body.extra_lines,
        extra_amount_ex_vat: built.body.extra_amount_ex_vat,
      })
      return { id: inv.id }
    }
    if (!canCreate) {
      toast.error("You don't have permission to create invoices.")
      return null
    }
    const inv = await postJson<{ id: number }>("/invoices", built.body)
    return { id: inv.id }
  }

  function toastAfterSubmit(inv: { status: string; validation_status?: string | null }) {
    if (inv.validation_status === "pass" || inv.validation_status === "warn") {
      toast.success(`Submitted — validation ${inv.validation_status}`)
    } else if (inv.status === "blocked" || inv.validation_status === "blocked") {
      toast.warning("Submitted but blocked — request approval or adjust amounts")
    } else {
      toast.success("Submitted for validation")
    }
  }

  async function saveDraft() {
    setCreating(true)
    try {
      const saved = await persistDraft()
      if (!saved) return
      toast.success(isEdit ? "Draft saved" : "Invoice saved as draft")
      navigate(`/dashboard/invoices/${saved.id}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    } finally {
      setCreating(false)
    }
  }

  async function submitInvoice() {
    if (!canSubmit) {
      toast.error("You don't have permission to submit invoices.")
      return
    }
    setCreating(true)
    try {
      const saved = await persistDraft()
      if (!saved) return
      const inv = await postJson<{ id: number; status: string; validation_status?: string | null }>(
        `/invoices/${saved.id}/submit`,
        {},
      )
      toastAfterSubmit(inv)
      navigate(`/dashboard/invoices/${inv.id}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit failed")
    } finally {
      setCreating(false)
    }
  }

  if ((!canCreate && !isEdit) || (isEdit && !canUpdate)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Permission denied</AlertTitle>
        <AlertDescription>You don’t have permission to {isEdit ? "edit" : "create"} invoices.</AlertDescription>
      </Alert>
    )
  }

  if (loadingDraft) {
    return <div className="text-sm text-muted-foreground">Loading invoice…</div>
  }

  return (
    <div className="w-full min-w-0 space-y-5 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{isEdit ? "Edit invoice" : "New invoice"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard/invoices">Back</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!previewLines.length) {
                toast.message("Add at least one line with quantity to preview")
                return
              }
              setShowInvoicePreview(true)
            }}
            className="gap-1.5"
          >
            <Eye className="size-4" />
            Preview
          </Button>
          <InvoicePdfDownloadButton
            data={pdfData}
            filename={`${(form.invoice_number || "invoice").replace(/\s+/g, "_")}.pdf`}
            variant="outline"
            size="sm"
            disabled={!previewLines.length}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void saveDraft()}
            disabled={creating || loadingDraft || !preflight}
          >
            {creating ? "Saving…" : "Save draft"}
          </Button>
          {canSubmit ? (
            <Button type="button" size="sm" onClick={() => void submitInvoice()} disabled={creating || loadingDraft || !preflight}>
              {creating ? "Submitting…" : "Submit"}
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label showRequired>Contractor</Label>
              <select
                className={selectClass}
              value={form.contractor_id}
              onChange={(e) => setForm((f) => ({ ...f, contractor_id: e.target.value }))}
            >
                <option value="">Select…</option>
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
                className={selectClass}
                value={form.org_unit_id}
                onChange={(e) => setForm((f) => ({ ...f, org_unit_id: e.target.value }))}
                disabled={!form.contractor_id}
              >
                <option value="">Select…</option>
              {plants.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
              </select>
            </div>
            <div className="grid gap-1.5">
                <Label showRequired>Invoice #</Label>
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
              <Label showRequired>Date</Label>
              <Input type="date" value={form.invoice_date} onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} />
            </div>
          </div>

          {form.contractor_id && form.org_unit_id ? (
            <>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                {!preflight ? (
                  <p className="text-sm text-muted-foreground sm:col-span-3">
                    {loadingPreflight ? "Updating…" : "Loading work orders…"}
                  </p>
                ) : workOrdersInScope.length === 0 ? (
                  <p className="text-sm text-muted-foreground sm:col-span-3">No billable work orders.</p>
                ) : (
                  <>
                    <div className="grid gap-1.5">
                      <Label showRequired>Work order</Label>
                      <select
                        className={selectClass}
                        value={selectedWoId === "" ? "" : String(selectedWoId)}
                        onChange={(e) => {
                          const v = e.target.value ? Number(e.target.value) : ""
                          const nextId = Number.isFinite(v as number) ? (v as number) : ""
                          if (nextId !== selectedWoId && selectedLineIds.size > 0) {
                            setSelectedLineIds(new Set())
                            setPendingItemId("")
                          }
                          setSelectedWoId(nextId)
                          setPendingItemId("")
                        }}
                      >
                        <option value="">Select…</option>
                        {workOrdersInScope.map((wo) => (
                          <option key={wo.id} value={String(wo.id)}>
                            {wo.work_order_number}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Line to add</Label>
                      <select
                        className={selectClass}
                        value={pendingItemId === "" ? "" : String(pendingItemId)}
                        onChange={(e) => {
                          const v = e.target.value ? Number(e.target.value) : ""
                          setPendingItemId(Number.isFinite(v as number) ? (v as number) : "")
                        }}
                        disabled={selectedWoId === ""}
                      >
                        <option value="">{selectedWoId === "" ? "Select work order" : "Select line…"}</option>
                        {selectedWoLines
                          .filter((l) => !selectedLineIds.has(l.work_order_item_id))
                          .map((l) => (
                            <option key={l.work_order_item_id} value={String(l.work_order_item_id)}>
                              {l.part_code ?? l.job_type ?? "—"} · {l.unit_type ?? l.unit ?? "—"}
                            </option>
                          ))}
                      </select>
                    </div>
                    <Button type="button" className="sm:mb-0.5" disabled={pendingItemId === ""} onClick={() => addPendingLine()}>
                      Add line
                    </Button>
                  </>
                )}
              </div>

              {preflight?.work_order_id != null && preflight.approved_value_total != null ? (
                <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">WO amount </span>
                    <span className="font-medium tabular-nums">{money(preflight.approved_value_total ?? 0)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Passed </span>
                    <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                      {money(preflight.approved_invoiced_ex_tax_total ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Remaining </span>
                    <span className="font-semibold tabular-nums">{money(woPassedRemainingExVat ?? 0)}</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={showInvoicePreview} onOpenChange={setShowInvoicePreview}>
        <DialogContent
          className="flex max-h-[min(92vh,960px)] w-[calc(100vw-1.5rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(56rem,calc(100vw-1.5rem))]"
          showCloseButton
        >
          <DialogHeader className="flex shrink-0 flex-row items-center justify-between gap-3 border-b px-5 py-4 pr-12">
            <DialogTitle>Invoice preview</DialogTitle>
            <InvoicePdfDownloadButton
              data={pdfData}
              filename={`${(form.invoice_number || "invoice").replace(/\s+/g, "_")}.pdf`}
              variant="outline"
              size="sm"
              disabled={!previewLines.length}
            />
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-zinc-100/80 p-4 sm:p-6">
            <InvoicePreview data={pdfData} className="shadow-md" />
          </div>
        </DialogContent>
      </Dialog>

      {preflight && preflight.lines.length > 0 ? (
        <>
          {invoiceOverWoCap ? (
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/10 py-2">
              <TriangleAlert className="size-4" />
              <AlertDescription className="col-start-2 text-sm font-medium text-destructive [&]:text-destructive">
                {invoiceOverWoCap.workOrderNumber ? (
                  <span className="font-mono">{invoiceOverWoCap.workOrderNumber}</span>
                ) : null}
                {invoiceOverWoCap.workOrderNumber ? " · " : null}
                <span className="tabular-nums">
                  {money(invoiceOverWoCap.draftExVat)} exceeds WO {money(invoiceOverWoCap.cap)} by{" "}
                  {money(invoiceOverWoCap.overBy)}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}

          <Card className="min-w-0 overflow-hidden border-border/80 shadow-sm">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-5 py-3">
                  <CardTitle className="text-sm font-medium">Line items</CardTitle>
                  {lockedWorkOrderNumber ? (
                    <Badge variant="secondary" className="font-mono font-normal">
                      {lockedWorkOrderNumber}
                    </Badge>
                  ) : null}
                </CardHeader>
                <CardContent className="p-0">
                  {selectedInvoiceLines.length === 0 ? (
                    <p className="px-5 py-12 text-center text-sm text-muted-foreground">Add at least one line above.</p>
                  ) : (
                    <div className="border-t">
                      <div className="w-full overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
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
                              const maxQty = workOrderLineMaxQty(ln)
                              return (
                                <React.Fragment key={ln.work_order_item_id}>
                                  <TableRow>
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
                                        {ln.completed_quantity != null || ln.completed_percentage != null ? (
                                          <span>
                                            {" "}
                                            · Done{" "}
                                            {ln.progress_type === "percentage"
                                              ? `${ln.completed_percentage ?? 0}%`
                                              : formatQtyInput(ln.completed_quantity ?? 0)}
                                          </span>
                                        ) : null}
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
                                      <Input
                                        className="h-8 text-xs tabular-nums text-right"
                                        value={inp.qty}
                                        onChange={(e) =>
                                          setLineInputs((m) => ({
                                            ...m,
                                            [ln.work_order_item_id]: {
                                              ...inp,
                                              qty: clampInvoiceQtyInput(ln, e.target.value),
                                            },
                                          }))
                                        }
                                        placeholder={maxQty != null ? `Max ${formatQtyInput(maxQty)}` : "0"}
                                        title={
                                          maxQty != null
                                            ? `Work order qty max: ${formatQtyInput(maxQty)}`
                                            : undefined
                                        }
                                      />
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
                                        placeholder="Note"
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

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-5 py-3">
              <CardTitle className="text-sm font-medium">Extra charges (optional)</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setExtraLines((rows) => [...rows, newExtraLineDraft()])}
              >
                <Plus className="size-4" />
                Add charge
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {extraLines.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  Freight, rounding, or other charges — use qty × unit price or enter taxable directly.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Description</TableHead>
                        <TableHead className="w-20">Unit</TableHead>
                        <TableHead className="w-24 text-right">Qty</TableHead>
                        <TableHead className="w-28 text-right">Unit price</TableHead>
                        <TableHead className="w-28 text-right">Taxable</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {extraLines.map((row) => {
                        const usesCalc = extraLineUsesCalc(row)
                        const computed = extraLineTaxableExVat(row)
                        return (
                          <TableRow key={row.clientId}>
                            <TableCell>
                              <Input
                                className="h-8 text-xs"
                                value={row.description}
                                onChange={(e) =>
                                  setExtraLines((rows) =>
                                    rows.map((r) =>
                                      r.clientId === row.clientId ? { ...r, description: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="e.g. Freight"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-xs"
                                value={row.unit}
                                onChange={(e) =>
                                  setExtraLines((rows) =>
                                    rows.map((r) => (r.clientId === row.clientId ? { ...r, unit: e.target.value } : r)),
                                  )
                                }
                                placeholder="trip"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-xs tabular-nums text-right"
                                value={row.qty}
                                onChange={(e) => {
                                  const qty = e.target.value
                                  setExtraLines((rows) =>
                                    rows.map((r) => {
                                      if (r.clientId !== row.clientId) return r
                                      const next = { ...r, qty }
                                      const tx = extraLineTaxableExVat(next)
                                      return {
                                        ...next,
                                        taxable: extraLineUsesCalc(next) && tx != null ? String(tx) : r.taxable,
                                      }
                                    }),
                                  )
                                }}
                                placeholder="0"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-xs tabular-nums text-right"
                                value={row.unitPrice}
                                onChange={(e) => {
                                  const unitPrice = e.target.value
                                  setExtraLines((rows) =>
                                    rows.map((r) => {
                                      if (r.clientId !== row.clientId) return r
                                      const next = { ...r, unitPrice }
                                      const tx = extraLineTaxableExVat(next)
                                      return {
                                        ...next,
                                        taxable: extraLineUsesCalc(next) && tx != null ? String(tx) : r.taxable,
                                      }
                                    }),
                                  )
                                }}
                                placeholder="0"
                              />
                            </TableCell>
                            <TableCell>
                              {usesCalc ? (
                                <div className="flex h-8 items-center justify-end text-xs font-medium tabular-nums">
                                  {computed != null ? money(computed) : "—"}
                                </div>
                              ) : (
                                <Input
                                  className="h-8 text-xs tabular-nums text-right"
                                  value={row.taxable}
                                  onChange={(e) =>
                                    setExtraLines((rows) =>
                                      rows.map((r) =>
                                        r.clientId === row.clientId ? { ...r, taxable: e.target.value } : r,
                                      ),
                                    )
                                  }
                                  placeholder="0"
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Remove extra charge"
                                onClick={() => setExtraLines((rows) => rows.filter((r) => r.clientId !== row.clientId))}
                              >
                                <Trash2 className="size-4 text-muted-foreground" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {extraExVatNum > 0 ? (
                <div className="border-t px-5 py-2 text-right text-sm tabular-nums">
                  Extra subtotal (ex. tax): <span className="font-semibold">{money(extraExVatNum)}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="sticky bottom-0 z-10 -mx-1 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                {draftLineCount} WO line{draftLineCount === 1 ? "" : "s"}
                {extraLines.length > 0 ? ` · ${extraLines.length} extra` : ""}
              </p>
              <div className="text-right text-sm tabular-nums">
                <div className="text-muted-foreground">Total ex. tax</div>
                <div className="text-lg font-semibold">{money(draftExVat)}</div>
                {woPassedRemainingExVat != null ? (
                  <div
                    className={
                      "text-xs tabular-nums " +
                      (woPassedRemainingExVat < 0
                        ? "font-medium text-destructive"
                        : "text-muted-foreground")
                    }
                  >
                    WO remaining {money(woPassedRemainingExVat)}
                    {woPassedRemainingExVat < 0 ? " (over cap)" : ""}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-8">Choose contractor and plant to start.</p>
      )}
    </div>
  )
}

export default InvoiceCreatePage

