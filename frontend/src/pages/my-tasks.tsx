import * as React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ListPagination } from "@/components/shared/ListPagination"
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
  total: number
  loading: boolean
  canView: boolean
  emptyMessage: string
  onOpen: (taskId: number) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  title?: string | null
}

const TASKS_PAGE_SIZE = 20

function InboxTable({
  rows,
  total,
  loading,
  canView,
  emptyMessage,
  onOpen,
  page,
  pageSize,
  onPageChange,
  title = null,
}: InboxTableProps) {
  const hasRows = (rows ?? []).length > 0
  const statusMessage = !canView
    ? "Missing a My Tasks permission on your role."
    : loading
      ? "Loading…"
      : emptyMessage

  return (
    <Card className="rounded-[28px] border-zinc-200/80 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
      {title ? (
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={title ? "" : "pt-6"}>
        {hasRows ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title ?? "(untitled)"}</TableCell>
                  <TableCell className="text-sm capitalize">{r.status}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button type="button" size="sm" variant="default" onClick={() => onOpen(r.id)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center rounded-[22px] border border-dashed border-zinc-200 bg-zinc-50/70 px-6 text-center text-sm text-muted-foreground">
            {statusMessage}
          </div>
        )}
        {hasRows ? (
          <ListPagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={onPageChange} />
        ) : null}
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
  const [page, setPage] = React.useState(0)
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
      const data = await getJson<UnifiedTaskRow[]>(`/tasks/my-tasks?inbox=${inbox}&limit=200`)
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
    return [
      { key: "negotiation", label: "Negotiation Approval", rows: negotiation },
      { key: "invoice", label: "Invoices Approval", rows: invoice },
      { key: "other", label: "Other Tasks", rows: other },
    ]
  }, [rows])

  const activeSection = sections.find((item) => item.key === section) ?? sections[0]
  const sectionedRows = activeSection?.rows ?? []
  const paginatedRows = React.useMemo(
    () => sectionedRows.slice(page * TASKS_PAGE_SIZE, (page + 1) * TASKS_PAGE_SIZE),
    [page, sectionedRows],
  )

  React.useEffect(() => {
    setPage(0)
  }, [inbox, section])

  function renderInboxView(emptyMessage: string) {
    return (
      <div className="space-y-6">
        <Tabs value={section} onValueChange={(value) => setSection(value as TaskSectionKey)} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-3 bg-transparent p-0 shadow-none sm:grid-cols-3">
            {sections.map((item) => (
              <TabsTrigger
                key={item.key}
                value={item.key}
                className="relative min-h-[58px] rounded-[22px] border border-zinc-200 bg-white px-5 py-4 text-sm font-semibold text-zinc-500 shadow-[0_10px_24px_rgba(15,23,42,0.04)] after:hidden before:absolute before:left-5 before:right-5 before:top-0 before:h-1 before:rounded-b-full before:bg-emerald-500 before:opacity-0 before:transition-opacity before:content-[''] transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[0_12px_28px_rgba(15,23,42,0.07)] data-[state=active]:border-emerald-200 data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-50 data-[state=active]:to-white data-[state=active]:text-zinc-950 data-[state=active]:shadow-[0_14px_32px_rgba(16,185,129,0.12)] data-[state=active]:before:opacity-100"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <InboxTable
          rows={paginatedRows}
          total={sectionedRows.length}
          loading={loading}
          canView={canView}
          onOpen={(id) => void navigate(`/dashboard/tasks/${id}`)}
          emptyMessage={emptyMessage}
          page={page}
          pageSize={TASKS_PAGE_SIZE}
          onPageChange={setPage}
        />
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <Tabs value={inbox} onValueChange={(value) => setInbox(value as "active" | "done")} className="w-full gap-5">
        <PageHeader
          title="My Tasks"
          action={
            <TabsList className="inline-flex h-12 rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
              <TabsTrigger
                value="active"
                className="rounded-full px-8 text-sm font-semibold text-zinc-500 transition-all
                data-[state=active]:bg-white data-[state=active]:text-zinc-950
                data-[state=active]:shadow-md"
              >
                Active
              </TabsTrigger>

              <TabsTrigger
                value="done"
                className="rounded-full px-8 text-sm font-semibold text-zinc-500 transition-all
                data-[state=active]:bg-white data-[state=active]:text-zinc-950
                data-[state=active]:shadow-md"
              >
                Done
              </TabsTrigger>
            </TabsList>
          }
        />
        <TabsContent value="active" className="mt-0">
          {renderInboxView("No active tasks. Approvals and manual items that need you appear here.")}
        </TabsContent>
        <TabsContent value="done" className="mt-0">
          {renderInboxView("No completed items yet. Finished approvals, rejections, and closed manual tasks show here.")}
        </TabsContent>
      </Tabs>
    </div>
  )
}
