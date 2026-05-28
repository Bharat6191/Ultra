import * as React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, getJson } from "@/lib/api"
import { canAccessTaskInbox, persistAuthFromMe } from "@/lib/permissions"

type UnifiedTaskRow = {
  id: number
  task_type: "approval" | "manual" | "rework"
  title: string | null
  status: string
}

type InboxTableProps = {
  rows: UnifiedTaskRow[] | null
  loading: boolean
  canView: boolean
  emptyMessage: string
  onOpen: (taskId: number) => void
}

function InboxTable({ rows, loading, canView, emptyMessage, onOpen }: InboxTableProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inbox</CardTitle>
        <CardDescription>Tasks you are assigned to or that you created — open a row for details, comments, and history.</CardDescription>
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

export function MyTasksPage() {
  const [rows, setRows] = React.useState<UnifiedTaskRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [inbox, setInbox] = React.useState<"active" | "done">("active")
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
          <InboxTable
            rows={rows}
            loading={loading}
            canView={canView}
            onOpen={(id) => void navigate(`/dashboard/tasks/${id}`)}
            emptyMessage="No active tasks. Approvals and manual items that need you appear here."
          />
        </TabsContent>
        <TabsContent value="done" className="mt-4">
          <InboxTable
            rows={rows}
            loading={loading}
            canView={canView}
            onOpen={(id) => void navigate(`/dashboard/tasks/${id}`)}
            emptyMessage="No completed items yet. Finished approvals, rejections, and closed manual tasks show here."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
