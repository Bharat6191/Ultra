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
import { Link, useLocation } from "react-router-dom"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { hasAnyNonUsersRbacPermission, hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

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
    permission: "approval.view",
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

  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false)
  React.useEffect(() => {
    try {
      setIsSidebarCollapsed(localStorage.getItem("ui.sidebarCollapsed") === "1")
    } catch {
      // ignore
    }
  }, [])
  function toggleSidebar() {
    setIsSidebarCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem("ui.sidebarCollapsed", next ? "1" : "0")
      } catch {
        // ignore
      }
      return next
    })
  }

  const initials = React.useMemo(() => {
    const raw = (userEmail ?? "").trim()
    if (!raw) return "?"
    const left = raw.split("@")[0] ?? raw
    const parts = left.split(/[.\-_ ]+/).filter(Boolean)
    const a = (parts[0]?.[0] ?? left[0] ?? "?").toUpperCase()
    const b = (parts[1]?.[0] ?? left[1] ?? "").toUpperCase()
    return `${a}${b}`.slice(0, 2)
  }, [userEmail])

  return (
    <div className="flex h-svh min-h-0 w-full bg-gray-50 text-foreground">
      <aside
        className={cn(
          "hidden min-h-0 shrink-0 flex-col border-r bg-white transition-[width] duration-200 lg:flex",
          isSidebarCollapsed ? "w-16" : "w-64"
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-3", isSidebarCollapsed ? "px-3" : "px-4")}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-xs font-semibold text-primary-foreground">
            UL
          </div>
          {!isSidebarCollapsed ? (
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold tracking-tight">Ultra Workspace</div>
              <div className="text-xs text-muted-foreground">Operations</div>
            </div>
          ) : null}
        </div>
        <Separator className="shrink-0" />
        <div className="flex min-h-0 flex-1 flex-col">
          <nav className={cn("flex flex-col gap-0.5", isSidebarCollapsed ? "p-2" : "p-2")} aria-label="Workspace">
            {visibleNav.map((item) => {
              const Icon = item.icon
              const isActive = pathMatchesNav(location.pathname, item.to)
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={cn(
                    "h-9 w-full text-left font-normal",
                    isSidebarCollapsed ? "justify-center px-0" : "justify-start gap-2",
                    "hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted text-foreground hover:bg-muted"
                  )}
                  asChild
                >
                  <Link to={item.to}>
                    <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                    {!isSidebarCollapsed ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                </Button>
              )
            })}
          </nav>
          {!isSidebarCollapsed ? (
            <div className="mt-auto border-t border-border/60 p-3">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
                Master data and admin tasks appear here when your role allows.
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-white px-5 lg:px-6">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden lg:inline-flex"
              onClick={toggleSidebar}
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeft className="size-4 opacity-80" aria-hidden />
            </Button>
            <div className="flex flex-col">
              <h1 className="truncate text-sm font-medium">{title}</h1>
              <div className="truncate text-xs text-muted-foreground lg:hidden">Ultra Workspace</div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="rounded-full">
                <Avatar size="sm">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <span className="text-xs text-muted-foreground">Signed in</span>
                <div className="truncate text-sm font-medium">{userEmail ?? "—"}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User2 className="mr-2 size-4 opacity-70" aria-hidden />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings2 className="mr-2 size-4 opacity-70" aria-hidden />
                Preferences
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  onSignOut?.()
                }}
              >
                <LogOut className="mr-2 size-4 opacity-70" aria-hidden />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-5 lg:px-8 lg:py-6">
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  )
}
