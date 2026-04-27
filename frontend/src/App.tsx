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
import { RolesPage } from "@/pages/roles"
import { SettingsPage } from "@/pages/settings"
import { UsersPage } from "@/pages/users"
import { MyTasksPage } from "@/pages/my-tasks"
import { WorkflowAssignmentPage } from "@/pages/workflow-assignment"
import { EmailTemplatesPage } from "@/pages/email-templates"
import { EmailTemplateEditorPage } from "@/pages/email-template-editor"
import { UserCreatePage } from "@/pages/user-create"
import { UserEditPage } from "@/pages/user-edit"
import { UserViewPage } from "@/pages/user-view"
import { MyTaskDetailPage } from "@/pages/my-task-detail"
import { ForgotPasswordPage } from "@/pages/forgot-password"
import { ResetPasswordPage } from "@/pages/reset-password"
import { MfaSetupPage } from "@/pages/mfa-setup"
import * as React from "react"
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { getJson } from "@/lib/api"
import { AccessDenied } from "@/components/admin/access-denied"
import { clearAuthProfile, hasAnyNonUsersRbacPermission, isSuperuser, persistAuthFromMe } from "@/lib/permissions"

function App() {
  return (
    <>
      <AppToaster />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/mfa/setup" element={<MfaSetupPage />} />
        <Route path="/login" element={<AppLoginRoute />} />
        <Route path="/dashboard" element={<AppRoute />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="performance"
            element={
              <RequireNonUsersWorkspace>
                <WorkspacePlaceholder
                  title="Performance"
                  body="Connect plant KPIs and trends here. This area is reserved for operational analytics."
                />
              </RequireNonUsersWorkspace>
            }
          />
          <Route
            path="preferences"
            element={
              <RequireNonUsersWorkspace>
                <WorkspacePlaceholder
                  title="Preferences"
                  body="Personal settings for this workspace will live here."
                />
              </RequireNonUsersWorkspace>
            }
          />
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
              <RequirePermission code="approval.view">
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
                <RolesPage />
              </RequirePermission>
            }
          />
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
              <RequirePermission code="settings.update">
                <SettingsPage />
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
                <RolesPage />
              </RequirePermission>
            }
          />
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
              <RequirePermission code="settings.update">
                <SettingsPage />
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

function WorkspacePlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-lg space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function RequireNonUsersWorkspace({ children }: { children: React.ReactNode }) {
  if (!hasAnyNonUsersRbacPermission()) {
    return (
      <AccessDenied message="This area is available when your role includes permissions beyond user management (for example roles, permissions, or settings)." />
    )
  }
  return <>{children}</>
}

function hasToken() {
  const t = localStorage.getItem("access_token")
  return !!(t && t.length > 0)
}

function clearTokens() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("refresh_token")
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

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasToken()) {
        setChecking(false)
        navigate("/login", { replace: true })
        return
      }
      try {
        const me = await getJson<{ email?: string; is_superuser?: boolean; permissions?: string[] }>("/me")
        if (cancelled) return
        persistAuthFromMe(me)
        if (me?.is_superuser === true) {
          navigate("/admin", { replace: true })
          return
        }
        setUserEmail(typeof me.email === "string" ? me.email : null)
        setProfileTick((t) => t + 1)
        setChecking(false)
      } catch {
        if (cancelled) return
        clearTokens()
        navigate("/login", { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (checking) return null
  return (
    <AppShellLayout
      userEmail={userEmail}
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
