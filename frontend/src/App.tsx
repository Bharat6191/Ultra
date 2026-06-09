import { AdminLayout } from "@/components/layout/admin-layout"
import { AppShellLayout } from "@/components/layout/app-shell-layout"
import { AppToaster } from "@/components/app-toaster"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppLoginPage } from "@/pages/app-login"
import { DashboardPage } from "@/pages/dashboard"
import { LoginPage } from "@/pages/login"
import { PermissionsPage } from "@/pages/permissions"
import { PlantsPage } from "@/pages/plants"
import { RolesRedesignDemoPage } from "@/pages/roles-demo"
import { RolesPage } from "@/pages/roles"
import { SettingsPage } from "@/pages/settings"
import { UsersPage } from "@/pages/users"
import { ContractorsPage } from "@/pages/contractors"
import { ContractorDetailPage } from "@/pages/contractor-detail"
import { ContractorCreatePage } from "@/pages/contractor-create"
import { ContractorEditPage } from "@/pages/contractor-edit"
import { PartMasterPage } from "@/pages/part-master"
import { PartMasterCreatePage } from "@/pages/part-master-create"
import { PartMasterDetailPage } from "@/pages/part-master-detail"
import { NegotiatedRatesPage } from "@/pages/negotiated-rates"
import { NegotiatedRateDetailPage } from "@/pages/negotiated-rate-detail"
import { NegotiatedRateNewPage } from "@/pages/negotiated-rate-new"
import { NegotiatedRateNegotiatePage } from "@/pages/negotiated-rate-negotiate"
import { WorkOrdersPage } from "@/pages/work-orders"
import { WorkOrderDetailPage } from "@/pages/work-order-detail"
import { WorkOrderCreatePage } from "@/pages/work-order-create"
import { InvoicesPage } from "@/pages/invoices"
import { InvoiceCreatePage } from "@/pages/invoice-create"
import { InvoiceDetailPage } from "@/pages/invoice-detail"
import { MyTasksPage } from "@/pages/my-tasks"
import { WorkflowAssignmentPage } from "@/pages/workflow-assignment"
import { EmailTemplatesPage } from "@/pages/email-templates"
import { EmailTemplateEditorPage } from "@/pages/email-template-editor"
import { AdminNotificationsPage } from "@/pages/admin-notifications"
import { UserCreatePage } from "@/pages/user-create"
import { UserEditPage } from "@/pages/user-edit"
import { UserViewPage } from "@/pages/user-view"
import { MyTaskDetailPage } from "@/pages/my-task-detail"
import { ForgotPasswordPage } from "@/pages/forgot-password"
import { ResetPasswordPage } from "@/pages/reset-password"
import { MfaSetupPage } from "@/pages/mfa-setup"
import { ReportsPage } from "@/pages/reports"
import * as React from "react"
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { getJson } from "@/lib/api"
import {
  clearAuthProfile,
  isSuperuser,
  NEGOTIATED_RATE_READ_PERMISSION_CODES,
  persistAuthFromMe,
  TASK_INBOX_PERMISSION_CODES,
} from "@/lib/permissions"
import { clearSessionLastActivity } from "@/lib/session-timeout"

/** Compare /me outcomes so we only remount dashboard routes when RBAC identity actually changes.
 *  Otherwise focus/visibility events (e.g. closing the native file picker) would bump the outlet key
 *  and wipe in-progress form state. */
function workspaceMeSignature(me: {
  email?: string
  is_superuser?: boolean
  permissions?: string[]
}): string {
  const p = [...(me.permissions ?? [])].sort()
  return `${Boolean(me.is_superuser)}|${me.email ?? ""}|${p.join("\0")}`
}

function App() {
  return (
    <>
      <AppToaster />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/demo/roles-redesign" element={<RolesRedesignDemoPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/mfa/setup" element={<MfaSetupPage />} />
        <Route path="/login" element={<AppLoginRoute />} />
        <Route path="/dashboard" element={<AppRoute />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="users"
            element={
              <RequirePermission code="users.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<UsersPage />} />
            <Route path="new" element={<UserCreatePage />} />
            <Route path=":id" element={<UserViewPage />} />
            <Route path=":id/edit" element={<UserEditPage />} />
          </Route>
          <Route
            path="tasks"
            element={
              <RequirePermission anyOf={TASK_INBOX_PERMISSION_CODES}>
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<MyTasksPage />} />
            <Route path=":taskId" element={<MyTaskDetailPage />} />
          </Route>
          <Route
            path="plants"
            element={
              <RequirePermission anyOf={["org_units.view", "org_units.create", "org_units.update", "org_units.delete"]}>
                <PlantsPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission anyOf={["roles.view", "roles.update", "roles.create"]}>
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<RolesPage />} />
            <Route path="demo" element={<RolesRedesignDemoPage />} />
          </Route>
          <Route
            path="permissions"
            element={
              <RequirePermission anyOf={["permissions.view", "permissions.create"]}>
                <PermissionsPage />
              </RequirePermission>
            }
          />
          <Route
            path="system-settings"
            element={
              <RequirePermission anyOf={["settings.view", "settings.update"]}>
                <SettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="contractors"
            element={
              <RequirePermission code="contractor.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<ContractorsPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="contractor.create">
                  <ContractorCreatePage />
                </RequirePermission>
              }
            />
            <Route
              path=":id/edit"
              element={
                <RequirePermission code="contractor.update">
                  <ContractorEditPage />
                </RequirePermission>
              }
            />
            <Route path=":id" element={<ContractorDetailPage />} />
          </Route>
          <Route
            path="part-master"
            element={
              <RequirePermission
                anyOf={["part_master.view", "part_master.create", "part_master.update"]}
              >
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<PartMasterPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="part_master.create">
                  <PartMasterCreatePage />
                </RequirePermission>
              }
            />
            <Route path=":partMasterId" element={<PartMasterDetailPage />} />
          </Route>
          <Route path="rate-card" element={<Navigate to="/dashboard/part-master" replace />} />
          <Route
            path="negotiated-rates"
            element={
              <RequirePermission
                anyOf={[
                  "contractor_rates.view",
                  "contractor_rates.create",
                  "contractor_rates.update",
                  "contractor_rates.approve",
                ]}
              >
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<NegotiatedRatesPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="contractor_rates.create">
                  <NegotiatedRateNewPage />
                </RequirePermission>
              }
            />
            <Route
              path=":rateId/negotiate"
              element={
                <RequirePermission code="contractor_rates.update">
                  <NegotiatedRateNegotiatePage />
                </RequirePermission>
              }
            />
            <Route
              path=":rateId"
              element={
                <RequirePermission anyOf={NEGOTIATED_RATE_READ_PERMISSION_CODES}>
                  <NegotiatedRateDetailPage />
                </RequirePermission>
              }
            />
          </Route>
          <Route
            path="work-orders"
            element={
              <RequirePermission anyOf={["work_orders.view", "work_orders.create", "work_orders.update", "work_orders.approve"]}>
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<WorkOrdersPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="work_orders.create">
                  <WorkOrderCreatePage />
                </RequirePermission>
              }
            />
            <Route path=":id" element={<WorkOrderDetailPage />} />
          </Route>
          <Route
            path="invoices"
            element={
              <RequirePermission anyOf={["invoices.view", "invoices.create", "invoices.update", "invoices.validate"]}>
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<InvoicesPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="invoices.create">
                  <InvoiceCreatePage />
                </RequirePermission>
              }
            />
            <Route
              path=":id/edit"
              element={
                <RequirePermission anyOf={["invoices.create", "invoices.update"]}>
                  <InvoiceCreatePage />
                </RequirePermission>
              }
            />
            <Route path=":id" element={<InvoiceDetailPage />} />
          </Route>
          <Route
            path="reports"
            element={
              <RequirePermission code="invoices.view">
                <ReportsPage />
              </RequirePermission>
            }
          />
        </Route>
        <Route path="/admin/login" element={<LoginRoute />} />
        <Route path="/admin" element={<AdminRoute />}>
          <Route index element={<OverviewPage />} />
          <Route
            path="users"
            element={
              <RequirePermission code="users.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<UsersPage />} />
            <Route path="new" element={<UserCreatePage />} />
            <Route path=":id" element={<UserViewPage />} />
            <Route path=":id/edit" element={<UserEditPage />} />
          </Route>
          <Route
            path="plants"
            element={
              <RequirePermission anyOf={["org_units.view", "org_units.create", "org_units.update", "org_units.delete"]}>
                <PlantsPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission anyOf={["roles.view", "roles.update", "roles.create"]}>
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<RolesPage />} />
            <Route path="demo" element={<RolesRedesignDemoPage />} />
          </Route>
          <Route
            path="permissions"
            element={
              <RequirePermission anyOf={["permissions.view", "permissions.create"]}>
                <PermissionsPage />
              </RequirePermission>
            }
          />
          <Route
            path="settings"
            element={
              <RequirePermission anyOf={["settings.view", "settings.update"]}>
                <SettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="settings/notifications"
            element={
              <RequirePermission anyOf={["notification_settings.manage", "email_templates.manage"]}>
                <AdminNotificationsPage />
              </RequirePermission>
            }
          />
          <Route
            path="workflow-assignment"
            element={
              <RequirePermission code="approval.manage">
                <WorkflowAssignmentPage />
              </RequirePermission>
            }
          />
          <Route
            path="email-templates"
            element={
              <RequirePermission anyOf={["email_templates.view", "email_templates.create", "email_templates.update", "email_templates.delete"]}>
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<EmailTemplatesPage />} />
            <Route path=":templateId" element={<EmailTemplateEditorPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}

export default App

function hasToken() {
  const t = localStorage.getItem("access_token")
  return !!(t && t.length > 0)
}

function clearTokens() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("refresh_token")
  clearSessionLastActivity()
  clearAuthProfile()
}

function LoginRoute() {
  const navigate = useNavigate()
  if (hasToken()) return <Navigate to="/admin" replace />
  return (
    <LoginPage
      onLoggedIn={() => {
        navigate("/admin", { replace: true })
      }}
    />
  )
}

function AppLoginRoute() {
  const navigate = useNavigate()
  const [checking, setChecking] = React.useState(hasToken())

  React.useEffect(() => {
    let cancelled = false
    if (!hasToken()) return
    ;(async () => {
      try {
        const me = await getJson<{ is_superuser?: boolean; permissions?: string[] }>("/me")
        if (cancelled) return
        persistAuthFromMe(me)
        const isSuper = me?.is_superuser === true
        navigate(isSuper ? "/admin" : "/dashboard", { replace: true })
      } catch {
        if (cancelled) return
        clearTokens()
        setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (checking) return null
  return <AppLoginPage />
}

function AppRoute() {
  const navigate = useNavigate()
  const [checking, setChecking] = React.useState(true)
  const [userEmail, setUserEmail] = React.useState<string | null>(null)
  const [profileTick, setProfileTick] = React.useState(0)
  const profileSigRef = React.useRef<string | null>(null)

  // Refetch /me and re-snapshot the RBAC cache. Used both at mount (to gate
  // the route) and on window focus / explicit refresh so that permission
  // changes made in another tab become visible without a full reload.
  const refreshProfile = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!hasToken()) {
        if (!opts?.silent) {
          setChecking(false)
          navigate("/login", { replace: true })
        }
        return
      }
      try {
        const me = await getJson<{
          email?: string
          is_superuser?: boolean
          permissions?: string[]
        }>("/me")
        persistAuthFromMe(me)
        if (me?.is_superuser === true) {
          navigate("/admin", { replace: true })
          return
        }
        setUserEmail(typeof me.email === "string" ? me.email : null)
        const sig = workspaceMeSignature(me)
        if (profileSigRef.current !== sig) {
          profileSigRef.current = sig
          setProfileTick((t) => t + 1)
        }
        setChecking(false)
      } catch {
        if (opts?.silent) return
        clearTokens()
        navigate("/login", { replace: true })
      }
    },
    [navigate],
  )

  React.useEffect(() => {
    void refreshProfile()
  }, [refreshProfile])

  // Auto-refresh permissions when the user comes back to the tab. This catches
  // the common case where an admin updates a role in another tab; the user's
  // sidebar / tabs would otherwise stay stale until they hard-reload.
  React.useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        void refreshProfile({ silent: true })
      }
    }
    function onFocus() {
      void refreshProfile({ silent: true })
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refreshProfile])

  if (checking) return null
  return (
    <AppShellLayout
      userEmail={userEmail}
      onRefreshProfile={() => void refreshProfile({ silent: true })}
      onSignOut={() => {
        clearTokens()
        navigate("/login", { replace: true })
      }}
    >
      <Outlet key={profileTick} />
    </AppShellLayout>
  )
}

function AdminRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const [activeId, setActiveId] = React.useState<
    | "overview"
    | "users"
    | "plants"
    | "roles"
    | "permissions"
    | "settings"
    | "workflow-assignment"
    | "email-templates"
    | "notifications"
  >("overview")
  const [userEmail, setUserEmail] = React.useState<string | null>(null)
  const [profileTick, setProfileTick] = React.useState(0)
  const [superGate, setSuperGate] = React.useState<"pending" | "ok">("pending")

  React.useEffect(() => {
    const p = location.pathname
    if (p.startsWith("/admin/users")) setActiveId("users")
    else if (p.startsWith("/admin/plants")) setActiveId("plants")
    else if (p.startsWith("/admin/roles")) setActiveId("roles")
    else if (p.startsWith("/admin/permissions")) setActiveId("permissions")
    else if (p.startsWith("/admin/workflow-assignment")) setActiveId("workflow-assignment")
    else if (p.startsWith("/admin/email-templates")) setActiveId("email-templates")
    else if (p.startsWith("/admin/settings/notifications")) setActiveId("notifications")
    else if (p.startsWith("/admin/settings")) setActiveId("settings")
    else setActiveId("overview")
  }, [location.pathname])

  if (!hasToken()) return <Navigate to="/admin/login" replace />

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await getJson<{ email?: string; is_superuser?: boolean; permissions?: string[] }>("/me")
        if (cancelled) return
        persistAuthFromMe(me)
        if (me?.is_superuser !== true) {
          navigate("/dashboard", { replace: true })
          return
        }
        setUserEmail(typeof me.email === "string" ? me.email : null)
        setProfileTick((t) => t + 1)
        setSuperGate("ok")
      } catch {
        if (!cancelled) {
          clearTokens()
          navigate("/admin/login", { replace: true })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (superGate !== "ok") return null

  return (
    <AdminLayout
      activeId={activeId}
      onNavigate={(id) => {
        if (id === "overview") navigate("/admin")
        if (id === "users") navigate("/admin/users")
        if (id === "plants") navigate("/admin/plants")
        if (id === "roles") navigate("/admin/roles")
        if (id === "permissions") navigate("/admin/permissions")
        if (id === "workflow-assignment") navigate("/admin/workflow-assignment")
        if (id === "email-templates") navigate("/admin/email-templates")
        if (id === "notifications") navigate("/admin/settings/notifications")
        if (id === "settings") navigate("/admin/settings")
      }}
      userEmail={userEmail}
      onSignOut={() => {
        clearTokens()
        navigate("/admin/login", { replace: true })
      }}
    >
      <Outlet key={profileTick} />
    </AdminLayout>
  )
}

function OverviewPage() {
  const superUser = isSuperuser()
  return (
    <div className="space-y-4">
      <Card className="max-w-lg border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Superadmin</CardTitle>
          <CardDescription>
            This console is only for superusers. Other roles use the workspace at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/login</code> — management screens
            appear in the sidebar there when permitted.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Admin APIs are mounted at{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/admin/*</code>.
        </CardContent>
      </Card>

      {superUser ? (
        <Card className="max-w-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Shortcuts</CardTitle>
            <CardDescription>
              Create plants and users from the Users screen (Create plant / Create user).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <Link to="/admin/users">Open Users (plants)</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
