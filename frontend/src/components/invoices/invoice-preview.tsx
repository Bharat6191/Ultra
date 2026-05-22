import type { InvoiceDisplayLine } from "@/components/invoices/invoice-line-types"
import { invoicePreviewTotals } from "@/components/invoices/invoice-line-types"
import { cn } from "@/lib/utils"

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

function hasText(v: string | undefined | null): v is string {
  const s = (v ?? "").trim()
  return s.length > 0 && s !== "—"
}

function formatMetaDate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.split("-")
    return `${dd}/${mm}/${yyyy}`
  }
  return value
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-3 border-b border-zinc-200/80 py-2 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="min-w-0 break-words text-right text-[15px] font-semibold leading-snug tabular-nums text-zinc-900">
        {value}
      </span>
    </div>
  )
}

export function InvoicePreview({
  data,
  className,
}: {
  data: InvoicePreviewData
  className?: string
}) {
  const symbol = data.currencySymbol ?? "₹"
  const { subtotalEx, lineTaxSum } = invoicePreviewTotals(data.lines)
  const headerTaxPct = Number.isFinite(data.taxPct ?? NaN) ? (data.taxPct as number) : 0
  const tax =
    lineTaxSum > 0 ? lineTaxSum : headerTaxPct > 0 ? subtotalEx * (headerTaxPct / 100) : 0
  const total = subtotalEx + tax

  return (
    <article
      className={cn(
        "mx-auto w-full min-w-0 rounded-xl border border-zinc-200 bg-white text-zinc-900",
        className,
      )}
    >
      <div className="border-b border-zinc-200 px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-zinc-300" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-[0.35em] text-zinc-900 sm:text-3xl">INVOICE</h1>
          <div className="h-px flex-1 bg-zinc-300" aria-hidden />
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:gap-12">
          <div className="min-w-0 space-y-8">
            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Issued to</h2>
              <p className="mt-2 text-base font-medium text-zinc-900">{data.issuedTo.name}</p>
              {hasText(data.issuedTo.address) ? (
                <p className="mt-1 max-w-md text-sm leading-relaxed text-zinc-600">{data.issuedTo.address}</p>
              ) : null}
            </section>

            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Pay to</h2>
              <p className="mt-2 text-base font-medium text-zinc-900">{data.payTo.name}</p>
              {hasText(data.payTo.bank) ? <p className="mt-1 text-sm text-zinc-600">{data.payTo.bank}</p> : null}
              {hasText(data.payTo.accountName) ? (
                <p className="mt-1 text-sm text-zinc-600">Account name: {data.payTo.accountName}</p>
              ) : null}
              {hasText(data.payTo.accountNoMasked) ? (
                <p className="mt-1 text-sm text-zinc-600">Account no.: {data.payTo.accountNoMasked}</p>
              ) : null}
            </section>
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-2">
            <MetaRow label="Invoice no." value={data.invoiceNo} />
            <MetaRow label="Date" value={formatMetaDate(data.invoiceDate)} />
            {data.dueDate ? <MetaRow label="Due date" value={formatMetaDate(data.dueDate)} /> : null}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto px-4 py-6 sm:px-8">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-zinc-900/40 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
              <th className="pb-3 pr-3 font-semibold">Description</th>
              <th className="w-16 pb-3 pr-2 text-right font-semibold">Qty</th>
              <th className="w-20 pb-3 pr-2 text-right font-semibold">WT (kg)</th>
              <th className="w-14 pb-3 pr-2 font-semibold">Unit</th>
              <th className="w-24 pb-3 pr-2 text-right font-semibold">Unit rate</th>
              <th className="w-24 pb-3 pr-2 text-right font-semibold">Taxable</th>
              <th className="w-24 pb-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {data.lines.map((l, idx) => (
              <tr key={idx} className="text-zinc-800">
                <td className="max-w-[280px] py-3 pr-3 align-top">
                  <span className="break-words font-medium">{l.description}</span>
                </td>
                <td className="py-3 pr-2 text-right tabular-nums align-top">
                  {l.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                </td>
                <td className="py-3 pr-2 text-right tabular-nums text-zinc-600 align-top">
                  {l.weightKg != null && Number.isFinite(l.weightKg)
                    ? l.weightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "—"}
                </td>
                <td className="py-3 pr-2 text-xs text-zinc-600 align-top">{l.unit ?? "—"}</td>
                <td className="py-3 pr-2 text-right tabular-nums align-top">{money(l.unitPrice, symbol)}</td>
                <td className="py-3 pr-2 text-right tabular-nums align-top">{money(l.taxable, symbol)}</td>
                <td className="py-3 text-right tabular-nums font-medium align-top">{money(l.totalInclTax, symbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-zinc-200 px-6 py-6 sm:px-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="hidden w-[220px] sm:block">
            <div className="h-px bg-zinc-300" aria-hidden />
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Authorized signature</p>
          </div>

          <div className="w-full max-w-sm space-y-2 text-sm sm:ml-auto">
            <div className="flex justify-between gap-4">
              <span className="text-zinc-600">Taxable subtotal</span>
              <span className="tabular-nums font-medium">{money(subtotalEx, symbol)}</span>
            </div>
            {tax > 0 ? (
              <div className="flex justify-between gap-4">
                <span className="text-zinc-600">
                  Tax{lineTaxSum <= 0 && headerTaxPct > 0 ? ` (${headerTaxPct.toFixed(2)}%)` : ""}
                </span>
                <span className="tabular-nums font-medium">{money(tax, symbol)}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t border-zinc-200 pt-3">
              <span className="font-semibold text-zinc-900">Total (incl. tax)</span>
              <span className="text-lg tabular-nums font-semibold">{money(total, symbol)}</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
