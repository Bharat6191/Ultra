import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

type EmailTemplate = {
  id: number
  name: string
  event_code: string
  subject: string
  body_html: string
  body_text: string | null
  is_active: boolean
}

type EmailMapping = {
  id: number
  event_code: string
  template_id: number
  is_enabled: boolean
}

const EVENT_CODES = [
  "USER_CREATED",
  "FORGOT_PASSWORD",
  "PASSWORD_RESET",
  "TASK_ASSIGNED",
  "TASK_APPROVED",
  "TASK_REJECTED",
] as const

export function EmailTemplatesPage() {
  const navigate = useNavigate()

  const [templates, setTemplates] = React.useState<EmailTemplate[]>([])
  const [mappings, setMappings] = React.useState<EmailMapping[]>([])
  const [loading, setLoading] = React.useState(true)

  const [createName, setCreateName] = React.useState("")
  const [createEvent, setCreateEvent] = React.useState<(typeof EVENT_CODES)[number]>("USER_CREATED")
  const [createSubject, setCreateSubject] = React.useState("")
  const [createBody, setCreateBody] = React.useState("")

  const canCreate = hasPermission("email_templates.create")
  const canUpdate = hasPermission("email_templates.update")
  const canDelete = hasPermission("email_templates.delete")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [t, m] = await Promise.all([
        getJson<EmailTemplate[]>("/admin/email-templates"),
        getJson<EmailMapping[]>("/admin/email-templates/mappings"),
      ])
      setTemplates(t)
      setMappings(m)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load email templates."
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function createTemplate() {
    if (!canCreate) return
    const name = createName.trim()
    if (!name) return
    if (!createSubject.trim() || !createBody.trim()) return
    try {
      const created = await postJson<EmailTemplate>("/admin/email-templates", {
        name,
        event_code: createEvent,
        subject: createSubject,
        body_html: createBody,
        body_text: null,
        is_active: true,
      })
      toast.success("Template created.")
      setCreateName("")
      setCreateSubject("")
      setCreateBody("")
      await load()
      navigate(`/admin/email-templates/${created.id}`)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Create failed."
      toast.error(msg)
    }
  }

  async function removeTemplate(id: number) {
    if (!canDelete) return
    try {
      await deleteJson(`/admin/email-templates/${id}`)
      toast.success("Template deleted.")
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Delete failed."
      toast.error(msg)
    }
  }

  function mappingFor(code: string) {
    return mappings.find((x) => x.event_code === code) ?? null
  }

  async function upsertMapping(eventCode: string, nextTemplateId: number | null, enabled: boolean) {
    if (!canUpdate) return
    const existing = mappingFor(eventCode)
    if (!nextTemplateId) return
    try {
      if (!existing) {
        await postJson<EmailMapping>("/admin/email-templates/mappings", {
          event_code: eventCode,
          template_id: nextTemplateId,
          is_enabled: enabled,
        })
      } else {
        await patchJson<EmailMapping>(`/admin/email-templates/mappings/${existing.id}`, {
          template_id: nextTemplateId,
          is_enabled: enabled,
        })
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Mapping save failed."
      toast.error(msg)
      return
    }
    toast.success("Mapping saved.")
    await load()
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Email templates</h2>
        <p className="text-sm text-muted-foreground">
          Configure subjects and bodies per event. Mappings decide which template is used when an event triggers.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Templates</CardTitle>
            <CardDescription>Create or edit an email template.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading || templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      {loading ? "Loading…" : "No templates yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-sm">{t.event_code}</TableCell>
                      <TableCell className="text-sm">{t.is_active ? "active" : "inactive"}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => navigate(`/admin/email-templates/${t.id}`)}>
                          Edit
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={!canDelete} onClick={() => void removeTemplate(t.id)}>
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Create</CardTitle>
            <CardDescription>Quickly create a template.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label showRequired>Name</Label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. User created v1" disabled={!canCreate} />
            </div>
            <div className="space-y-1.5">
              <Label showRequired>Event</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={createEvent}
                onChange={(e) => setCreateEvent(e.target.value as any)}
                disabled={!canCreate}
              >
                {EVENT_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label showRequired>Subject</Label>
              <Input value={createSubject} onChange={(e) => setCreateSubject(e.target.value)} placeholder="Subject…" disabled={!canCreate} />
            </div>
            <div className="space-y-1.5">
              <Label showRequired>Body (HTML)</Label>
              <textarea
                className="min-h-[140px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                value={createBody}
                onChange={(e) => setCreateBody(e.target.value)}
                placeholder="<p>Hello {{user_name}}</p>"
                rows={6}
                disabled={!canCreate}
              />
            </div>
            <Button type="button" size="sm" className="w-full" onClick={() => void createTemplate()} disabled={!canCreate}>
              Create & open editor
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Event mappings</CardTitle>
          <CardDescription>Choose which template is used for each event.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {EVENT_CODES.map((code) => {
            const m = mappingFor(code)
            const selected = m?.template_id ? String(m.template_id) : ""
            const enabled = m?.is_enabled ?? true
            return (
              <div key={code} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{code}</div>
                  <div className="text-xs text-muted-foreground">{m ? `Mapped to template #${m.template_id}` : "No mapping yet"}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
                    value={selected}
                    onChange={(e) => void upsertMapping(code, Number(e.target.value), enabled)}
                    disabled={!canUpdate || templates.length === 0}
                  >
                    <option value="">{templates.length ? "Select template…" : "No templates"}</option>
                    {templates
                      .filter((t) => t.event_code === code)
                      .map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Enabled</span>
                    <Switch
                      checked={enabled}
                      disabled={!canUpdate || !m}
                      onCheckedChange={(v) => {
                        if (!m) return
                        void upsertMapping(code, m.template_id, Boolean(v))
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

