import type { InvoiceDisplayLine } from "@/components/invoices/invoice-line-types"
import { invoicePreviewTotals } from "@/components/invoices/invoice-line-types"

export type InvoicePreviewLine = InvoiceDisplayLine

export type InvoicePreviewData = {
  invoiceNo: string
  invoiceDate: string
  dueDate?: string
  issuedTo: { name: string; address?: string }
  payTo: { name: string; bank?: string; accountName?: string; accountNoMasked?: string }
  currencySymbol?: string
  /** When line-level tax amounts are zero, optional flat % applied to ex-tax subtotal (legacy preview). */
  taxPct?: number
  lines: InvoicePreviewLine[]
}

function money(n: number, symbol: string) {
  if (!Number.isFinite(n)) return `${symbol}0.00`
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function InvoicePreview({ data }: { data: InvoicePreviewData }) {
  const symbol = data.currencySymbol ?? "₹"
  const { subtotalEx, lineTaxSum } = invoicePreviewTotals(data.lines)
  const headerTaxPct = Number.isFinite(data.taxPct ?? NaN) ? (data.taxPct as number) : 0
  const tax =
    lineTaxSum > 0 ? lineTaxSum : headerTaxPct > 0 ? subtotalEx * (headerTaxPct / 100) : 0
  const total = subtotalEx + tax

  return (
    <div className="box-border w-full min-w-0 max-w-full rounded-xl border bg-white text-zinc-900 shadow-sm">
      <div className="p-8">
        <div className="flex items-center justify-between gap-6">
          <div className="h-px flex-1 bg-zinc-900/40" />
          <div className="text-3xl font-semibold tracking-[0.5em]">INVOICE</div>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div className="space-y-6">
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900/80">ISSUED TO:</div>
              <div className="mt-1 text-sm">{data.issuedTo.name}</div>
              {data.issuedTo.address ? <div className="text-sm text-zinc-700">{data.issuedTo.address}</div> : null}
            </div>

            <div>
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900/80">PAY TO:</div>
              <div className="mt-1 text-sm">{data.payTo.name}</div>
              {data.payTo.bank ? <div className="text-sm text-zinc-700">{data.payTo.bank}</div> : null}
              {data.payTo.accountName ? <div className="text-sm text-zinc-700">Account Name: {data.payTo.accountName}</div> : null}
              {data.payTo.accountNoMasked ? <div className="text-sm text-zinc-700">Account No.: {data.payTo.accountNoMasked}</div> : null}
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-baseline justify-end gap-3">
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900/70">INVOICE NO:</div>
              <div className="min-w-[140px] text-right font-semibold">{data.invoiceNo}</div>
            </div>
            <div className="flex items-baseline justify-end gap-3">
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900/70">DATE:</div>
              <div className="min-w-[140px] text-right">{data.invoiceDate}</div>
            </div>
            {data.dueDate ? (
              <div className="flex items-baseline justify-end gap-3">
                <div className="text-[11px] font-semibold tracking-wider text-zinc-900/70">DUE DATE:</div>
                <div className="min-w-[140px] text-right">{data.dueDate}</div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-10 overflow-x-auto rounded-lg">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[minmax(120px,1.6fr)_40px_72px_52px_80px_80px_88px] gap-1 border-b border-zinc-900/50 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-900/70">
              <div>Description</div>
              <div className="text-right">Qty</div>
              <div className="text-right">WT (kg)</div>
              <div>Unit</div>
              <div className="text-right">Unit rate</div>
              <div className="text-right">Taxable</div>
              <div className="text-right">Total</div>
            </div>
            <div className="divide-y divide-zinc-200">
              {data.lines.map((l, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[minmax(120px,1.6fr)_40px_72px_52px_80px_80px_88px] gap-1 py-2 text-xs"
                >
                  <div className="min-w-0 break-words pr-1">{l.description}</div>
                  <div className="text-right tabular-nums">{l.qty}</div>
                  <div className="text-right tabular-nums text-zinc-700">
                    {l.weightKg != null && Number.isFinite(l.weightKg)
                      ? l.weightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : "—"}
                  </div>
                  <div className="text-[11px] text-zinc-700">{l.unit ?? "—"}</div>
                  <div className="text-right tabular-nums">{money(l.unitPrice, symbol)}</div>
                  <div className="text-right tabular-nums">{money(l.taxable, symbol)}</div>
                  <div className="text-right tabular-nums font-medium">{money(l.totalInclTax, symbol)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <div className="w-[320px] space-y-2 text-sm">
            <div className="flex justify-between">
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900/70">Taxable subtotal</div>
              <div className="tabular-nums font-semibold">{money(subtotalEx, symbol)}</div>
            </div>
            {tax > 0 ? (
              <div className="flex justify-between">
                <div className="text-[11px] font-semibold tracking-wider text-zinc-900/70">Tax</div>
                <div className="tabular-nums font-semibold">
                  {lineTaxSum <= 0 && headerTaxPct > 0 ? `${headerTaxPct.toFixed(2)}% · ` : ""}
                  {money(tax, symbol)}
                </div>
              </div>
            ) : null}
            <div className="flex justify-between pt-1">
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900">Total (incl. tax)</div>
              <div className="tabular-nums text-base font-semibold">{money(total, symbol)}</div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-end">
          <div className="w-[220px] text-right">
            <div className="h-px bg-zinc-900/40" />
            <div className="mt-2 text-[11px] font-semibold tracking-wider text-zinc-900/70">AUTHORIZED SIGNATURE</div>
          </div>
        </div>
      </div>
    </div>
  )
}
