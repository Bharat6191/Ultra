import * as React from "react"
import { toast } from "sonner"
import { Eye, History, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { API_BASE_URL, deleteJson, patchJson, postForm } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

export type ContractorDocumentVersion = {
  id: number
  version_number: number
  file_path: string
  issue_date: string | null
  expiry_date: string | null
  remarks: string | null
  uploaded_by: number | null
  created_at: string
}

export type ContractorDocument = {
  id: number
  contractor_id: number
  document_name: string
  document_type: string
  file_path: string
  file_url: string | null
  issue_date: string | null
  issued_date: string | null
  expiry_date: string | null
  verification_status: string
  verified_by: number | null
  verified_at: string | null
  remarks: string | null
  current_version: number
  created_at: string
  updated_at: string
  versions?: ContractorDocumentVersion[]
}

function daysUntil(dateIso: string): number {
  const d = new Date(dateIso)
  const today = new Date()
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const t1 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((t1 - t0) / (1000 * 60 * 60 * 24))
}

function expiryHint(expiryDate: string | null, warnDays: number) {
  if (!expiryDate) return { tone: "neutral" as const, hint: "No expiry" }
  const left = daysUntil(expiryDate)
  if (left < 0) return { tone: "danger" as const, hint: `Expired ${Math.abs(left)} days ago` }
  if (left <= warnDays) return { tone: "warning" as const, hint: `Expires in ${left} days` }
  return { tone: "success" as const, hint: `Expires in ${left} days` }
}

function resolveFileUrl(url: string) {
  const trimmed = (url ?? "").trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
  if (trimmed.startsWith("/")) return `${API_BASE_URL}${trimmed}`
  return `${API_BASE_URL}/${trimmed}`
}

const EMPTY_UPLOAD = {
  document_name: "",
  document_type: "",
  issue_date: "",
  expiry_date: "",
  remarks: "",
  file: null as File | null,
}

const EMPTY_EDIT = {
  document_name: "",
  issue_date: "",
  expiry_date: "",
  remarks: "",
}

export function ContractorDocuments({
  contractorId,
  warnDays = 7,
  documents,
  onRefresh,
}: {
  contractorId: number
  warnDays?: number
  documents: ContractorDocument[] | null
  onRefresh: () => Promise<void>
}) {
  const docs = documents
  const [filter, setFilter] = React.useState<"all" | "expiring" | "expired">("all")

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [uploadSaving, setUploadSaving] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [uploadForm, setUploadForm] = React.useState(EMPTY_UPLOAD)

  // Edit dialog state
  const [editing, setEditing] = React.useState<ContractorDocument | null>(null)
  const [editForm, setEditForm] = React.useState(EMPTY_EDIT)
  const [editSaving, setEditSaving] = React.useState(false)
  const [editError, setEditError] = React.useState<string | null>(null)

  // Delete confirm state
  const [confirmDelete, setConfirmDelete] = React.useState<ContractorDocument | null>(null)
  const [deleteBusyId, setDeleteBusyId] = React.useState<number | null>(null)

  // Version history state
  const [historyOf, setHistoryOf] = React.useState<ContractorDocument | null>(null)

  const canDelete = hasPermission("contractor.delete")
  const canUpload = hasPermission("contractor.document.upload")

  async function upload() {
    setUploadSaving(true)
    setUploadError(null)
    try {
      if (!uploadForm.file) throw new Error("Please choose a file.")
      const fd = new FormData()
      fd.append("document_name", uploadForm.document_name)
      fd.append("document_type", uploadForm.document_type)
      if (uploadForm.issue_date) fd.append("issue_date", uploadForm.issue_date)
      if (uploadForm.expiry_date) fd.append("expiry_date", uploadForm.expiry_date)
      if (uploadForm.remarks) fd.append("remarks", uploadForm.remarks)
      fd.append("file", uploadForm.file)
      await postForm(`/contractors/${contractorId}/documents`, fd)
      setUploadOpen(false)
      setUploadForm(EMPTY_UPLOAD)
      await onRefresh()
      toast.success("Document uploaded")
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to upload document")
    } finally {
      setUploadSaving(false)
    }
  }

  function openEdit(doc: ContractorDocument) {
    setEditing(doc)
    setEditError(null)
    setEditForm({
      document_name: doc.document_name ?? "",
      issue_date: doc.issue_date ?? doc.issued_date ?? "",
      expiry_date: doc.expiry_date ?? "",
      remarks: doc.remarks ?? "",
    })
  }

  async function saveEdit() {
    if (!editing) return
    if (editForm.issue_date && editForm.expiry_date && editForm.expiry_date < editForm.issue_date) {
      setEditError("Expiry date must be on or after issue date.")
      return
    }
    setEditSaving(true)
    setEditError(null)
    try {
      await patchJson(
        `/contractors/${contractorId}/documents/${editing.id}`,
        {
          document_name: editForm.document_name.trim() || editing.document_name,
          issue_date: editForm.issue_date || null,
          expiry_date: editForm.expiry_date || null,
          remarks: editForm.remarks || null,
        },
      )
      setEditing(null)
      await onRefresh()
      toast.success("Document updated")
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to update document")
    } finally {
      setEditSaving(false)
    }
  }

  async function deleteDocument() {
    if (!confirmDelete) return
    setDeleteBusyId(confirmDelete.id)
    try {
      await deleteJson(`/contractors/${contractorId}/documents/${confirmDelete.id}`)
      setConfirmDelete(null)
      await onRefresh()
      toast.success("Document deleted")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleteBusyId(null)
    }
  }

  const filtered = React.useMemo(() => {
    if (!docs) return docs
    if (filter === "all") return docs
    if (filter === "expired")
      return docs.filter((d) => d.expiry_date && daysUntil(d.expiry_date) < 0)
    if (filter === "expiring")
      return docs.filter(
        (d) =>
          d.expiry_date &&
          daysUntil(d.expiry_date) >= 0 &&
          daysUntil(d.expiry_date) <= warnDays,
      )
    return docs
  }, [docs, filter, warnDays])

  const summary = React.useMemo(() => {
    if (!docs) return { total: 0, expiring: 0, expired: 0 }
    let expiring = 0
    let expired = 0
    for (const d of docs) {
      if (!d.expiry_date) continue
      const left = daysUntil(d.expiry_date)
      if (left < 0) expired += 1
      else if (left <= warnDays) expiring += 1
    }
    return { total: docs.length, expiring, expired }
  }, [docs, warnDays])

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Documents</CardTitle>
            <div className="text-sm text-muted-foreground">
              Upload, edit, and track expiry of contractor documents.
            </div>
            {docs && docs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-zinc-950">{summary.total}</span> total
                </span>
                {summary.expiring > 0 ? (
                  <span>
                    <span className="font-medium text-yellow-700">{summary.expiring}</span> expiring
                    soon
                  </span>
                ) : null}
                {summary.expired > 0 ? (
                  <span>
                    <span className="font-medium text-red-700">{summary.expired}</span> expired
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                disabled={!canUpload}
                title={!canUpload ? "Missing permission: contractor.document.upload" : undefined}
              >
                <Upload className="mr-2 size-4" aria-hidden />
                Upload document
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Upload document</DialogTitle>
                <DialogDescription>
                  Re-uploading the same name and type will create a new version automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">Document name</div>
                  <Input
                    value={uploadForm.document_name}
                    onChange={(e) =>
                      setUploadForm((s) => ({ ...s, document_name: e.target.value }))
                    }
                    placeholder="Insurance certificate, Work agreement…"
                  />
                </div>
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">Type</div>
                  <Input
                    value={uploadForm.document_type}
                    onChange={(e) =>
                      setUploadForm((s) => ({ ...s, document_type: e.target.value }))
                    }
                    placeholder="insurance_certificate, kyc_address_proof…"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <div className="text-xs text-muted-foreground">Issue date</div>
                    <Input
                      type="date"
                      value={uploadForm.issue_date}
                      onChange={(e) =>
                        setUploadForm((s) => ({ ...s, issue_date: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="text-xs text-muted-foreground">Expiry date</div>
                    <Input
                      type="date"
                      value={uploadForm.expiry_date}
                      min={uploadForm.issue_date || undefined}
                      onChange={(e) =>
                        setUploadForm((s) => ({ ...s, expiry_date: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">Remarks</div>
                  <Input
                    value={uploadForm.remarks}
                    onChange={(e) => setUploadForm((s) => ({ ...s, remarks: e.target.value }))}
                    placeholder="Optional notes"
                  />
                </div>
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">File</div>
                  <Input
                    type="file"
                    onChange={(e) =>
                      setUploadForm((s) => ({ ...s, file: e.target.files?.[0] ?? null }))
                    }
                  />
                </div>
                {uploadError ? (
                  <div className="text-sm text-destructive">{uploadError}</div>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setUploadOpen(false)}
                  disabled={uploadSaving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={upload}
                  disabled={
                    uploadSaving ||
                    !uploadForm.document_name.trim() ||
                    !uploadForm.document_type.trim() ||
                    !uploadForm.file
                  }
                >
                  {uploadSaving ? "Uploading…" : "Upload"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3">
          <Button size="xs" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
            All
          </Button>
          <Button
            size="xs"
            variant={filter === "expiring" ? "default" : "outline"}
            onClick={() => setFilter("expiring")}
          >
            Expiring soon
          </Button>
          <Button
            size="xs"
            variant={filter === "expired" ? "default" : "outline"}
            onClick={() => setFilter("expired")}
          >
            Expired
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-gray-50">
              <TableHead>Document</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="w-[180px]">Status</TableHead>
              <TableHead className="w-[64px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {filter === "all" ? "No documents yet." : "No documents match this filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((d) => {
                const exp = expiryHint(d.expiry_date, warnDays)
                const expired = d.expiry_date ? daysUntil(d.expiry_date) < 0 : false
                return (
                  <TableRow
                    key={d.id}
                    className={expired ? "bg-red-50/40 hover:bg-red-50/60" : undefined}
                  >
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium text-zinc-950">{d.document_name}</div>
                        <div className="text-xs text-muted-foreground">
                          v{d.current_version}
                          {d.versions && d.versions.length > 1 ? (
                            <>
                              {" "}
                              ·{" "}
                              <button
                                className="underline-offset-2 hover:underline"
                                onClick={() => setHistoryOf(d)}
                              >
                                {d.versions.length} versions
                              </button>
                            </>
                          ) : null}
                          {d.remarks ? (
                            <>
                              {" "}
                              · <span className="italic">{d.remarks}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{d.document_type}</TableCell>
                    <TableCell className="text-sm">
                      {d.issue_date ?? d.issued_date ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{d.expiry_date ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={
                          exp.tone === "danger"
                            ? "text-red-700"
                            : exp.tone === "warning"
                            ? "text-amber-700"
                            : exp.tone === "success"
                            ? "text-emerald-700"
                            : "text-zinc-600"
                        }
                      >
                        {exp.hint}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button asChild size="xs" variant="outline">
                          <a
                            href={resolveFileUrl(d.file_path || d.file_url || "")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Eye className="mr-1.5 size-3.5 opacity-70" aria-hidden />
                            View
                          </a>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={!canUpload && !canDelete}
                              className="rounded-lg"
                              title="More actions"
                            >
                              <MoreHorizontal className="size-4 opacity-70" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => openEdit(d)}
                              disabled={!canUpload}
                            >
                              <Pencil className="mr-2 size-4" aria-hidden />
                              Edit details
                            </DropdownMenuItem>
                            {d.versions && d.versions.length > 1 ? (
                              <DropdownMenuItem onClick={() => setHistoryOf(d)}>
                                <History className="mr-2 size-4" aria-hidden />
                                Version history
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setConfirmDelete(d)}
                              disabled={!canDelete}
                              className="text-red-600 focus:text-red-700"
                            >
                              <Trash2 className="mr-2 size-4" aria-hidden />
                              Delete document
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Edit metadata dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>
              Update the descriptive fields. To replace the file content, upload again — a new version
              will be created automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Document name</div>
              <Input
                value={editForm.document_name}
                onChange={(e) => setEditForm((s) => ({ ...s, document_name: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">Issue date</div>
                <Input
                  type="date"
                  value={editForm.issue_date}
                  onChange={(e) => setEditForm((s) => ({ ...s, issue_date: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">Expiry date</div>
                <Input
                  type="date"
                  value={editForm.expiry_date}
                  min={editForm.issue_date || undefined}
                  onChange={(e) => setEditForm((s) => ({ ...s, expiry_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Remarks</div>
              <Textarea
                value={editForm.remarks}
                onChange={(e) => setEditForm((s) => ({ ...s, remarks: e.target.value }))}
                rows={3}
                placeholder="Optional notes"
              />
            </div>
            {editError ? <div className="text-sm text-destructive">{editError}</div> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete dialog */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => (o ? null : setConfirmDelete(null))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete document?</DialogTitle>
            <DialogDescription>
              The file and all its versions will be permanently removed from this contractor's
              record. This action is logged in the audit trail.
            </DialogDescription>
          </DialogHeader>
          {confirmDelete ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="font-medium text-zinc-950">{confirmDelete.document_name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {confirmDelete.document_type}
                {confirmDelete.expiry_date ? ` · expires ${confirmDelete.expiry_date}` : ""}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteBusyId !== null}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteDocument()}
              disabled={deleteBusyId !== null}
            >
              {deleteBusyId !== null ? "Deleting…" : "Delete document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history dialog */}
      <Dialog open={historyOf !== null} onOpenChange={(o) => !o && setHistoryOf(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <History className="size-4 opacity-70" aria-hidden /> Version history
            </DialogTitle>
            <DialogDescription>{historyOf?.document_name}</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-gray-50">
                <TableHead>Version</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(historyOf?.versions ?? []).map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-sm font-medium">v{v.version_number}</TableCell>
                  <TableCell className="text-sm">{v.issue_date ?? "—"}</TableCell>
                  <TableCell className="text-sm">{v.expiry_date ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {new Date(v.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="xs" variant="outline">
                      <a href={resolveFileUrl(v.file_path)} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
