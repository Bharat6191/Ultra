import * as React from "react"
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  Mail,
  MapPin,
  Pencil,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { PageBackLink } from "@/components/layout/page-back-link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

function eventTimeMs(event: TimelineEvent): number {
  if (event.timestamp) {
    const t = new Date(event.timestamp).getTime()
    if (!Number.isNaN(t)) return t
  }
  if (event.action === "pending") return Number.POSITIVE_INFINITY
  return Number.NEGATIVE_INFINITY
}

function userInitials(user: Pick<UserPublic, "full_name" | "username">): string {
  const raw = (user.full_name || user.username || "").trim()
  if (!raw) return "?"
  const parts = raw.split(/\s+/).filter(Boolean)
  const a = (parts[0]?.[0] ?? raw[0] ?? "?").toUpperCase()
  const b = (parts[1]?.[0] ?? raw[1] ?? "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}

function humanizeLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getRoleIdsFromAuditValue(value: unknown): number[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const roleIds = (value as { role_ids?: unknown }).role_ids
  return Array.isArray(roleIds)
    ? roleIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : []
}

function getRoleNamesFromAuditValue(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const roleNames = (value as { role_names?: unknown }).role_names
  return Array.isArray(roleNames) ? roleNames.filter((name): name is string => typeof name === "string" && name.trim() !== "") : []
}

function getRoleNamesFromEvent(event: TimelineEvent): string[] {
  return getRoleNamesFromAuditValue(event.details?.new_value)
}

function getOldRoleIdsFromEvent(event: TimelineEvent): number[] {
  return getRoleIdsFromAuditValue(event.details?.old_value)
}

function getNewRoleIdsFromEvent(event: TimelineEvent): number[] {
  return getRoleIdsFromAuditValue(event.details?.new_value)
}

function getChangeEntriesFromEvent(
  event: TimelineEvent,
): Array<[string, { from?: unknown; to?: unknown }]> {
  const rawChanges = event.details?.changes
  if (!rawChanges || typeof rawChanges !== "object" || Array.isArray(rawChanges)) return []
  return Object.entries(rawChanges as Record<string, { from?: unknown; to?: unknown }>)
}

function getEventComment(event: TimelineEvent): string | null {
  const value = event.details?.comment
  return typeof value === "string" && value.trim() ? value : null
}

function rbacAuditActionLabel(event: TimelineEvent): string {
  const oldRoleIds = getOldRoleIdsFromEvent(event)
  const newRoleIds = getNewRoleIdsFromEvent(event)
  const action = String(event.action ?? "").trim().toLowerCase()

  if (newRoleIds.length === 0 && oldRoleIds.length > 0) return "Roles Removed"
  if (oldRoleIds.length === 0 && newRoleIds.length > 0) return "Roles Assigned"
  if (action === "assign" && newRoleIds.length > oldRoleIds.length) return "Role Added"
  return "Roles Updated"
}

function rbacAuditSummary(event: TimelineEvent): string {
  const roles = getRoleNamesFromEvent(event)
  const oldRoleIds = getOldRoleIdsFromEvent(event)
  const newRoleIds = getNewRoleIdsFromEvent(event)

  if (newRoleIds.length === 0 && oldRoleIds.length > 0) return "All assigned roles were removed"
  if (roles.length === 0) return "User role access was updated"
  if (oldRoleIds.length === 0 && newRoleIds.length > 0) return `Assigned roles: ${roles.join(", ")}`
  if (String(event.action ?? "").trim().toLowerCase() === "assign" && newRoleIds.length > oldRoleIds.length) {
    return `Current roles: ${roles.join(", ")}`
  }
  return `Updated roles: ${roles.join(", ")}`
}

function auditEventTitle(event: TimelineEvent): string {
  return event.type === "rbac_audit" ? "User Access" : humanizeLabel(event.type)
}

function auditEventAction(event: TimelineEvent): string {
  if (event.type === "approval_step") {
    const stepLabel = `Step ${event.step ?? "—"}`
    if (event.action === "pending") return `${stepLabel} Pending`
    if (event.action) return `${stepLabel} ${humanizeLabel(event.action)}`
    return stepLabel
  }
  if (event.type === "entity_updated") return "Updated"
  if (event.type === "created") return "Created"
  if (event.type === "rbac_audit") return rbacAuditActionLabel(event)
  return auditEventTitle(event)
}

function auditEventActor(event: TimelineEvent): string {
  if (event.action === "pending") return (event.assigned_to ?? []).join(", ") || "Pending"
  if (event.user && event.user.trim()) return event.user
  return "System"
}

function auditEventSummary(event: TimelineEvent): string {
  const comment = getEventComment(event)
  if (comment) return comment

  if (event.type === "approval_step") {
    if (event.action === "pending") {
      const assignees = (event.assigned_to ?? []).join(", ") || "—"
      return `Awaiting ${assignees}`
    }
    return event.user ? `Handled by ${event.user}` : "Approval step updated"
  }

  if (event.type === "rbac_audit") {
    return rbacAuditSummary(event)
  }

  if (event.type === "entity_updated") {
    const changes = getChangeEntriesFromEvent(event)
    if (changes.length > 0) {
      return changes
        .slice(0, 2)
        .map(([key, value]) => `${humanizeLabel(key)} -> ${String(value.to ?? "—")}`)
        .join(" · ")
    }
    return "Profile fields updated"
  }

  if (event.type === "created") return "User record created"
  return "—"
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant={active ? "default" : "secondary"}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-semibold",
        active && "border-0 bg-emerald-600 text-white hover:bg-emerald-600",
      )}
    >
      {active ? "Active" : "Inactive"}
    </Badge>
  )
}

function SectionCard({
  title,
  icon,
  className,
  children,
}: {
  title: string
  icon: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn("border-zinc-200 shadow-sm", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base text-zinc-950">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            {icon}
          </span>
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function DetailRow({
  label,
  value,
  stacked = false,
  valueClassName,
}: {
  label: string
  value: React.ReactNode
  stacked?: boolean
  valueClassName?: string
}) {
  return (
    <div
      className={cn(
        "flex gap-4 border-b border-zinc-100 py-3 first:pt-0 last:border-b-0 last:pb-0",
        stacked ? "flex-col items-start" : "items-start justify-between",
      )}
    >
      <dt className="text-sm font-bold text-zinc-950">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-sm font-normal text-zinc-950",
          stacked ? "w-full text-left" : "text-right",
          valueClassName,
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function HeroFact({
  label,
  value,
  icon,
  className,
}: {
  label: string
  value: React.ReactNode
  icon: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="mt-0.5 flex size-10 items-center justify-center rounded-xl bg-white/90 text-zinc-600 shadow-sm ring-1 ring-zinc-200/80">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold text-zinc-950">{label}</div>
        <div className="mt-0.5 text-sm font-normal text-zinc-950">{value}</div>
      </div>
    </div>
  )
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
  const [showFullAudit, setShowFullAudit] = React.useState(false)

  const canUpdate = hasPermission("users.update")
  const canViewAudit = hasPermission("approval.view")
  const canResendMfa = hasPermission("mfa.manage")
  const sortedTimeline = React.useMemo(() => {
    const entries = timeline ?? []
    return [...entries].sort((a, b) => eventTimeMs(b) - eventTimeMs(a))
  }, [timeline])
  const recentAuditRows = React.useMemo(() => sortedTimeline.slice(0, 4), [sortedTimeline])
  const visibleAuditRows = React.useMemo(
    () => (showFullAudit ? sortedTimeline : recentAuditRows),
    [recentAuditRows, showFullAudit, sortedTimeline],
  )
  const hasMoreAuditRows = sortedTimeline.length > recentAuditRows.length

  const canHardDelete = isSuperuser() && meId !== null && user !== null && user.id !== meId

  React.useEffect(() => {
    setShowFullAudit(false)
  }, [id])

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

        const allUsers = await getJson<UserPublic[]>("/admin/users?skip=0&limit=200")
        const foundUser = allUsers.find((entry) => entry.id === userId) ?? null
        setUser(foundUser)

        if (foundUser?.org_unit?.id) {
          try {
            const policy = await getJson<{ mfa_enabled?: boolean }>(
              `/admin/auth-policy?company_id=${foundUser.org_unit.id}`,
            )
            setMfaEnabled(Boolean(policy?.mfa_enabled))
          } catch {
            setMfaEnabled(false)
          }
        } else {
          setMfaEnabled(false)
        }

        if (canViewAudit) {
          try {
            const entries = await getJson<TimelineEvent[]>(`/audit/entity/user/${userId}`)
            setTimeline(entries)
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
            <PageBackLink to=".." label="Users" />
            <h2 className="text-lg font-semibold tracking-tight text-zinc-950">User Details</h2>
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        </div>
      </div>
    )
  }

  const roleList = user
    ? user.roles && user.roles.length > 0
      ? user.roles
      : user.role
        ? [user.role]
        : []
    : []
  const primaryRole = roleList[0]?.name ?? "—"
  const headerFacts = user
    ? [
        { label: "Designation", value: user.designation ?? "—", icon: <BadgeCheck className="size-4" /> },
        { label: "Department", value: user.department ?? "—", icon: <Building2 className="size-4" /> },
        { label: "Role", value: primaryRole, icon: <ShieldCheck className="size-4" /> },
        { label: "Plant", value: user.org_unit?.name ?? "—", icon: <MapPin className="size-4" /> },
      ]
    : []

  return (
    <div className="w-full space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <PageBackLink
              to="/dashboard/users"
              label={user?.username?.trim() || "Users"}
              className={user?.username ? "font-mono" : undefined}
            />
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">User Details</h1>
            {/* <p className="text-sm text-muted-foreground">View user profile and assignment information.</p> */}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {user && canUpdate && user.is_active && !user.is_superuser ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resendingWelcome}
                onClick={() => void resendWelcomeEmail()}
              >
                <Mail className="size-4" />
                {resendingWelcome ? "Resending…" : "Resend Invite"} 
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
                <ShieldCheck className="size-4" />
                {resendingMfa ? "Resending…" : "Resend MFA Setup"}
              </Button>
            ) : null}

            {user && canUpdate && !user.is_superuser ? (
              <Button asChild size="sm">
                <Link to="edit" className="inline-flex items-center gap-2">
                  <Pencil className="size-4" />
                  Edit
                </Link>
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
                <Trash2 className="size-4" />
                {deleting ? "Deleting…" : "Delete User"}
              </Button>
            ) : null}
          </div>
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
          <Card className="overflow-hidden border-zinc-200 bg-white shadow-sm">
            <CardContent className="p-0">
              <div className="bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(240,253,244,0.92))] px-6 py-6 sm:px-8">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <Avatar className="size-24 rounded-full bg-emerald-100 after:hidden" size="lg">
                        <AvatarFallback className="rounded-full bg-emerald-100 text-4xl font-semibold text-emerald-700">
                          {userInitials(user)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-3xl font-semibold tracking-tight text-zinc-950">{user.full_name}</h2>
                          <StatusBadge active={user.is_active} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 border-t border-zinc-200/80 pt-5 md:grid-cols-2 xl:grid-cols-4">
                    {headerFacts.map((fact, index) => (
                      <HeroFact
                        key={fact.label}
                        label={fact.label}
                        value={fact.value}
                        icon={fact.icon}
                        className={cn(index < headerFacts.length - 1 && "xl:border-r xl:border-zinc-200/80 xl:pr-6")}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <SectionCard title="Personal Information" icon={<UserRound className="size-4" />}>
              <dl>
                <DetailRow label="Full Name" value={user.full_name || "—"} />
                <DetailRow label="Username" value={user.username || "—"} />
                <DetailRow label="Phone" value={user.phone ?? "—"} />
                <DetailRow label="Email" value={user.email ?? "—"} valueClassName="break-all" />
              </dl>
            </SectionCard>

            <SectionCard title="Work Information" icon={<BriefcaseBusiness className="size-4" />}>
              <dl>
                <DetailRow label="Employee Code" value={user.employee_code ?? "—"} />
                <DetailRow label="Department" value={user.department ?? "—"} />
                <DetailRow label="Designation" value={user.designation ?? "—"} />
                <DetailRow
                  label="Roles"
                  value={
                    roleList.length > 0 ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {roleList.map((role) => (
                          <Badge key={role.id} variant="secondary" className="rounded-full px-3 py-1 font-medium">
                            {role.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )
                  }
                />
              </dl>
            </SectionCard>

            <SectionCard title="Address Details" icon={<MapPin className="size-4" />}>
              <dl>
                <DetailRow label="Plant" value={user.org_unit?.name ?? "—"} />
                <DetailRow
                  label="Address"
                  stacked
                  value={<span className="whitespace-pre-wrap text-zinc-950">{user.address ?? "—"}</span>}
                />
              </dl>
            </SectionCard>

            {/* <SectionCard title="Activity Details" icon={<Clock3 className="size-4" />}>
              <dl>
                <DetailRow
                  label="Status"
                  value={
                    <div className="flex flex-wrap justify-end gap-2">
                      <StatusBadge active={user.is_active} />
                      {user.is_superuser ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-amber-300 bg-amber-50 px-3 py-1 text-amber-900"
                        >
                          Superuser
                        </Badge>
                      ) : null}
                    </div>
                  }
                />
                <DetailRow label="Created" value={formatDateTime(user.created_at)} />
                <DetailRow label="Last Updated" value={formatDateTime(user.updated_at)} />
                <DetailRow
                  label="MFA"
                  value={user.mfa_setup_completed ? "Setup complete" : mfaEnabled ? "Pending setup" : "Not required"}
                />
              </dl>
            </SectionCard> */}

            <SectionCard
              title="Audit Log (Summary)"
              icon={<ClipboardList className="size-4" />}
              className="xl:col-span-3"
            >
              {!canViewAudit ? (
                <p className="text-sm text-muted-foreground">
                  Missing permission: <span className="font-mono">approval.view</span>
                </p>
              ) : visibleAuditRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit events found.</p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-2xl border border-zinc-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[180px]">Date & Time</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Performed By</TableHead>
                          <TableHead>Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleAuditRows.map((event, index) => (
                          <TableRow key={`${event.type}-${event.timestamp ?? index}-${index}`} className="hover:bg-zinc-50/50">
                            <TableCell className="text-sm text-zinc-600">
                              {event.timestamp ? formatDateTime(event.timestamp) : event.action === "pending" ? "Now" : "—"}
                            </TableCell>
                            <TableCell className="text-sm font-semibold text-zinc-950">{auditEventAction(event)}</TableCell>
                            <TableCell className="text-sm text-zinc-600">{auditEventActor(event)}</TableCell>
                            <TableCell className="whitespace-normal text-sm text-zinc-600">
                              {auditEventSummary(event)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {hasMoreAuditRows ? (
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto rounded-full px-0 text-sm font-semibold text-emerald-700 hover:bg-transparent hover:text-emerald-800"
                        onClick={() => setShowFullAudit((current) => !current)}
                      >
                        {showFullAudit ? "Hide Full Audit Log" : "View Full Audit Log"}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}
