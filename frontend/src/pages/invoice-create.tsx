import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  permissible_value_with_tolerance: number
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

/** Ex-tax line total from work order line: ``invoice_qty × (approved_line_taxable_ex_vat / approved_line_qty_basis)``. */
function lineExTax(ln: BillableLine, invoiceQty: number): number | null {
  const basis = ln.approved_line_qty_basis
  const tv = ln.approved_line_taxable_ex_vat
  if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) return null
  if (basis == null || !Number.isFinite(basis) || basis <= 0) return null
  if (!Number.isFinite(tv) || tv < 0) return null
  return q2Money(invoiceQty * (tv / basis))
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
      if (!cur.qty.trim()) {
        const def = defaultInvoiceQtyFromCompletion(ln)
        next[ln.work_order_item_id] = { ...cur, qty: def }
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
      const qRaw = inp?.qty?.trim() ?? ""
      if (!qRaw) continue
      const q = Number(qRaw.replace(",", ""))
      if (!Number.isFinite(q) || q <= 0) continue
      count += 1
      const base = lineExTax(ln, q)
      if (base === null) continue
      const taxRaw = inp?.tax_pct?.trim() ?? ""
      const tp = taxRaw === "" ? 0 : Number(taxRaw.replace(",", ""))
      const tg = tp && Number.isFinite(tp) ? base * (1 + tp / 100) : base
      gross += tg
    }
    return { count, gross }
  }

  const { count: draftLineCount, gross: draftGross } = totalsPreview()

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
      const qRaw = inp?.qty?.trim() ?? ""
      if (!qRaw) continue
      const qty = Number(qRaw.replace(/,/g, ""))
      if (!Number.isFinite(qty) || qty <= 0) continue
      const ex = lineExTax(ln, qty)
      if (ex === null) continue
      const unitPrice = ln.approved_rate
      const taxable = ex
      const taxRaw = inp?.tax_pct?.trim()
      const tp = taxRaw === "" || taxRaw === undefined ? 0 : Number(taxRaw.replace(/,/g, ""))
      const taxPctLine = Number.isFinite(tp) && tp > 0 ? tp : 0
      const taxAmount = taxPctLine > 0 ? taxable * (taxPctLine / 100) : 0
      const totalInclTax = taxable + taxAmount
      out.push({
        description: `${ln.work_order_number} · ${ln.part_code ?? ln.job_type ?? "—"}`,
        qty,
        unit: ln.unit_type ?? ln.unit ?? "—",
        rateBasis: ln.rate_basis_label ?? undefined,
        unitPrice,
        taxable,
        lineTaxPct: taxPctLine > 0 ? taxPctLine : undefined,
        taxAmount,
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
      invoiceNo: form.invoice_number || "—",
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
      const qRaw = inp?.qty?.trim() ?? ""
      if (!qRaw) continue
      const q = Number(qRaw.replace(",", ""))
      if (!Number.isFinite(q) || q <= 0) continue
      const taxRaw = inp?.tax_pct?.trim()
      lines.push({
        work_order_item_id: ln.work_order_item_id,
        quantity: qRaw,
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
    if (!lines.length) return toast.error("Enter quantities for at least one line.")

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
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/dashboard/invoices">Back</Link>
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
            <Label>Contractor</Label>
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
            <Label>Plant</Label>
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
            <Label>Invoice number</Label>
            <Input value={form.invoice_number} onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Invoice date</Label>
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
                <Label>Work order</Label>
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
                <Label>Line item</Label>
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
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] items-start">
            <div className="min-w-0 space-y-3">
              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Step 3 · Invoice line items</CardTitle>
                  <CardDescription>
                    Edit invoice qty and tax %; taxable value is prorated from the work order line&apos;s approved
                    taxable amount (same basis as the execution sheet). Cumulative invoice amounts (ex. tax) per work
                    order cannot exceed the approved work order value.
                  </CardDescription>
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
                            <TableHead className="w-[120px]">Work order</TableHead>
                            <TableHead>Line item</TableHead>
                            <TableHead className="w-[56px]">Unit</TableHead>
                            <TableHead className="w-[88px] text-right">WT / PC</TableHead>
                            <TableHead className="w-[72px] text-right">Rate basis</TableHead>
                            <TableHead className="text-right">Unit rate</TableHead>
                            <TableHead className="w-[100px] text-right">Invoice qty</TableHead>
                            <TableHead className="w-[72px] text-right">Tax %</TableHead>
                            <TableHead className="text-right">Taxable</TableHead>
                            <TableHead className="text-right">Incl. tax</TableHead>
                            <TableHead className="w-[180px]">Note</TableHead>
                            <TableHead className="w-[50px]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedInvoiceLines.map((ln) => {
                            const inp = lineInputs[ln.work_order_item_id] ?? { qty: "", tax_pct: "", notes: "" }
                            const q = Number((inp.qty || "").replace(/,/g, ""))
                            const baseEx =
                              Number.isFinite(q) && q > 0 ? lineExTax(ln, q) : null
                            const base = baseEx ?? 0
                            const tp = inp.tax_pct?.trim() ? Number(inp.tax_pct.replace(/,/g, "")) : 0
                            const taxAmt =
                              baseEx !== null && Number.isFinite(tp) && tp > 0 ? baseEx * (tp / 100) : 0
                            const gross = base + taxAmt
                            const wtPc =
                              ln.weight_per_piece != null && Number.isFinite(ln.weight_per_piece)
                                ? money(ln.weight_per_piece)
                                : "—"
                            return (
                              <TableRow key={ln.work_order_item_id}>
                                <TableCell className="text-xs font-mono">{ln.work_order_number}</TableCell>
                                <TableCell className="text-xs">
                                  <div className="font-medium">{ln.part_code ?? ln.job_type ?? "—"}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {ln.part_name ?? "—"} ·{" "}
                                    <span className="uppercase tracking-wide">{ln.progress_type}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{ln.unit_type ?? ln.unit ?? "—"}</TableCell>
                                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{wtPc}</TableCell>
                                <TableCell className="text-right text-[11px] text-muted-foreground">
                                  {ln.rate_basis_label ?? "—"}
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums">{money(ln.approved_rate)}</TableCell>
                                <TableCell>
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
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-xs tabular-nums text-right"
                                    value={inp.tax_pct}
                                    onChange={(e) =>
                                      setLineInputs((m) => ({
                                        ...m,
                                        [ln.work_order_item_id]: { ...inp, tax_pct: e.target.value },
                                      }))
                                    }
                                    placeholder="—"
                                  />
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums">
                                  {baseEx === null && Number.isFinite(q) && q > 0 ? "—" : money(base)}
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums">
                                  {baseEx === null && Number.isFinite(q) && q > 0 ? "—" : money(gross)}
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

            <div className="min-w-0 max-w-full lg:sticky lg:top-16 lg:self-start">
              <div className="overflow-x-auto overscroll-x-contain">
                <InvoicePreview data={pdfData} />
              </div>
            </div>
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

