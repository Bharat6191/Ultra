import * as React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, getJson } from "@/lib/api"
import { canAccessTaskInbox, persistAuthFromMe } from "@/lib/permissions"

type UnifiedTaskRow = {
  id: number
  task_type: "approval" | "manual" | "rework"
  title: string | null
  status: string
  entity_type?: string | null
}

type InboxTableProps = {
  rows: UnifiedTaskRow[] | null
  loading: boolean
  canView: boolean
  emptyMessage: string
  onOpen: (taskId: number) => void
  title?: string
}

function InboxTable({ rows, loading, canView, emptyMessage, onOpen, title = "Inbox" }: InboxTableProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {/* <CardDescription>Tasks you are assigned to or that you created — open a row for details, comments, and history.</CardDescription> */}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  {!canView
                    ? "Missing a My Tasks permission on your role."
                    : loading
                      ? "Loading…"
                      : emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              (rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title ?? "(untitled)"}</TableCell>
                  <TableCell className="text-sm capitalize">{r.task_type}</TableCell>
                  <TableCell className="text-sm capitalize">{r.status}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button type="button" size="sm" variant="default" onClick={() => onOpen(r.id)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

type TaskSectionKey = "negotiation" | "invoice" | "other"

type TaskSection = {
  key: TaskSectionKey
  label: string
  rows: UnifiedTaskRow[]
}

function taskSectionKey(row: UnifiedTaskRow): TaskSectionKey {
  if (row.entity_type === "contractor_rate_approval") return "negotiation"
  if (row.entity_type === "invoice_exception_approval") return "invoice"
  return "other"
}

export function MyTasksPage() {
  const [rows, setRows] = React.useState<UnifiedTaskRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [inbox, setInbox] = React.useState<"active" | "done">("active")
  const [section, setSection] = React.useState<TaskSectionKey>("negotiation")
  const navigate = useNavigate()

  const [, forcePermRefresh] = React.useReducer((x: number) => x + 1, 0)
  const canView = canAccessTaskInbox()

  const syncMe = React.useCallback(async () => {
    try {
      const me = await getJson<{ is_superuser?: boolean; permissions?: string[] }>("/me")
      persistAuthFromMe(me)
      forcePermRefresh()
    } catch {
      // ignore; load() will surface auth errors if needed
    }
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setRows(null)
    try {
      const data = await getJson<UnifiedTaskRow[]>(`/tasks/my-tasks?inbox=${inbox}`)
      setRows(data)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load tasks."
      toast.error(msg)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [inbox])

  React.useEffect(() => {
    void syncMe()
  }, [syncMe])

  React.useEffect(() => {
    if (!canView) {
      setLoading(false)
      setRows([])
      return
    }
    void load()
  }, [canView, load])

  const sections = React.useMemo<TaskSection[]>(() => {
    const all = rows ?? []
    const negotiation = all.filter((row) => taskSectionKey(row) === "negotiation")
    const invoice = all.filter((row) => taskSectionKey(row) === "invoice")
    const other = all.filter((row) => taskSectionKey(row) === "other")
    const grouped: TaskSection[] = [
      { key: "negotiation", label: "Negotiation Approval", rows: negotiation },
      { key: "invoice", label: "Invoices Approval", rows: invoice },
      { key: "other", label: "Other Tasks", rows: other },
    ]
    return grouped.filter((item) => item.rows.length > 0)
  }, [rows])

  React.useEffect(() => {
    if (sections.length === 0) return
    if (sections.some((item) => item.key === section)) return
    setSection(sections[0].key)
  }, [section, sections])

  const hasApprovalSections = sections.some((item) => item.key === "negotiation" || item.key === "invoice")
  const activeSection = hasApprovalSections ? sections.find((item) => item.key === section) ?? sections[0] ?? null : null
  const sectionedTitle = activeSection?.label ?? "Inbox"
  const sectionedRows = activeSection?.rows ?? rows

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">My Tasks</h2>
        <p className="text-sm text-muted-foreground">
          Open items that need you, and a <strong>Done</strong> list for things you or others already finished
          (approvals, rejections, completed manual work).
        </p>
      </div>

      <Tabs value={inbox} onValueChange={(v) => setInbox(v as "active" | "done")} className="w-full">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="done">Done</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          <div className="space-y-4">
            {hasApprovalSections ? (
              <Tabs value={section} onValueChange={(v) => setSection(v as TaskSectionKey)} className="w-full">
                <TabsList className="flex h-auto flex-wrap gap-2 bg-transparent p-0">
                  {sections.map((item) => (
                    <TabsTrigger key={item.key} value={item.key}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            <InboxTable
              title={sectionedTitle}
              rows={sectionedRows}
              loading={loading}
              canView={canView}
              onOpen={(id) => void navigate(`/dashboard/tasks/${id}`)}
              emptyMessage="No active tasks. Approvals and manual items that need you appear here."
            />
          </div>
        </TabsContent>
        <TabsContent value="done" className="mt-4">
          <div className="space-y-4">
            {hasApprovalSections ? (
              <Tabs value={section} onValueChange={(v) => setSection(v as TaskSectionKey)} className="w-full">
                <TabsList className="flex h-auto flex-wrap gap-2 bg-transparent p-0">
                  {sections.map((item) => (
                    <TabsTrigger key={item.key} value={item.key}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            <InboxTable
              title={sectionedTitle}
              rows={sectionedRows}
              loading={loading}
              canView={canView}
              onOpen={(id) => void navigate(`/dashboard/tasks/${id}`)}
              emptyMessage="No completed items yet. Finished approvals, rejections, and closed manual tasks show here."
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
