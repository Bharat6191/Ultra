import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { PageBackLink } from "@/components/layout/page-back-link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
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

type VarsResp = { event_code: string; variables: string[]; allowed_event_codes?: string[] }

type PreviewResp = { subject: string; body_html: string; missing_variables: string[] }

const EVENT_CODES = [
  "USER_CREATED",
  "FORGOT_PASSWORD",
  "PASSWORD_RESET",
  "TASK_ASSIGNED",
  "TASK_APPROVED",
  "TASK_REJECTED",
] as const

export function EmailTemplateEditorPage() {
  const { templateId } = useParams()
  const id = Number(templateId)
  const navigate = useNavigate()

  const canUpdate = hasPermission("email_templates.update")
  const canDelete = hasPermission("email_templates.delete")

  const [loading, setLoading] = React.useState(true)
  const [tpl, setTpl] = React.useState<EmailTemplate | null>(null)
  const [vars, setVars] = React.useState<string[]>([])

  const [name, setName] = React.useState("")
  const [eventCode, setEventCode] = React.useState<string>("USER_CREATED")
  const [subject, setSubject] = React.useState("")
  const [bodyHtml, setBodyHtml] = React.useState("")
  const [isActive, setIsActive] = React.useState(true)

  const [preview, setPreview] = React.useState<PreviewResp | null>(null)
  const [previewPayload, setPreviewPayload] = React.useState<string>('{"user_name":"A","email":"a@example.com"}')

  const load = React.useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      navigate("/admin/email-templates", { replace: true })
      return
    }
    setLoading(true)
    try {
      const t = await getJson<EmailTemplate>(`/admin/email-templates/${id}`)
      setTpl(t)
      setName(t.name)
      setEventCode(t.event_code)
      setSubject(t.subject)
      setBodyHtml(t.body_html)
      setIsActive(Boolean(t.is_active))
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load template."
      toast.error(msg)
      setTpl(null)
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    const code = (eventCode || "").trim().toUpperCase()
    if (!code) return
    void (async () => {
      try {
        const r = await getJson<VarsResp>(`/admin/email-templates/variables/${encodeURIComponent(code)}`)
        setVars(Array.isArray(r.variables) ? r.variables : [])
      } catch {
        setVars([])
      }
    })()
  }, [eventCode])

  async function save() {
    if (!canUpdate || !tpl) return
    try {
      await patchJson<EmailTemplate>(`/admin/email-templates/${tpl.id}`, {
        name: name.trim(),
        event_code: eventCode.trim().toUpperCase(),
        subject,
        body_html: bodyHtml,
        is_active: isActive,
      })
      toast.success("Saved.")
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Save failed."
      toast.error(msg)
    }
  }

  async function runPreview() {
    try {
      const parsed = JSON.parse(previewPayload || "{}") as Record<string, unknown>
      const res = await postJson<PreviewResp>("/admin/email-templates/preview", {
        subject,
        body_html: bodyHtml,
        payload: parsed,
      })
      setPreview(res)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Preview failed (invalid JSON payload?)."
      toast.error(msg)
    }
  }

  async function remove() {
    if (!canDelete || !tpl) return
    try {
      await deleteJson(`/admin/email-templates/${tpl.id}`)
      toast.success("Deleted.")
      navigate("/admin/email-templates", { replace: true })
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Delete failed."
      toast.error(msg)
    }
  }

  if (loading) {
    return (
      <div className="w-full min-w-0">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }
  if (!tpl) {
    return (
      <div className="w-full min-w-0">
        <p className="text-sm text-muted-foreground">Template not found.</p>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <PageBackLink
            to="/admin/email-templates"
            label={tpl.event_code?.trim() || "Email Templates"}
            className={tpl.event_code ? "font-mono" : undefined}
          />
          <h2 className="text-lg font-semibold tracking-tight">Edit template</h2>
          <p className="text-sm text-muted-foreground">
            {tpl.name} · <span className="font-mono">{tpl.event_code}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void save()} disabled={!canUpdate}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => void remove()} disabled={!canDelete}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Template</CardTitle>
            <CardDescription>
              Use Jinja-style variables like <span className="font-mono">{"{{user_name}}"}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label showRequired>Name</Label>
                <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canUpdate}
                />
              </div>
              <div className="space-y-1.5">
                <Label showRequired>Event</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={eventCode}
                  onChange={(e) => setEventCode(e.target.value)}
                  disabled={!canUpdate}
                >
                  {EVENT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label showRequired>Subject</Label>
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!canUpdate}
              />
            </div>

            <div className="space-y-1.5">
              <Label showRequired>Body (HTML)</Label>
              <textarea
                className="min-h-[260px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                disabled={!canUpdate}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Active</div>
                <div className="text-xs text-muted-foreground">Inactive templates are ignored by the engine.</div>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={!canUpdate} />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Variables</CardTitle>
              <CardDescription>Available for <span className="font-mono">{eventCode}</span>.</CardDescription>
            </CardHeader>
            <CardContent>
              {vars.length === 0 ? (
                <p className="text-sm text-muted-foreground">No variables listed for this event.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {vars.map((v) => (
                    <li key={v} className="font-mono">{`{{${v}}}`}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>Render subject + body with a sample payload.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Payload (JSON)</Label>
                <textarea
                  className="min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={previewPayload}
                  onChange={(e) => setPreviewPayload(e.target.value)}
                />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => void runPreview()}>
                Render preview
              </Button>
              {preview ? (
                <>
                  <Separator />
                  {preview.missing_variables?.length ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      Missing variables: {preview.missing_variables.join(", ")}
                    </p>
                  ) : null}
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">Subject</div>
                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">{preview.subject}</div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">Body</div>
                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap">{preview.body_html}</div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
