import * as React from "react"
import {
  BadgeIndianRupee,
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  Factory,
  Handshake,
  KeyRound,
  LayoutDashboard,
  Receipt,
  Settings,
  Shield,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useLocation } from "react-router-dom"

import { AppNavbar } from "@/components/layout/AppNavbar"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { hasPermission, TASK_INBOX_PERMISSION_CODES } from "@/lib/permissions"
import type { SidebarNavItem } from "@/components/layout/AppSidebar"

type NavPerm = string | string[] | null

type ShellNavItem = {
  id: string
  label: string
  icon: LucideIcon
  to: string
  permission: NavPerm
  group: "Operations" | "System Menu"
}

const shellNavItems: ShellNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/dashboard", permission: null, group: "Operations" },
  { id: "users", label: "Users", icon: Users, to: "/dashboard/users", permission: "users.view", group: "System Menu" },
  {
    id: "tasks",
    label: "My Tasks",
    icon: ClipboardList,
    to: "/dashboard/tasks",
    permission: TASK_INBOX_PERMISSION_CODES,
    group: "Operations",
  },
  {
    id: "plants",
    label: "Clusters & Plants",
    icon: Factory,
    to: "/dashboard/plants",
    permission: ["org_units.view", "org_units.create", "org_units.update", "org_units.delete"],
    group: "System Menu",
  },
  {
    id: "roles",
    label: "Roles",
    icon: Shield,
    to: "/dashboard/roles",
    permission: ["roles.view", "roles.update", "roles.create"],
    group: "System Menu",
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: KeyRound,
    to: "/dashboard/permissions",
    permission: ["permissions.view", "permissions.create"],
    group: "System Menu",
  },
  {
    id: "admin-settings",
    label: "System Settings",
    icon: Settings,
    to: "/dashboard/system-settings",
    permission: ["settings.view", "settings.update"],
    group: "System Menu",
  },
  {
    id: "contractors",
    label: "Contractors",
    icon: BriefcaseBusiness,
    to: "/dashboard/contractors",
    permission: "contractor.view",
    group: "Operations",
  },
  {
    id: "part-master",
    label: "Part Master",
    icon: BadgeIndianRupee,
    to: "/dashboard/part-master",
    permission: ["part_master.view", "part_master.create", "part_master.update"],
    group: "Operations",
  },
  {
    id: "negotiated-rates",
    label: "Negotiation",
    icon: Handshake,
    to: "/dashboard/negotiated-rates",
    permission: [
      "contractor_rates.view",
      "contractor_rates.create",
      "contractor_rates.update",
      "contractor_rates.approve",
    ],
    group: "Operations",
  },
  {
    id: "work-orders",
    label: "Work Orders",
    icon: BriefcaseBusiness,
    to: "/dashboard/work-orders",
    permission: ["work_orders.view", "work_orders.create", "work_orders.update", "work_orders.approve"],
    group: "Operations",
  },
  {
    id: "invoices",
    label: "Invoices",
    icon: Receipt,
    to: "/dashboard/invoices",
    permission: ["invoices.view", "invoices.create", "invoices.update", "invoices.validate"],
    group: "Operations",
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    to: "/dashboard/reports",
    permission: "invoices.view",
    group: "Operations",
  },
]

function navItemVisible(item: ShellNavItem): boolean {
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
  onRefreshProfile?: () => void
}

export function AppShellLayout({
  children,
  userEmail,
  onSignOut,
  onRefreshProfile,
}: AppShellLayoutProps) {
  const location = useLocation()
  const mainRef = React.useRef<HTMLElement | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem("ultra-sidebar-collapsed") === "true"
  })
  const visibleNav = shellNavItems.filter(navItemVisible)

  const activeItem = visibleNav.find((item) => pathMatchesNav(location.pathname, item.to))
  const title = activeItem?.label ?? "Dashboard"

  const sidebarItems = React.useMemo<SidebarNavItem[]>(
    () =>
      visibleNav
        .map((i) => ({ id: i.id, label: i.label, to: i.to, icon: i.icon, group: i.group })),
    [visibleNav]
  )

  React.useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" })
  }, [location.pathname])

  React.useEffect(() => {
    document.documentElement.classList.add("app-shell-scroll-lock")
    document.body.classList.add("app-shell-scroll-lock")
    return () => {
      document.documentElement.classList.remove("app-shell-scroll-lock")
      document.body.classList.remove("app-shell-scroll-lock")
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("ultra-sidebar-collapsed", String(sidebarCollapsed))
  }, [sidebarCollapsed])

  return (
    <div className="flex h-svh min-h-0 w-full overflow-hidden bg-gray-50 text-foreground print:block print:h-auto print:overflow-visible print:bg-white">
      <AppSidebar items={sidebarItems} collapsed={sidebarCollapsed} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <AppNavbar
          title={title}
          userEmail={userEmail}
          onSignOut={onSignOut}
          onRefreshProfile={onRefreshProfile}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        />

        <main
          ref={mainRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 print:overflow-visible print:px-0 print:py-0"
        >
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  )
}
