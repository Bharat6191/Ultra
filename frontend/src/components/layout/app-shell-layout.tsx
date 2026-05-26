import * as React from "react"
import {
  BadgeIndianRupee,
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
import { hasPermission } from "@/lib/permissions"
import type { SidebarNavItem } from "@/components/layout/AppSidebar"

type NavPerm = string | string[] | null

type ShellNavItem = {
  id: string
  label: string
  icon: LucideIcon
  to: string
  permission: NavPerm
}

const shellNavItems: ShellNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/dashboard", permission: null },
  { id: "users", label: "Users", icon: Users, to: "/dashboard/users", permission: "users.view" },
  {
    id: "tasks",
    label: "My Tasks",
    icon: ClipboardList,
    to: "/dashboard/tasks",
    permission: ["approval.view", "task.view"],
  },
  {
    id: "plants",
    label: "Clusters & Plants",
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
    permission: ["settings.view", "settings.update"],
  },
  {
    id: "contractors",
    label: "Contractors",
    icon: BriefcaseBusiness,
    to: "/dashboard/contractors",
    permission: "contractor.view",
  },
  {
    id: "part-master",
    label: "Part master",
    icon: BadgeIndianRupee,
    to: "/dashboard/part-master",
    permission: ["part_master.view", "part_master.create", "part_master.update"],
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
  },
  {
    id: "work-orders",
    label: "Work Orders",
    icon: BriefcaseBusiness,
    to: "/dashboard/work-orders",
    permission: ["work_orders.view", "work_orders.create", "work_orders.update", "work_orders.approve"],
  },
  {
    id: "invoices",
    label: "Invoices",
    icon: Receipt,
    to: "/dashboard/invoices",
    permission: ["invoices.view", "invoices.create", "invoices.update", "invoices.validate"],
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
  const visibleNav = shellNavItems.filter(navItemVisible)

  const activeItem = visibleNav.find((item) => pathMatchesNav(location.pathname, item.to))
  const title = activeItem?.label ?? "Dashboard"

  const sidebarItems = React.useMemo<SidebarNavItem[]>(
    () =>
      visibleNav
        .map((i) => ({ id: i.id, label: i.label, to: i.to, icon: i.icon })),
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

  return (
    <div className="flex h-svh min-h-0 w-full overflow-hidden bg-gray-50 text-foreground">
      <AppSidebar items={sidebarItems} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppNavbar
          title={title}
          userEmail={userEmail}
          onSignOut={onSignOut}
          onRefreshProfile={onRefreshProfile}
        />

        <main ref={mainRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  )
}
