import {
  Document,
  Page,
  PDFDownloadLink,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"

import type { InvoiceDisplayLine } from "@/components/invoices/invoice-line-types"
import { invoicePreviewTotals } from "@/components/invoices/invoice-line-types"

export type InvoicePdfLine = InvoiceDisplayLine

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
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 40,
    fontSize: 9,
    color: "#111827",
    fontFamily: "Helvetica",
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hairline: { height: 1, backgroundColor: "#111827", flexGrow: 1, marginRight: 16, opacity: 0.35 },
  heading: { letterSpacing: 4, fontSize: 20, fontWeight: 700 },
  cols: { flexDirection: "row", marginTop: 22, gap: 20 },
  col: { flexGrow: 1 },
  label: { fontSize: 7, letterSpacing: 1.1, color: "#111827", opacity: 0.85, marginBottom: 3 },
  text: { fontSize: 9, color: "#111827", opacity: 0.9, lineHeight: 1.35 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  metaKey: { fontSize: 7, letterSpacing: 1.1, opacity: 0.75 },
  metaVal: { fontSize: 9, fontWeight: 600, textAlign: "right" },
  table: { marginTop: 22 },
  thRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    borderBottomStyle: "solid",
    paddingBottom: 4,
    opacity: 0.8,
  },
  th: { fontSize: 6, letterSpacing: 0.6, fontWeight: 700 },
  tr: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    borderBottomStyle: "solid",
    alignItems: "flex-start",
  },
  td: { fontSize: 8 },
  right: { textAlign: "right" },
  totals: { marginTop: 16, flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 200, gap: 4 },
  totRow: { flexDirection: "row", justifyContent: "space-between" },
  totKey: { fontSize: 8, letterSpacing: 0.8, opacity: 0.75 },
  totVal: { fontSize: 9, fontWeight: 700 },
  signature: { marginTop: 22, flexDirection: "row", justifyContent: "flex-end" },
  sigLine: { width: 200, borderBottomWidth: 1, borderBottomColor: "#111827", borderBottomStyle: "solid", opacity: 0.35 },
})

export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const symbol = data.currencySymbol ?? "₹"
  const { subtotalEx, lineTaxSum } = invoicePreviewTotals(data.lines)
  const headerTaxPct = Number.isFinite(data.taxPct ?? NaN) ? (data.taxPct as number) : 0
  const tax =
    lineTaxSum > 0 ? lineTaxSum : headerTaxPct > 0 ? subtotalEx * (headerTaxPct / 100) : 0
  const total = subtotalEx + tax

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

            <View style={{ height: 12 }} />
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
            <View style={{ height: 4 }} />
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>DATE:</Text>
              <Text style={styles.metaVal}>{data.invoiceDate}</Text>
            </View>
            {data.dueDate ? (
              <>
                <View style={{ height: 4 }} />
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
            <Text style={[styles.th, { flex: 2.1, paddingRight: 4 }]}>DESCRIPTION</Text>
            <Text style={[styles.th, { width: 34 }, styles.right]}>QTY</Text>
            <Text style={[styles.th, { width: 40 }]}>UNIT</Text>
            <Text style={[styles.th, { width: 58 }, styles.right]}>UNIT RATE</Text>
            <Text style={[styles.th, { width: 44 }]}>BASIS</Text>
            <Text style={[styles.th, { width: 56 }, styles.right]}>TAXABLE</Text>
            <Text style={[styles.th, { width: 28 }, styles.right]}>TAX%</Text>
            <Text style={[styles.th, { width: 48 }, styles.right]}>TAX</Text>
            <Text style={[styles.th, { width: 54 }, styles.right]}>TOTAL</Text>
          </View>

          {data.lines.map((l, idx) => (
            <View key={`${idx}`} style={styles.tr}>
              <Text style={[styles.td, { flex: 2.1, paddingRight: 4 }]}>{l.description}</Text>
              <Text style={[styles.td, { width: 34 }, styles.right]}>{String(l.qty)}</Text>
              <Text style={[styles.td, { width: 40, fontSize: 7 }]}>{l.unit ?? "—"}</Text>
              <Text style={[styles.td, { width: 58 }, styles.right]}>{money(l.unitPrice, symbol)}</Text>
              <Text style={[styles.td, { width: 44, fontSize: 6 }]}>{l.rateBasis ?? "—"}</Text>
              <Text style={[styles.td, { width: 56 }, styles.right]}>{money(l.taxable, symbol)}</Text>
              <Text style={[styles.td, { width: 28 }, styles.right]}>
                {l.lineTaxPct != null && l.lineTaxPct > 0 ? `${l.lineTaxPct.toFixed(1)}` : "—"}
              </Text>
              <Text style={[styles.td, { width: 48 }, styles.right]}>{money(l.taxAmount ?? 0, symbol)}</Text>
              <Text style={[styles.td, { width: 54 }, styles.right]}>{money(l.totalInclTax, symbol)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsBox}>
            <View style={styles.totRow}>
              <Text style={styles.totKey}>TAXABLE SUBTOTAL</Text>
              <Text style={styles.totVal}>{money(subtotalEx, symbol)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totKey}>TAX</Text>
              <Text style={styles.totVal}>
                {lineTaxSum <= 0 && headerTaxPct > 0 ? `${headerTaxPct.toFixed(2)}% · ` : ""}
                {money(tax, symbol)}
              </Text>
            </View>
            <View style={[styles.totRow, { marginTop: 2 }]}>
              <Text style={[styles.totKey, { fontSize: 9, fontWeight: 700, opacity: 1 }]}>TOTAL (INCL.)</Text>
              <Text style={[styles.totVal, { fontSize: 11 }]}>{money(total, symbol)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.signature}>
          <View style={{ width: 200 }}>
            <View style={styles.sigLine} />
            <Text style={{ marginTop: 6, fontSize: 7, letterSpacing: 1.1, opacity: 0.75, textAlign: "right" }}>
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
