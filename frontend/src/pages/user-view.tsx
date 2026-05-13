import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ApiError, deleteJson, getJson, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type UserPublic = {
  id: number
  full_name: string
  username: string
  phone: string | null
  email: string | null
  employee_code?: string | null
  department?: string | null
  designation?: string | null
  address?: string | null
  is_active: boolean
  is_superuser: boolean
  mfa_setup_completed?: boolean
  roles?: { id: number; name: string }[]
  role: { id: number; name: string } | null
  org_unit: { id: number; name: string; type: string } | null
  created_at: string
  updated_at: string
}

type TimelineEvent = {
  type: string
  user?: string | null
  step?: number | null
  action?: string | null
  assigned_to?: string[]
  timestamp?: string | null
  details?: Record<string, unknown>
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function eventTimeMs(ev: TimelineEvent): number {
  if (ev.timestamp) {
    const t = new Date(ev.timestamp).getTime()
    if (!Number.isNaN(t)) return t
  }
  // Keep "pending/Now" at the very top.
  if (ev.action === "pending") return Number.POSITIVE_INFINITY
  return Number.NEGATIVE_INFINITY
}

export function UserViewPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [user, setUser] = React.useState<UserPublic | null>(null)
  const [timeline, setTimeline] = React.useState<TimelineEvent[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [meId, setMeId] = React.useState<number | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [resendingMfa, setResendingMfa] = React.useState(false)
  const [resendingWelcome, setResendingWelcome] = React.useState(false)
  const [mfaEnabled, setMfaEnabled] = React.useState<boolean>(false)

  const canUpdate = hasPermission("users.update")
  const canViewAudit = hasPermission("approval.view")
  const canResendMfa = hasPermission("mfa.manage")
  const sortedTimeline = React.useMemo(() => {
    const tl = timeline ?? []
    return [...tl].sort((a, b) => eventTimeMs(b) - eventTimeMs(a))
  }, [timeline])

  const canHardDelete = isSuperuser() && meId !== null && user !== null && user.id !== meId

  async function resendWelcomeEmail() {
    if (!user) return
    setResendingWelcome(true)
    try {
      await postJson(`/admin/users/${user.id}/resend-welcome`, {})
      toast.success("Welcome email queued (if email templates are configured).")
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not resend welcome email"
      toast.error(message)
    } finally {
      setResendingWelcome(false)
    }
  }

  async function resendMfaSetupEmail() {
    if (!user) return
    setResendingMfa(true)
    try {
      await postJson(`/admin/users/${user.id}/resend-mfa`, {})
      toast.success("MFA setup email queued (if email templates are configured).")
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not resend MFA email"
      toast.error(message)
    } finally {
      setResendingMfa(false)
    }
  }

  async function handleDeleteUser() {
    if (!user) return
    const ok = window.confirm(
      `Permanently delete ${user.full_name}?\n\nThis removes the account and related onboarding approvals / task rows. This cannot be undone.`,
    )
    if (!ok) return
    const typed = window.prompt('Type "DELETE" to confirm permanent deletion.', "")
    if (typed !== "DELETE") {
      setError("Deletion cancelled.")
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await deleteJson(`/admin/users/${user.id}`)
      navigate("..", { replace: true })
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to delete user"
      setError(message)
    } finally {
      setDeleting(false)
    }
  }

  React.useEffect(() => {
    const userId = Number(id)
    if (!Number.isFinite(userId) || userId <= 0) {
      navigate("..", { replace: true })
      return
    }

    void (async () => {
      setLoading(true)
      setError(null)
      setUser(null)
      setMeId(null)
      setTimeline(null)
      try {
        try {
          const me = await getJson<{
            id: number
            is_superuser?: boolean
            permissions?: string[]
          }>("/me")
          setMeId(me.id)
        } catch {
          setMeId(null)
        }

        const all = await getJson<UserPublic[]>("/admin/users?skip=0&limit=200")
        const u = all.find((x) => x.id === userId) ?? null
        setUser(u)
        if (u?.org_unit?.id) {
          try {
            const pol = await getJson<{ mfa_enabled?: boolean }>(`/admin/auth-policy?company_id=${u.org_unit.id}`)
            setMfaEnabled(Boolean(pol?.mfa_enabled))
          } catch {
            setMfaEnabled(false)
          }
        } else {
          setMfaEnabled(false)
        }
        if (canViewAudit) {
          try {
            const tl = await getJson<TimelineEvent[]>(`/audit/entity/user/${userId}`)
            setTimeline(tl)
          } catch {
            setTimeline([])
          }
        } else {
          setTimeline([])
        }
      } catch (e) {
        const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load user"
        setError(message)
      } finally {
        setLoading(false)
      }
    })()
  }, [id, navigate, canViewAudit])

  if (loading) {
    return (
      <div className="w-full space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">User</h2>
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="..">Back</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">User details</h2>
          <p className="text-sm text-muted-foreground">Read-only summary. Audit Trail appears below.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="..">Back</Link>
          </Button>
          {user && canUpdate && user.is_active && !user.is_superuser ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={resendingWelcome}
              onClick={() => void resendWelcomeEmail()}
            >
              {resendingWelcome ? "Resending…" : "Resend onboarding email"}
            </Button>
          ) : null}
          {user && canResendMfa && mfaEnabled && user.is_active && !user.is_superuser && !user.mfa_setup_completed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={resendingMfa}
              onClick={() => void resendMfaSetupEmail()}
            >
              {resendingMfa ? "Resending…" : "Resend MFA setup"}
            </Button>
          ) : null}
          {user && canUpdate && !user.is_superuser ? (
            <Button asChild size="sm">
              <Link to="edit">Edit</Link>
            </Button>
          ) : null}
          {user && canHardDelete ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50 dark:border-red-900/50 dark:text-red-200 dark:hover:bg-red-950/30"
              disabled={deleting}
              onClick={() => void handleDeleteUser()}
            >
              {deleting ? "Deleting…" : "Delete user"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!user ? (
        <Alert>
          <AlertTitle>User not found</AlertTitle>
          <AlertDescription>This user may have been deleted or is outside the loaded range.</AlertDescription>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{user.full_name}</CardTitle>
              <CardDescription>User profile and assignment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Full name</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{user.full_name}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Username</dt>
                  <dd className="mt-0.5 text-foreground">{user.username ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</dt>
                  <dd className="mt-0.5 text-foreground">{user.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
                  <dd className="mt-0.5 text-foreground">{user.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Employee code</dt>
                  <dd className="mt-0.5 text-foreground">{user.employee_code ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Department</dt>
                  <dd className="mt-0.5 text-foreground">{user.department ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Designation</dt>
                  <dd className="mt-0.5 text-foreground">{user.designation ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Roles</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {(user.roles && user.roles.length > 0 ? user.roles : user.role ? [user.role] : []).map((r) => (
                      <Badge key={r.id} variant="secondary" className="font-normal">
                        {r.name}
                      </Badge>
                    ))}
                    {!user.roles?.length && !user.role ? <span className="text-foreground">—</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plant</dt>
                  <dd className="mt-0.5 text-foreground">{user.org_unit?.name ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Address</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{user.address ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge
                      variant={user.is_active ? "default" : "secondary"}
                      className={cn(
                        "rounded-md",
                        user.is_active &&
                          "border-0 bg-primary text-primary-foreground hover:bg-primary",
                      )}
                    >
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {user.is_superuser ? (
                      <Badge
                        variant="outline"
                        className="rounded-md border-amber-300/80 text-amber-900 dark:border-amber-700 dark:text-amber-100"
                      >
                        Superuser
                      </Badge>
                    ) : null}
                  </dd>
                </div>
              </dl>

              <Separator />

              <dl className="grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="font-medium">Created</dt>
                  <dd className="mt-0.5 tabular-nums">{formatDateTime(user.created_at)}</dd>
                </div>
                <div>
                  <dt className="font-medium">Last updated</dt>
                  <dd className="mt-0.5 tabular-nums">{formatDateTime(user.updated_at)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Audit Trail</CardTitle>
              <CardDescription>
                Timeline for this user. {canViewAudit ? "Includes onboarding approvals and RBAC changes (roles, assignments)." : "You don’t have permission to view audit details."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!canViewAudit ? (
                <p className="text-sm text-muted-foreground">
                  Missing permission: <span className="font-mono">approval.view</span>
                </p>
              ) : sortedTimeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit events found.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {sortedTimeline.map((ev, i) => (
                    <li key={i} className="rounded-md border bg-muted/30 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium capitalize">
                          {ev.type === "rbac_audit" ? "RBAC" : ev.type.replace("_", " ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ev.timestamp ? formatDateTime(ev.timestamp) : ev.action === "pending" ? "Now" : "—"}
                        </span>
                      </div>
                      {ev.type === "created" ? <p className="text-xs text-muted-foreground">By {ev.user ?? "—"}</p> : null}
                      {ev.type === "rbac_audit" ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {String(ev.action ?? "change")}
                            {ev.user ? ` · by ${ev.user}` : ""}
                          </p>
                          {Array.isArray((ev.details?.new_value as Record<string, unknown> | undefined)?.role_names) ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Roles: {(ev.details!.new_value as { role_names: string[] }).role_names.join(", ")}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      {ev.type === "approval_step" && ev.action && ev.action !== "pending" ? (
                        <p className="text-xs text-muted-foreground">
                          Step {ev.step ?? "—"} · {ev.action} by {ev.user ?? "—"}
                        </p>
                      ) : null}
                      {ev.type === "approval_step" && typeof ev.details?.comment === "string" && String(ev.details.comment).trim() !== "" ? (
                        <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-wrap">
                          Note: {String(ev.details.comment)}
                        </p>
                      ) : null}
                      {ev.type === "approval_step" && ev.action === "pending" ? (
                        <p className="text-xs text-muted-foreground">
                          Awaiting: {(ev.assigned_to ?? []).join(", ") || "—"}
                          {ev.details?.role ? ` · Role: ${String(ev.details.role)}` : ""}
                        </p>
                      ) : null}
                      {ev.type === "entity_updated" && ev.details && typeof (ev.details as any).changes === "object" ? (
                        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                          {Object.entries((ev.details as any).changes as Record<string, any>).length === 0 ? (
                            <p>No changes captured.</p>
                          ) : (
                            <ul className="space-y-1">
                              {Object.entries((ev.details as any).changes as Record<string, any>).map(([k, v]) => (
                                <li key={k}>
                                  <span className="font-medium">{k}</span>: {String(v?.from ?? "—")} → {String(v?.to ?? "—")}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

