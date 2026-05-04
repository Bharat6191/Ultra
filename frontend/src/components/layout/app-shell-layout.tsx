import * as React from "react"
import {
  BarChart3,
  ClipboardList,
  BriefcaseBusiness,
  Factory,
  KeyRound,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Settings,
  Settings2,
  Shield,
  User2,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useLocation } from "react-router-dom"

import { AppNavbar } from "@/components/layout/AppNavbar"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { hasAnyNonUsersRbacPermission, hasPermission } from "@/lib/permissions"
import type { SidebarNavItem } from "@/components/layout/AppSidebar"

type NavPerm = string | string[] | null

type ShellNavItem = {
  id: string
  label: string
  icon: LucideIcon
  to: string
  permission: NavPerm
  /**
   * When true, hide this item unless the user has at least one RBAC grant outside ``users.*``
   * (so roles with only user-management permissions do not see generic workspace tabs).
   */
  hideWhenOnlyUsersModule?: boolean
}

const shellNavItems: ShellNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/dashboard", permission: null },
  {
    id: "performance",
    label: "Performance",
    icon: BarChart3,
    to: "/dashboard/performance",
    permission: null,
    hideWhenOnlyUsersModule: true,
  },
  {
    id: "preferences",
    label: "Preferences",
    icon: Settings2,
    to: "/dashboard/preferences",
    permission: null,
    hideWhenOnlyUsersModule: true,
  },
  { id: "users", label: "Users", icon: Users, to: "/dashboard/users", permission: "users.view" },
  {
    id: "tasks",
    label: "My tasks",
    icon: ClipboardList,
    to: "/dashboard/tasks",
    permission: ["approval.view", "task.view"],
  },
  {
    id: "plants",
    label: "Plants",
    icon: Factory,
    to: "/dashboard/plants",
    permission: ["org_units.view", "org_units.create", "org_units.update", "org_units.delete"],
  },
  {
    id: "roles",
    label: "Roles",
    icon: Shield,
    to: "/dashboard/roles",
    permission: ["roles.view", "roles.update", "roles.create"],
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: KeyRound,
    to: "/dashboard/permissions",
    permission: ["permissions.view", "permissions.create"],
  },
  {
    id: "admin-settings",
    label: "System settings",
    icon: Settings,
    to: "/dashboard/system-settings",
    permission: "settings.update",
  },
  {
    id: "contractors",
    label: "Contractors",
    icon: BriefcaseBusiness,
    to: "/dashboard/contractors",
    permission: "contractor.view",
  },
]

function navItemVisible(item: ShellNavItem): boolean {
  if (item.hideWhenOnlyUsersModule && !hasAnyNonUsersRbacPermission()) return false
  const p = item.permission
  if (p === null) return true
  if (Array.isArray(p)) return p.some((c) => hasPermission(c))
  return hasPermission(p)
}

function pathMatchesNav(pathname: string, to: string): boolean {
  if (to === "/dashboard") return pathname === "/dashboard" || pathname === "/dashboard/"
  return pathname === to || pathname.startsWith(`${to}/`)
}

export type AppShellLayoutProps = {
  children: React.ReactNode
  userEmail?: string | null
  onSignOut?: () => void
}

export function AppShellLayout({ children, userEmail, onSignOut }: AppShellLayoutProps) {
  const location = useLocation()
  const visibleNav = shellNavItems.filter(navItemVisible)

  const activeItem = visibleNav.find((item) => pathMatchesNav(location.pathname, item.to))
  const title = activeItem?.label ?? "Dashboard"

  const sidebarItems = React.useMemo<SidebarNavItem[]>(
    () =>
      visibleNav
        .map((i) => ({ id: i.id, label: i.label, to: i.to, icon: i.icon })),
    [visibleNav]
  )

  return (
    <div className="flex h-svh min-h-0 w-full bg-gray-50 text-foreground">
      <AppSidebar items={sidebarItems} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppNavbar title={title} userEmail={userEmail} onSignOut={onSignOut} />

        <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  )
}
