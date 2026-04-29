import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson, postForm } from "@/lib/api"

export type ContractorDocument = {
  id: number
  contractor_id: number
  document_name: string
  document_type: string
  file_url: string
  issued_date: string | null
  expiry_date: string | null
  created_at: string
}

function daysUntil(dateIso: string): number {
  const d = new Date(dateIso)
  const today = new Date()
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const t1 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((t1 - t0) / (1000 * 60 * 60 * 24))
}

function docStatus(expiryDate: string | null, warnDays: number) {
  if (!expiryDate) return { label: "No expiry", variant: "secondary" as const, hint: "" }
  const left = daysUntil(expiryDate)
  if (left < 0) return { label: "Expired", variant: "destructive" as const, hint: "Expired" }
  if (left <= warnDays) return { label: "Expiring soon", variant: "secondary" as const, hint: `In ${left} days` }
  return { label: "Valid", variant: "default" as const, hint: `In ${left} days` }
}

export function ContractorDocuments({
  contractorId,
  warnDays = 7,
}: {
  contractorId: number
  warnDays?: number
}) {
  const [docs, setDocs] = React.useState<ContractorDocument[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({
    document_name: "",
    document_type: "",
    issued_date: "",
    expiry_date: "",
    file: null as File | null,
  })

  async function load() {
    setLoadError(null)
    try {
      const rows = await getJson<ContractorDocument[]>(`/contractors/${contractorId}/documents`)
      setDocs(rows)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load documents")
      setDocs([])
    }
  }

  React.useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractorId])

  async function upload() {
    setSaving(true)
    setSaveError(null)
    try {
      const fd = new FormData()
      fd.append("document_name", form.document_name)
      fd.append("document_type", form.document_type)
      if (form.issued_date) fd.append("issued_date", form.issued_date)
      if (form.expiry_date) fd.append("expiry_date", form.expiry_date)
      if (!form.file) throw new Error("Please choose a file")
      fd.append("file", form.file)
      await postForm(`/contractors/${contractorId}/documents`, fd)
      setOpen(false)
      setForm({ document_name: "", document_type: "", issued_date: "", expiry_date: "", file: null })
      await load()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to upload document")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Documents</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Upload document
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Upload document</DialogTitle>
                <DialogDescription>Add a contractor document with optional expiry tracking.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">Document name</div>
                  <Input
                    id="cd-name"
                    value={form.document_name}
                    onChange={(e) => setForm((s) => ({ ...s, document_name: e.target.value }))}
                    placeholder="License / Agreement"
                  />
                </div>
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">Type</div>
                  <Input
                    id="cd-type"
                    value={form.document_type}
                    onChange={(e) => setForm((s) => ({ ...s, document_type: e.target.value }))}
                    placeholder="license, agreement…"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <div className="text-xs text-muted-foreground">Issued date</div>
                    <Input
                      id="cd-issued"
                      type="date"
                      value={form.issued_date}
                      onChange={(e) => setForm((s) => ({ ...s, issued_date: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="text-xs text-muted-foreground">Expiry date</div>
                    <Input
                      id="cd-expiry"
                      type="date"
                      value={form.expiry_date}
                      onChange={(e) => setForm((s) => ({ ...s, expiry_date: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">File</div>
                  <Input
                    id="cd-file"
                    type="file"
                    onChange={(e) => setForm((s) => ({ ...s, file: e.target.files?.[0] ?? null }))}
                  />
                </div>
                {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={upload}
                  disabled={saving || !form.document_name.trim() || !form.document_type.trim() || !form.file}
                >
                  {saving ? "Uploading…" : "Upload"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {loadError ? <div className="text-sm text-destructive">{loadError}</div> : null}
      </CardHeader>

      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="h-11">Document name</TableHead>
              <TableHead className="h-11">Type</TableHead>
              <TableHead className="h-11">Issued date</TableHead>
              <TableHead className="h-11">Expiry date</TableHead>
              <TableHead className="h-11 w-[160px]">Status</TableHead>
              <TableHead className="h-11 w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs === null ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : docs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No documents uploaded.
                </TableCell>
              </TableRow>
            ) : (
              docs.map((d) => {
                const st = docStatus(d.expiry_date, warnDays)
                const hint = st.hint ? <span className="ml-2 text-xs text-muted-foreground">{st.hint}</span> : null
                return (
                  <TableRow key={d.id} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-medium">{d.document_name}</TableCell>
                    <TableCell className="text-sm">{d.document_type}</TableCell>
                    <TableCell className="text-sm">{d.issued_date ?? "—"}</TableCell>
                    <TableCell className="text-sm">{d.expiry_date ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      <Badge variant={st.variant}>{st.label}</Badge>
                      {hint}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <a href={d.file_url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

