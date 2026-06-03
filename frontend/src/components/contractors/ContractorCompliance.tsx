import * as React from "react"
import { AlertTriangle, CheckCircle2, FileWarning, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Doc = { document_name: string; document_type: string; expiry_date: string | null }

function daysUntil(dateIso: string): number {
  const d = new Date(dateIso)
  const today = new Date()
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const t1 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((t1 - t0) / (1000 * 60 * 60 * 24))
}

export function ContractorCompliance({ documents, warnDays }: { documents: Doc[]; warnDays: number }) {
  const { missingExpiry, expired, expiringSoon, ok } = React.useMemo(() => {
    const missingExpiry: Doc[] = []
    const expired: (Doc & { days_left: number })[] = []
    const expiringSoon: (Doc & { days_left: number })[] = []
    const ok: (Doc & { days_left: number })[] = []

    for (const d of documents) {
      if (!d.expiry_date) {
        missingExpiry.push(d)
        continue
      }
      const left = daysUntil(d.expiry_date)
      if (left < 0) expired.push({ ...d, days_left: left })
      else if (left <= warnDays) expiringSoon.push({ ...d, days_left: left })
      else ok.push({ ...d, days_left: left })
    }
    return { missingExpiry, expired, expiringSoon, ok }
  }, [documents, warnDays])

  const health = expired.length > 0 ? "high_risk" : expiringSoon.length > 0 ? "attention" : "healthy"
  const healthBadge =
    health === "high_risk" ? (
      <Badge variant="destructive">High risk</Badge>
    ) : health === "attention" ? (
      <Badge variant="secondary">Needs attention</Badge>
    ) : (
      <Badge className="bg-emerald-600 text-white">Healthy</Badge>
    )

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="rounded-2xl shadow-sm lg:col-span-1">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Compliance health</CardTitle>
            {healthBadge}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-emerald-700" aria-hidden />
              Valid
            </div>
            <div className="text-sm font-semibold">{ok.length}</div>
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileWarning className="size-4 text-yellow-700" aria-hidden />
             Expiring Documents
            </div>
            <div className="text-sm font-semibold">{expiringSoon.length}</div>
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="size-4 text-red-700" aria-hidden />
              Expired
            </div>
            <div className="text-sm font-semibold">{expired.length}</div>
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-zinc-700" aria-hidden />
              Missing expiry
            </div>
            <div className="text-sm font-semibold">{missingExpiry.length}</div>
          </div>
          <div className="text-xs text-muted-foreground">
            This view highlights expiry-related compliance risk. Required document catalogs can be added later.
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Issues</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-11">Document</TableHead>
                <TableHead className="h-11">Type</TableHead>
                <TableHead className="h-11">Expiry</TableHead>
                <TableHead className="h-11 w-[160px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missingExpiry.length === 0 && expired.length === 0 && expiringSoon.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    No compliance issues detected.
                  </TableCell>
                </TableRow>
              ) : (
                [
                  ...expired.map((d) => ({
                    ...d,
                    status: <Badge variant="destructive">Expired</Badge>,
                    expiry: d.expiry_date ?? "—",
                  })),
                  ...expiringSoon.map((d) => ({
                    ...d,
                    status: <Badge variant="secondary">Expiring Documents</Badge>,
                    expiry: d.expiry_date ?? "—",
                  })),
                  ...missingExpiry.map((d) => ({
                    ...d,
                    status: <Badge variant="secondary">Missing expiry</Badge>,
                    expiry: "—",
                  })),
                ].map((row, idx) => (
                  <TableRow key={`${row.document_name}-${idx}`} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-medium">{row.document_name}</TableCell>
                    <TableCell className="text-sm">{row.document_type}</TableCell>
                    <TableCell className="text-sm">{(row as any).expiry}</TableCell>
                    <TableCell className="text-sm">{(row as any).status}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

