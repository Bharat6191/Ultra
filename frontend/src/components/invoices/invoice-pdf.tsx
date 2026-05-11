import {
  Document,
  Page,
  PDFDownloadLink,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"

export type InvoicePdfLine = {
  description: string
  unitPrice: number
  qty: number
  total: number
}

export type InvoicePdfData = {
  title?: string
  invoiceNo: string
  invoiceDate: string
  dueDate?: string
  issuedTo: {
    name: string
    address?: string
  }
  payTo: {
    name: string
    bank?: string
    accountName?: string
    accountNoMasked?: string
  }
  currencySymbol?: string
  taxPct?: number
  lines: InvoicePdfLine[]
}

function money(n: number, symbol: string) {
  if (!Number.isFinite(n)) return `${symbol}0.00`
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 48,
    fontSize: 10,
    color: "#111827",
    fontFamily: "Helvetica",
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hairline: { height: 1, backgroundColor: "#111827", flexGrow: 1, marginRight: 16, opacity: 0.35 },
  heading: { letterSpacing: 6, fontSize: 24, fontWeight: 700 },
  cols: { flexDirection: "row", marginTop: 26, gap: 24 },
  col: { flexGrow: 1 },
  label: { fontSize: 8, letterSpacing: 1.2, color: "#111827", opacity: 0.85, marginBottom: 4 },
  text: { fontSize: 10, color: "#111827", opacity: 0.9, lineHeight: 1.35 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  metaKey: { fontSize: 8, letterSpacing: 1.2, opacity: 0.75 },
  metaVal: { fontSize: 10, fontWeight: 600, textAlign: "right" },
  table: { marginTop: 28 },
  thRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#111827", borderBottomStyle: "solid", paddingBottom: 6, opacity: 0.75 },
  th: { fontSize: 8, letterSpacing: 1.2, fontWeight: 700 },
  tr: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", borderBottomStyle: "solid" },
  td: { fontSize: 10 },
  right: { textAlign: "right" },
  wDesc: { flexGrow: 1 },
  wUnit: { width: 80 },
  wQty: { width: 50 },
  wTotal: { width: 80 },
  totals: { marginTop: 18, flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 220, gap: 6 },
  totRow: { flexDirection: "row", justifyContent: "space-between" },
  totKey: { fontSize: 9, letterSpacing: 1.1, opacity: 0.75 },
  totVal: { fontSize: 10, fontWeight: 700 },
  signature: { marginTop: 28, flexDirection: "row", justifyContent: "flex-end" },
  sigLine: { width: 220, borderBottomWidth: 1, borderBottomColor: "#111827", borderBottomStyle: "solid", opacity: 0.35 },
})

export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const symbol = data.currencySymbol ?? "₹"
  const subtotal = data.lines.reduce((s, l) => s + (Number.isFinite(l.total) ? l.total : 0), 0)
  const taxPct = Number.isFinite(data.taxPct ?? NaN) ? (data.taxPct as number) : 0
  const tax = subtotal * (taxPct / 100)
  const total = subtotal + tax

  return (
    <Document title={data.title ?? `Invoice ${data.invoiceNo}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.topRow}>
          <View style={styles.hairline} />
          <Text style={styles.heading}>INVOICE</Text>
        </View>

        <View style={styles.cols}>
          <View style={styles.col}>
            <Text style={styles.label}>ISSUED TO:</Text>
            <Text style={styles.text}>{data.issuedTo.name}</Text>
            {data.issuedTo.address ? <Text style={styles.text}>{data.issuedTo.address}</Text> : null}

            <View style={{ height: 14 }} />
            <Text style={styles.label}>PAY TO:</Text>
            <Text style={styles.text}>{data.payTo.name}</Text>
            {data.payTo.bank ? <Text style={styles.text}>{data.payTo.bank}</Text> : null}
            {data.payTo.accountName ? <Text style={styles.text}>Account Name: {data.payTo.accountName}</Text> : null}
            {data.payTo.accountNoMasked ? <Text style={styles.text}>Account No.: {data.payTo.accountNoMasked}</Text> : null}
          </View>

          <View style={styles.col}>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>INVOICE NO:</Text>
              <Text style={styles.metaVal}>{data.invoiceNo}</Text>
            </View>
            <View style={{ height: 6 }} />
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>DATE:</Text>
              <Text style={styles.metaVal}>{data.invoiceDate}</Text>
            </View>
            {data.dueDate ? (
              <>
                <View style={{ height: 6 }} />
                <View style={styles.metaRow}>
                  <Text style={styles.metaKey}>DUE DATE:</Text>
                  <Text style={styles.metaVal}>{data.dueDate}</Text>
                </View>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, styles.wDesc]}>DESCRIPTION</Text>
            <Text style={[styles.th, styles.wUnit, styles.right]}>UNIT PRICE</Text>
            <Text style={[styles.th, styles.wQty, styles.right]}>QTY</Text>
            <Text style={[styles.th, styles.wTotal, styles.right]}>TOTAL</Text>
          </View>

          {data.lines.map((l, idx) => (
            <View key={`${idx}`} style={styles.tr}>
              <Text style={[styles.td, styles.wDesc]}>{l.description}</Text>
              <Text style={[styles.td, styles.wUnit, styles.right]}>{money(l.unitPrice, symbol)}</Text>
              <Text style={[styles.td, styles.wQty, styles.right]}>{String(l.qty)}</Text>
              <Text style={[styles.td, styles.wTotal, styles.right]}>{money(l.total, symbol)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsBox}>
            <View style={styles.totRow}>
              <Text style={styles.totKey}>SUBTOTAL</Text>
              <Text style={styles.totVal}>{money(subtotal, symbol)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totKey}>Tax</Text>
              <Text style={styles.totVal}>
                {taxPct ? `${taxPct.toFixed(2)}% · ` : ""}
                {money(tax, symbol)}
              </Text>
            </View>
            <View style={[styles.totRow, { marginTop: 2 }]}>
              <Text style={[styles.totKey, { fontSize: 10, fontWeight: 700, opacity: 1 }]}>TOTAL</Text>
              <Text style={[styles.totVal, { fontSize: 12 }]}>{money(total, symbol)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.signature}>
          <View style={{ width: 220 }}>
            <View style={styles.sigLine} />
            <Text style={{ marginTop: 8, fontSize: 8, letterSpacing: 1.2, opacity: 0.75, textAlign: "right" }}>
              Authorized Signature
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}

export function InvoicePdfDownloadButton({
  data,
  filename,
  className,
}: {
  data: InvoicePdfData
  filename: string
  className?: string
}) {
  return (
    <PDFDownloadLink document={<InvoicePdfDocument data={data} />} fileName={filename}>
      {({ loading }) => (
        <a className={className} href="#">
          {loading ? "Preparing PDF…" : "Download PDF"}
        </a>
      )}
    </PDFDownloadLink>
  )
}

