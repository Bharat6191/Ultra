import {
  Document,
  Image,
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
  plantName?: string
  contractorName?: string
  invoiceTypeLabel?: string
  companyLogoSrc?: string
  currencySymbol?: string
  taxPct?: number
  lines: InvoicePdfLine[]
}

function money(n: number, symbol: string) {
  const formatted = Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00"
  const normalizedSymbol = symbol.trim()
  if (!normalizedSymbol || normalizedSymbol === "₹") return formatted
  return `${normalizedSymbol}${formatted}`
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

function resolvePdfLogo(src?: string) {
  if (hasText(src)) return src
  if (typeof window !== "undefined") {
    return new URL("/logo/logo.png", window.location.origin).toString()
  }
  return "/logo/logo.png"
}

const BRAND = "#0E9F6E"
const BRAND_DARK = "#087A57"
const BRAND_SOFT = "#EEF9F3"
const BRAND_BORDER = "#C7EEDB"

const styles = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: 42,
    paddingHorizontal: 28,
    fontSize: 9,
    color: "#111827",
    fontFamily: "Helvetica",
    backgroundColor: "#FFFFFF",
  },
  brandBar: {
    height: 8,
    marginLeft: -28,
    marginRight: -28,
    backgroundColor: BRAND,
  },
  headerRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  logo: {
    width: 172,
    height: 62,
    objectFit: "contain",
  },
  headerInfo: {
    alignItems: "flex-end",
    maxWidth: 220,
  },
  headerEyebrow: {
    fontSize: 8,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: "#6B7280",
    marginBottom: 4,
  },
  headerInvoiceNo: {
    fontSize: 16,
    fontWeight: 700,
    color: BRAND_DARK,
  },
  topGrid: {
    flexDirection: "row",
    marginTop: 18,
    alignItems: "flex-start",
  },
  leftColumn: {
    flexGrow: 1,
    flexBasis: 0,
    paddingRight: 14,
  },
  rightColumn: {
    width: 210,
  },
  infoCard: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BRAND_BORDER,
    borderStyle: "solid",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 7.5,
    letterSpacing: 1.25,
    color: BRAND_DARK,
    marginBottom: 7,
    textTransform: "uppercase",
    fontWeight: 700,
  },
  cardValue: {
    fontSize: 11,
    fontWeight: 700,
    color: "#111827",
    lineHeight: 1.35,
  },
  cardText: {
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.45,
    marginTop: 3,
  },
  summaryCard: {
    borderWidth: 1,
    borderColor: BRAND_BORDER,
    borderStyle: "solid",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  summaryHeader: {
    backgroundColor: BRAND,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  summaryHeaderText: {
    fontSize: 8,
    letterSpacing: 1.35,
    color: "#FFFFFF",
    textTransform: "uppercase",
    fontWeight: 700,
  },
  summaryBody: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 8,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  summaryKey: {
    fontSize: 7.5,
    letterSpacing: 1.1,
    color: "#6B7280",
    textTransform: "uppercase",
  },
  summaryVal: {
    fontSize: 10.5,
    fontWeight: 700,
    textAlign: "right",
    color: "#111827",
  },
  metaStrip: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: BRAND_BORDER,
    borderStyle: "solid",
    borderRadius: 10,
    backgroundColor: BRAND_SOFT,
    flexDirection: "row",
    alignItems: "stretch",
  },
  metaStripItem: {
    flexGrow: 1,
    flexBasis: 0,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  metaDivider: {
    width: 1,
    backgroundColor: BRAND_BORDER,
  },
  metaLabel: {
    fontSize: 7.5,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: BRAND_DARK,
    marginBottom: 5,
    fontWeight: 700,
  },
  metaValue: {
    fontSize: 9.5,
    lineHeight: 1.35,
    color: "#111827",
    fontWeight: 700,
  },
  table: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: BRAND_BORDER,
    borderStyle: "solid",
    borderRadius: 10,
    overflow: "hidden",
  },
  thRow: {
    flexDirection: "row",
    backgroundColor: BRAND,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  th: {
    fontSize: 7,
    letterSpacing: 0.8,
    fontWeight: 700,
    color: "#FFFFFF",
    textTransform: "uppercase",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    borderBottomStyle: "solid",
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF",
  },
  td: {
    fontSize: 8.5,
    lineHeight: 1.4,
    color: "#111827",
  },
  tdMuted: {
    color: "#4B5563",
  },
  right: { textAlign: "right" },
  totalsSection: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  signatureBox: {
    width: 190,
    paddingRight: 16,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#9CA3AF",
    borderBottomStyle: "solid",
    marginTop: 28,
  },
  signatureLabel: {
    marginTop: 8,
    fontSize: 7.5,
    letterSpacing: 1.1,
    color: BRAND_DARK,
    textTransform: "uppercase",
    fontWeight: 700,
  },
  signatureSubtext: {
    marginTop: 3,
    fontSize: 8,
    color: "#4B5563",
  },
  totalsBox: {
    width: 238,
    marginLeft: "auto",
    borderWidth: 1,
    borderColor: BRAND_BORDER,
    borderStyle: "solid",
    borderRadius: 10,
    backgroundColor: BRAND_SOFT,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  totRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  totKey: {
    fontSize: 8.5,
    color: "#374151",
  },
  totVal: {
    fontSize: 9,
    fontWeight: 700,
    color: "#111827",
  },
  totalDivider: {
    height: 1,
    backgroundColor: "#B8E3CE",
    marginTop: 4,
    marginBottom: 10,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  grandTotalLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    color: BRAND_DARK,
  },
  grandTotalValue: {
    fontSize: 13,
    fontWeight: 700,
    color: BRAND,
  },
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
  const plantName = hasText(data.plantName) ? data.plantName : hasText(data.issuedTo.address) ? data.issuedTo.address : "—"
  const contractorName = hasText(data.contractorName) ? data.contractorName : data.issuedTo.name
  const invoiceTypeLabel = hasText(data.invoiceTypeLabel) ? data.invoiceTypeLabel : "Individual Invoice"
  const logoSrc = resolvePdfLogo(data.companyLogoSrc)
  const taxLabel =
    lineTaxSum > 0
      ? "Tax"
      : `Tax (GST ${Number.isFinite(headerTaxPct) ? headerTaxPct.toFixed(headerTaxPct > 0 ? 2 : 0) : "0"}%)`

  return (
    <Document title={data.title ?? `Invoice ${data.invoiceNo}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        <View style={styles.headerRow}>
          <Image src={logoSrc} style={styles.logo} />
          <View style={styles.headerInfo}>
            <Text style={styles.headerEyebrow}>Invoice</Text>
            <Text style={styles.headerInvoiceNo}>{data.invoiceNo}</Text>
          </View>
        </View>

        <View style={styles.topGrid}>
          <View style={styles.leftColumn}>
            <View style={styles.infoCard}>
              <Text style={styles.cardLabel}>Issued To</Text>
              <Text style={styles.cardValue}>{data.issuedTo.name}</Text>
              {hasText(data.issuedTo.address) ? <Text style={styles.cardText}>{data.issuedTo.address}</Text> : null}
            </View>

            <View style={[styles.infoCard, { marginBottom: 0 }]}>
              <Text style={styles.cardLabel}>Pay To</Text>
              <Text style={styles.cardValue}>{data.payTo.name}</Text>
              {hasText(data.payTo.bank) ? <Text style={styles.cardText}>{data.payTo.bank}</Text> : null}
              {hasText(data.payTo.accountName) ? (
                <Text style={styles.cardText}>Account Name: {data.payTo.accountName}</Text>
              ) : null}
              {hasText(data.payTo.accountNoMasked) ? (
                <Text style={styles.cardText}>Account No.: {data.payTo.accountNoMasked}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.rightColumn}>
            <View style={styles.summaryCard}>
              <View style={styles.summaryHeader}>
                <Text style={styles.summaryHeaderText}>Invoice Summary</Text>
              </View>
              <View style={styles.summaryBody}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>Invoice No.</Text>
                  <Text style={styles.summaryVal}>{data.invoiceNo}</Text>
                </View>
                <View
                  style={
                    data.dueDate
                      ? styles.summaryRow
                      : [styles.summaryRow, { borderBottomWidth: 0, paddingBottom: 4 }]
                  }
                >
                  <Text style={styles.summaryKey}>Date</Text>
                  <Text style={styles.summaryVal}>{formatMetaDate(data.invoiceDate)}</Text>
                </View>
                {data.dueDate ? (
                  <View style={[styles.summaryRow, { borderBottomWidth: 0, paddingBottom: 4 }]}>
                    <Text style={styles.summaryKey}>Due Date</Text>
                    <Text style={styles.summaryVal}>{formatMetaDate(data.dueDate)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.metaStrip}>
          <View style={styles.metaStripItem}>
            <Text style={styles.metaLabel}>Plant</Text>
            <Text style={styles.metaValue}>{plantName}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaStripItem}>
            <Text style={styles.metaLabel}>Contractor</Text>
            <Text style={styles.metaValue}>{contractorName}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaStripItem}>
            <Text style={styles.metaLabel}>Invoice Type</Text>
            <Text style={styles.metaValue}>{invoiceTypeLabel}</Text>
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
              <Text style={[styles.td, styles.tdMuted, { width: 48 }, styles.right]}>
                {l.weightKg != null && Number.isFinite(l.weightKg)
                  ? l.weightKg.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
                  : "—"}
              </Text>
              <Text style={[styles.td, styles.tdMuted, { width: 34, fontSize: 7.5 }]}>{l.unit ?? "—"}</Text>
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
            <Text style={styles.signatureSubtext}>For {data.payTo.name}</Text>
          </View>

          <View style={styles.totalsBox}>
            <View style={styles.totRow}>
              <Text style={styles.totKey}>Taxable Subtotal</Text>
              <Text style={styles.totVal}>{money(subtotalEx, symbol)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totKey}>{taxLabel}</Text>
              <Text style={styles.totVal}>{money(tax, symbol)}</Text>
            </View>
            <View style={styles.totalDivider} />
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total (Incl. Tax)</Text>
              <Text style={styles.grandTotalValue}>{money(total, symbol)}</Text>
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
