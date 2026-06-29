import {
  Document,
  Page,
  PDFDownloadLink,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"

import type { VariantProps } from "class-variance-authority"
import { Download } from "lucide-react"

import type { InvoiceDisplayLine } from "@/components/invoices/invoice-line-types"
import { invoicePreviewTotals } from "@/components/invoices/invoice-line-types"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

function hasText(v: string | undefined | null): v is string {
  const s = (v ?? "").trim()
  return s.length > 0 && s !== "—"
}

function formatMetaDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.split("-")
    return `${dd}/${mm}/${yyyy}`
  }
  return value
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 50,
    paddingHorizontal: 28,
    fontSize: 9,
    color: "#111827",
    fontFamily: "Helvetica",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  hairline: { height: 1, backgroundColor: "#D4D4D8", flexGrow: 1 },
  heading: { letterSpacing: 5, fontSize: 23, fontWeight: 700 },
  cols: { flexDirection: "row", marginTop: 24, gap: 20, alignItems: "flex-start" },
  col: { flexGrow: 1, flexBasis: 0 },
  metaCard: {
    width: 200,
    marginLeft: "auto",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E4E4E7",
    borderStyle: "solid",
    borderRadius: 8,
    backgroundColor: "#FAFAFA",
  },
  section: { marginBottom: 18 },
  label: { fontSize: 7, letterSpacing: 1.2, color: "#71717A", marginBottom: 5, textTransform: "uppercase" },
  text: { fontSize: 10, color: "#111827", lineHeight: 1.45 },
  strongText: { fontSize: 10, fontWeight: 700, color: "#111827", lineHeight: 1.45 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 6,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#E4E4E7",
  },
  metaKey: { fontSize: 7, letterSpacing: 1.1, color: "#71717A", textTransform: "uppercase" },
  metaVal: { fontSize: 10, fontWeight: 700, textAlign: "right" },
  table: { marginTop: 18 },
  thRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#111827",
    borderTopStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    borderBottomStyle: "solid",
    paddingVertical: 6,
  },
  th: { fontSize: 6.5, letterSpacing: 0.7, fontWeight: 700, color: "#52525B", textTransform: "uppercase" },
  tr: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    borderBottomStyle: "solid",
    alignItems: "flex-start",
  },
  td: { fontSize: 8.5, lineHeight: 1.35 },
  right: { textAlign: "right" },
  totalsSection: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#E4E4E7",
    borderTopStyle: "solid",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  signatureBox: { width: 180, justifyContent: "flex-end" },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: "#A1A1AA", borderBottomStyle: "solid" },
  signatureLabel: { marginTop: 6, fontSize: 7, letterSpacing: 1.1, color: "#71717A", textTransform: "uppercase" },
  totalsBox: { width: 220, gap: 6, marginLeft: "auto" },
  totRow: { flexDirection: "row", justifyContent: "space-between" },
  totKey: { fontSize: 8, letterSpacing: 0.8, color: "#52525B" },
  totVal: { fontSize: 9, fontWeight: 700 },
  footer: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 18,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#E4E4E7",
    borderTopStyle: "solid",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerText: { fontSize: 7.5, color: "#71717A" },
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
        <View style={styles.titleRow}>
          <View style={styles.hairline} />
          <Text style={styles.heading}>INVOICE</Text>
          <View style={styles.hairline} />
        </View>

        <View style={styles.cols}>
          <View style={styles.col}>
            <View style={styles.section}>
              <Text style={styles.label}>Issued To</Text>
              <Text style={styles.strongText}>{data.issuedTo.name}</Text>
              {hasText(data.issuedTo.address) ? <Text style={styles.text}>{data.issuedTo.address}</Text> : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Pay To</Text>
              <Text style={styles.strongText}>{data.payTo.name}</Text>
              {hasText(data.payTo.bank) ? <Text style={styles.text}>{data.payTo.bank}</Text> : null}
              {hasText(data.payTo.accountName) ? <Text style={styles.text}>Account Name: {data.payTo.accountName}</Text> : null}
              {hasText(data.payTo.accountNoMasked) ? <Text style={styles.text}>Account No.: {data.payTo.accountNoMasked}</Text> : null}
            </View>
          </View>

          <View style={styles.metaCard}>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Invoice No.</Text>
              <Text style={styles.metaVal}>{data.invoiceNo}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Date</Text>
              <Text style={styles.metaVal}>{formatMetaDate(data.invoiceDate)}</Text>
            </View>
            {data.dueDate ? (
              <View style={[styles.metaRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                <Text style={styles.metaKey}>Due Date</Text>
                <Text style={styles.metaVal}>{formatMetaDate(data.dueDate)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 2.8, paddingRight: 6 }]}>Description</Text>
            <Text style={[styles.th, { width: 34 }, styles.right]}>Qty</Text>
            <Text style={[styles.th, { width: 48 }, styles.right]}>WT (KG)</Text>
            <Text style={[styles.th, { width: 34 }]}>Unit</Text>
            <Text style={[styles.th, { width: 58 }, styles.right]}>Unit Rate</Text>
            <Text style={[styles.th, { width: 62 }, styles.right]}>Taxable</Text>
            <Text style={[styles.th, { width: 66 }, styles.right]}>Total</Text>
          </View>

          {data.lines.map((l, idx) => (
            <View key={`${idx}`} style={styles.tr} wrap={false}>
              <Text style={[styles.td, { flex: 2.8, paddingRight: 6 }]}>{l.description}</Text>
              <Text style={[styles.td, { width: 34 }, styles.right]}>
                {l.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
              </Text>
              <Text style={[styles.td, { width: 48 }, styles.right]}>
                {l.weightKg != null && Number.isFinite(l.weightKg)
                  ? l.weightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : "—"}
              </Text>
              <Text style={[styles.td, { width: 34, fontSize: 7.5 }]}>{l.unit ?? "—"}</Text>
              <Text style={[styles.td, { width: 58 }, styles.right]}>{money(l.unitPrice, symbol)}</Text>
              <Text style={[styles.td, { width: 62 }, styles.right]}>{money(l.taxable, symbol)}</Text>
              <Text style={[styles.td, { width: 66 }, styles.right]}>{money(l.totalInclTax, symbol)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsSection} wrap={false}>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Authorized Signature</Text>
          </View>

          <View style={styles.totalsBox}>
            <View style={styles.totRow}>
              <Text style={styles.totKey}>Taxable Subtotal</Text>
              <Text style={styles.totVal}>{money(subtotalEx, symbol)}</Text>
            </View>
            {tax > 0 ? (
              <View style={styles.totRow}>
                <Text style={styles.totKey}>Tax</Text>
                <Text style={styles.totVal}>
                  {lineTaxSum <= 0 && headerTaxPct > 0 ? `${headerTaxPct.toFixed(2)}% · ` : ""}
                  {money(tax, symbol)}
                </Text>
              </View>
            ) : null}
            <View style={[styles.totRow, { marginTop: 2 }]}>
              <Text style={[styles.totKey, { fontSize: 9, fontWeight: 700, color: "#111827" }]}>Total (Incl. Tax)</Text>
              <Text style={[styles.totVal, { fontSize: 11 }]}>{money(total, symbol)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Invoice {data.invoiceNo}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

export function InvoicePdfDownloadButton({
  data,
  filename,
  className,
  variant = "outline",
  size = "default",
  disabled = false,
}: {
  data: InvoicePdfData
  filename: string
  className?: string
  variant?: VariantProps<typeof buttonVariants>["variant"]
  size?: VariantProps<typeof buttonVariants>["size"]
  disabled?: boolean
}) {
  const btnClass = cn(
    buttonVariants({ variant, size }),
    "no-underline",
    disabled && "pointer-events-none opacity-50",
    className,
  )
  const buttonContent = (
    <span className="inline-flex items-center gap-1">
      <span>PDF</span>
      <Download className="size-4" aria-hidden="true" />
    </span>
  )

  if (disabled) {
    return <span className={btnClass}>{buttonContent}</span>
  }

  return (
    <PDFDownloadLink
      document={<InvoicePdfDocument data={data} />}
      fileName={filename}
      className={btnClass}
    >
      {({ loading }) => (loading ? "Preparing PDF..." : buttonContent)}
    </PDFDownloadLink>
  )
}
