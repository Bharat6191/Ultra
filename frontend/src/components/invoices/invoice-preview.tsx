export type InvoicePreviewLine = {
  description: string
  unitPrice: number
  qty: number
  total: number
}

export type InvoicePreviewData = {
  invoiceNo: string
  invoiceDate: string
  dueDate?: string
  issuedTo: { name: string; address?: string }
  payTo: { name: string; bank?: string; accountName?: string; accountNoMasked?: string }
  currencySymbol?: string
  taxPct?: number
  lines: InvoicePreviewLine[]
}

function money(n: number, symbol: string) {
  if (!Number.isFinite(n)) return `${symbol}0.00`
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function InvoicePreview({ data }: { data: InvoicePreviewData }) {
  const symbol = data.currencySymbol ?? "₹"
  const subtotal = data.lines.reduce((s, l) => s + (Number.isFinite(l.total) ? l.total : 0), 0)
  const taxPct = Number.isFinite(data.taxPct ?? NaN) ? (data.taxPct as number) : 0
  const tax = subtotal * (taxPct / 100)
  const total = subtotal + tax

  return (
    <div className="rounded-xl border bg-white text-zinc-900 shadow-sm">
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

        <div className="mt-10 overflow-hidden rounded-lg">
          <div className="grid grid-cols-[1fr_140px_80px_140px] border-b border-zinc-900/50 pb-2 text-[11px] font-semibold tracking-wider text-zinc-900/70">
            <div>DESCRIPTION</div>
            <div className="text-right">UNIT PRICE</div>
            <div className="text-right">QTY</div>
            <div className="text-right">TOTAL</div>
          </div>
          <div className="divide-y divide-zinc-200">
            {data.lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_140px_80px_140px] py-2 text-sm">
                <div>{l.description}</div>
                <div className="text-right tabular-nums">{money(l.unitPrice, symbol)}</div>
                <div className="text-right tabular-nums">{l.qty}</div>
                <div className="text-right tabular-nums">{money(l.total, symbol)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <div className="w-[320px] space-y-2 text-sm">
            <div className="flex justify-between">
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900/70">SUBTOTAL</div>
              <div className="tabular-nums font-semibold">{money(subtotal, symbol)}</div>
            </div>
            <div className="flex justify-between">
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900/70">Tax</div>
              <div className="tabular-nums font-semibold">
                {taxPct ? `${taxPct.toFixed(2)}% · ` : ""}
                {money(tax, symbol)}
              </div>
            </div>
            <div className="flex justify-between pt-1">
              <div className="text-[11px] font-semibold tracking-wider text-zinc-900">TOTAL</div>
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

