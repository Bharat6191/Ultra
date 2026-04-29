import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { getJson, postJson } from "@/lib/api"

type RoleListItem = { id: number; name: string }

type NotificationSetting = {
  id: number
  event_code: string
  notify_roles: number[]
  days_before: number
  is_active: boolean
}

type EmailTemplate = {
  id: number
  event_code: string
  subject: string
  body_html: string
  is_active: boolean
}

const EVENTS = [{ code: "contractor_doc_expiry", label: "Contractor document expiry" }] as const

function eventToEmailEvent(eventCode: string) {
  // Current email engine event code (catalog) for this notification.
  if (eventCode === "contractor_doc_expiry") return "CONTRACTOR_DOC_EXPIRY"
  return eventCode.toUpperCase()
}

export function AdminNotificationsPage() {
  const [eventCode, setEventCode] = React.useState<(typeof EVENTS)[number]["code"]>("contractor_doc_expiry")
  const [roles, setRoles] = React.useState<RoleListItem[]>([])

  const [settingId, setSettingId] = React.useState<number | null>(null)
  const [daysBefore, setDaysBefore] = React.useState(7)
  const [active, setActive] = React.useState(true)
  const [notifyRoles, setNotifyRoles] = React.useState<number[]>([])

  const [templateId, setTemplateId] = React.useState<number | null>(null)
  const [templateActive, setTemplateActive] = React.useState(true)
  const [subject, setSubject] = React.useState("Document Expiry Alert - {{document_name}}")
  const [body, setBody] = React.useState(
    [
      "Hello,",
      "",
      "The document {{document_name}} for contractor {{contractor_name}} is expiring on {{expiry_date}}.",
      "",
      "Days remaining: {{days_left}}",
      "",
      "Please take action.",
      "",
      "Regards,",
      "System",
    ].join("\n")
  )

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  async function loadAll() {
    setLoading(true)
    try {
      const emailEventCode = eventToEmailEvent(eventCode)
      const [roleRows, settingsRows, templatesRows] = await Promise.all([
        getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200"),
        getJson<NotificationSetting[]>(`/admin/notification-settings?event_code=${encodeURIComponent(eventCode)}`),
        getJson<EmailTemplate[]>(`/admin/email-templates?event_code=${encodeURIComponent(emailEventCode)}`),
      ])
      setRoles(roleRows.map((r) => ({ id: r.id, name: r.name })))

      const s = settingsRows[0] ?? null
      setSettingId(s?.id ?? null)
      setDaysBefore(typeof s?.days_before === "number" ? s.days_before : 7)
      setActive(s?.is_active ?? true)
      setNotifyRoles(Array.isArray(s?.notify_roles) ? s.notify_roles : [])

      const t = templatesRows[0] ?? null
      setTemplateId(t?.id ?? null)
      setTemplateActive(t?.is_active ?? true)
      if (t?.subject) setSubject(t.subject)
      if (t?.body_html) setBody(t.body_html)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load notification configuration")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCode])

  function toggleRole(roleId: number, next: boolean) {
    setNotifyRoles((prev) => {
      const has = prev.includes(roleId)
      if (next && !has) return [...prev, roleId].sort((a, b) => a - b)
      if (!next && has) return prev.filter((x) => x !== roleId)
      return prev
    })
  }

  async function save() {
    setSaving(true)
    toast.loading("Saving…", { id: "notif-save" })
    try {
      const emailEventCode = eventToEmailEvent(eventCode)

      await postJson<NotificationSetting>("/admin/notification-settings", {
        event_code: eventCode,
        days_before: daysBefore,
        notify_roles: notifyRoles,
        is_active: active,
      })

      await postJson<EmailTemplate>("/admin/email-templates", {
        event_code: emailEventCode,
        subject,
        body_html: body,
        is_active: templateActive,
        is_enabled: true,
      })

      toast.success("Saved", { id: "notif-save" })
      await loadAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed", { id: "notif-save" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Notification Control Center</h2>
        <p className="text-sm text-muted-foreground">Configure who gets notified and what email content is sent.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Event</CardTitle>
          <CardDescription>Select an event to manage.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-sm"
            value={eventCode}
            onChange={(e) => setEventCode(e.target.value as any)}
            disabled={loading || saving}
          >
            {EVENTS.map((e) => (
              <option key={e.code} value={e.code}>
                {e.label}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => void save()} disabled={loading || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="template">Template</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Notification settings</CardTitle>
              <CardDescription>Who gets alerts and how early they trigger.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Days before trigger</div>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={daysBefore}
                    onChange={(e) => setDaysBefore(Number(e.target.value))}
                    disabled={loading || saving}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Active</div>
                    <div className="text-xs text-muted-foreground">Enable/disable this notification.</div>
                  </div>
                  <Switch checked={active} onCheckedChange={(v) => setActive(Boolean(v))} disabled={loading || saving} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Notify roles</div>
                <div className="text-xs text-muted-foreground">
                  If none selected, only the contractor email (if present) will be notified.
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {roles.map((r) => {
                    const checked = notifyRoles.includes(r.id)
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">Role #{r.id}</div>
                        </div>
                        <Switch
                          checked={checked}
                          onCheckedChange={(v) => toggleRole(r.id, Boolean(v))}
                          disabled={loading || saving}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Loaded setting id: <code className="rounded bg-muted px-1 py-0.5">{String(settingId ?? "—")}</code>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="template" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Email template</CardTitle>
              <CardDescription>Content sent for this event. HTML allowed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Template active</div>
                  <div className="text-xs text-muted-foreground">Disable to skip sending even when settings are active.</div>
                </div>
                <Switch
                  checked={templateActive}
                  onCheckedChange={(v) => setTemplateActive(Boolean(v))}
                  disabled={loading || saving}
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">Subject</div>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={loading || saving} />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">Body (HTML/text)</div>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={loading || saving} />
                <div className="text-xs text-muted-foreground">
                  Variables: <code className="rounded bg-muted px-1 py-0.5">{"{{contractor_name}}"}</code>{" "}
                  <code className="rounded bg-muted px-1 py-0.5">{"{{document_name}}"}</code>{" "}
                  <code className="rounded bg-muted px-1 py-0.5">{"{{expiry_date}}"}</code>{" "}
                  <code className="rounded bg-muted px-1 py-0.5">{"{{days_left}}"}</code>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Loaded template id: <code className="rounded bg-muted px-1 py-0.5">{String(templateId ?? "—")}</code>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

