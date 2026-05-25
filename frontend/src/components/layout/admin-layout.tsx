import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Bell, Factory, KeyRound, LayoutDashboard, Link2, Mail, Settings, Shield, Users } from "lucide-react"
import { useLocation } from "react-router-dom"

import { AppLogo } from "@/components/layout/AppLogo"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type NavPerm = string | string[] | null

export type AdminNavId =
  | "overview"
  | "users"
  | "plants"
  | "roles"
  | "permissions"
  | "settings"
  | "workflow-assignment"
  | "email-templates"
  | "notifications"

type NavItem = {
  id: AdminNavId
  label: string
  icon: LucideIcon
  permission: NavPerm
}

const navItems: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, permission: null },
  { id: "users", label: "Users", icon: Users, permission: "users.view" },
  {
    id: "plants",
    label: "Plants",
    icon: Factory,
    permission: ["org_units.view", "org_units.create", "org_units.update", "org_units.delete"],
  },
  {
    id: "roles",
    label: "Roles",
    icon: Shield,
    permission: ["roles.view", "roles.update", "roles.create"],
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: KeyRound,
    permission: ["permissions.view", "permissions.create"],
  },
  {
    id: "workflow-assignment",
    label: "Workflow Assignment",
    icon: Link2,
    permission: "approval.manage",
  },
  {
    id: "email-templates",
    label: "Email Templates",
    icon: Mail,
    permission: ["email_templates.view", "email_templates.create", "email_templates.update", "email_templates.delete"],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    permission: ["notification_settings.manage", "email_templates.manage"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    permission: ["settings.view", "settings.update"],
  },
]

export type AdminLayoutProps = {
  children: React.ReactNode
  /** Overrides the title derived from the active sidebar item */
  pageTitle?: string
  activeId: AdminNavId
  onNavigate: (id: AdminNavId) => void
  userEmail?: string | null
  onSignOut?: () => void
}

export function AdminLayout({
  children,
  pageTitle,
  activeId,
  onNavigate,
  userEmail,
  onSignOut,
}: AdminLayoutProps) {
  const location = useLocation()
  const mainRef = React.useRef<HTMLElement | null>(null)
  const activeLabel = navItems.find((i) => i.id === activeId)?.label ?? "Overview"
  const title = pageTitle ?? activeLabel
  const email = userEmail ?? "—"
  const initials = React.useMemo(() => {
    const raw = (userEmail ?? "").trim()
    if (!raw) return "?"
    const left = raw.split("@")[0] ?? raw
    const parts = left.split(/[.\-_ ]+/).filter(Boolean)
    const a = (parts[0]?.[0] ?? left[0] ?? "?").toUpperCase()
    const b = (parts[1]?.[0] ?? left[1] ?? "").toUpperCase()
    return `${a}${b}`.slice(0, 2)
  }, [userEmail])

  React.useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" })
  }, [location.pathname])

  return (
    <div className="flex h-svh min-h-0 w-full bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="space-y-3 px-4 py-5">
          <AppLogo className="mx-auto w-[164px]" />
          <span className="block text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Admin</span>
        </div>
        <Separator className="bg-sidebar-border" />
        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col gap-0.5 p-2">
            {navItems
              .filter((item) => {
                const p = item.permission
                if (p === null) return true
                if (Array.isArray(p)) return p.some((c) => hasPermission(c))
                return hasPermission(p)
              })
              .map((item) => {
                const Icon = item.icon
                const isActive = activeId === item.id
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "w-full justify-start gap-2 text-left font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      isActive &&
                        "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
                    )}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </Button>
                )
              })}
          </nav>
        </ScrollArea>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
          <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="rounded-full">
                <Avatar size="sm">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <span className="text-xs text-muted-foreground">Signed in</span>
                <div className="truncate text-sm font-medium">{email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  onSignOut?.()
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main ref={mainRef} className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
