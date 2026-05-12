import * as React from "react"
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
import { InvoicePdfDownloadButton } from "@/components/invoices/invoice-pdf"
import { InvoicePreview } from "@/components/invoices/invoice-preview"
import { cn } from "@/lib/utils"

type BillableLine = {
  work_order_id: number
  work_order_number: string
  work_order_item_id: number
  part_code?: string | null
  part_name?: string | null
  unit_type?: string | null
  pricing_method?: string | null
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
      if (!cur.qty.trim() && ln.remaining_invoiceable_qty_hint != null) {
        next[ln.work_order_item_id] = { ...cur, qty: String(ln.remaining_invoiceable_qty_hint) }
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
      const rate = ln.approved_rate
      const base = q * rate
      const taxRaw = inp?.tax_pct?.trim() ?? ""
      const tp = taxRaw === "" ? 0 : Number(taxRaw.replace(",", ""))
      const tg = tp && Number.isFinite(tp) ? base * (1 + tp / 100) : base
      gross += tg
      count += 1
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
    const out: { description: string; unitPrice: number; qty: number; total: number }[] = []
    for (const ln of selectedInvoiceLines) {
      const inp = lineInputs[ln.work_order_item_id]
      const qRaw = inp?.qty?.trim() ?? ""
      if (!qRaw) continue
      const qty = Number(qRaw.replace(/,/g, ""))
      if (!Number.isFinite(qty) || qty <= 0) continue
      const unitPrice = ln.approved_rate
      const total = qty * unitPrice
      out.push({
        description: `${ln.work_order_number} · ${ln.part_code ?? ln.job_type ?? "—"} (${ln.unit_type ?? ln.unit ?? "—"})`,
        unitPrice,
        qty,
        total,
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
            Select a work order, then pick line items below. Rate will auto-populate from the work order setup. Tolerance defaulted to{" "}
            {(preflight?.tolerance_pct ?? 5).toFixed(2)}%.
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
                {selectedWoId !== "" ? (
                  <p className="text-[11px] text-muted-foreground">
                    Tip: when you add a line, invoice qty auto-fills from remaining completion.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {loadingPreflight ? <div className="text-xs text-muted-foreground">Refreshing billables…</div> : null}

      {preflight && preflight.lines.length > 0 ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_520px] items-start">
            <div className="space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Step 3 · Invoice line items</CardTitle>
                  <CardDescription>
                    Only added line items appear here. Qty is validated against completion and previously invoiced quantities.
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
                            <TableHead className="w-[140px]">Work order</TableHead>
                            <TableHead>Line item</TableHead>
                            <TableHead className="text-right">Remaining qty</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                            <TableHead className="w-[110px] text-right">Invoice qty</TableHead>
                            <TableHead className="w-[80px] text-right">Tax %</TableHead>
                            <TableHead className="w-[220px]">Note</TableHead>
                            <TableHead className="text-right">Line value</TableHead>
                            <TableHead className="w-[50px]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedInvoiceLines.map((ln) => {
                            const inp = lineInputs[ln.work_order_item_id] ?? { qty: "", tax_pct: "", notes: "" }
                            const q = Number((inp.qty || "").replace(/,/g, ""))
                            const base = Number.isFinite(q) && q > 0 ? q * ln.approved_rate : 0
                            const tp = inp.tax_pct?.trim() ? Number(inp.tax_pct.replace(/,/g, "")) : 0
                            const gross = Number.isFinite(tp) && tp > 0 ? base * (1 + tp / 100) : base
                            const allowedQty = ln.remaining_invoiceable_qty_hint
                            const allowedValue = ln.remaining_invoiceable_value
                            const qtyOver = allowedQty != null && Number.isFinite(q) && q > allowedQty + 1e-9
                            const valueOver =
                              allowedValue != null && Number.isFinite(base) && base > allowedValue + 0.009
                            return (
                              <TableRow key={ln.work_order_item_id} className={qtyOver || valueOver ? "bg-red-500/5" : undefined}>
                                <TableCell className="text-xs font-mono">{ln.work_order_number}</TableCell>
                                <TableCell className="text-xs">
                                  <div className="font-medium">{ln.part_code ?? ln.job_type ?? "—"}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {ln.part_name ?? "—"} · {ln.unit_type ?? ln.unit ?? "—"} ·{" "}
                                    <span className="uppercase tracking-wide">{ln.progress_type}</span>
                                    {ln.near_tolerance_warning ? (
                                      <Badge variant="warning" className="ml-2 text-[10px] font-normal px-1.5">
                                        Near tolerance
                                      </Badge>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums">
                                  {ln.remaining_invoiceable_qty_hint != null ? ln.remaining_invoiceable_qty_hint : "—"}
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums">{money(ln.approved_rate)}</TableCell>
                                <TableCell>
                                  <Input
                                    className={cn(
                                      "h-8 text-xs tabular-nums text-right",
                                      qtyOver ? "border-red-500 focus-visible:ring-red-500/30" : null,
                                    )}
                                    value={inp.qty}
                                    onChange={(e) =>
                                      setLineInputs((m) => ({
                                        ...m,
                                        [ln.work_order_item_id]: { ...inp, qty: e.target.value },
                                      }))
                                    }
                                    placeholder="0"
                                  />
                                  {qtyOver ? (
                                    <div className="mt-1 text-[11px] text-red-600">
                                      Over completion. Max allowed: {allowedQty}
                                    </div>
                                  ) : null}
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
                                <TableCell className={cn("text-right text-xs tabular-nums", valueOver ? "text-red-600 font-semibold" : null)}>
                                  {money(gross)}
                                  {valueOver ? (
                                    <div className="mt-1 text-[11px] font-normal text-red-600">
                                      Over WO remaining value.
                                    </div>
                                  ) : null}
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

            <div className="lg:sticky lg:top-16">
              <InvoicePreview data={pdfData} />
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

