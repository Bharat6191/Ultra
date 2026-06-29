import * as React from "react"
import { Bell, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { SessionExpiryBadge } from "@/components/layout/session-expiry-badge"
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

export type AppNavbarProps = {
  title: string
  userEmail?: string | null
  onSignOut?: () => void
  onSessionExpired?: () => void
  onRefreshProfile?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onOpenMobileNav?: () => void
}

function computeInitials(email?: string | null) {
  const raw = (email ?? "").trim()
  if (!raw) return "?"
  const left = raw.split("@")[0] ?? raw
  const parts = left.split(/[.\-_ ]+/).filter(Boolean)
  const a = (parts[0]?.[0] ?? left[0] ?? "?").toUpperCase()
  const b = (parts[1]?.[0] ?? left[1] ?? "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}

export function AppNavbar({
  title,
  userEmail,
  onSignOut,
  onSessionExpired,
  onRefreshProfile,
  sidebarCollapsed = false,
  onToggleSidebar,
  onOpenMobileNav,
}: AppNavbarProps) {
  const initials = React.useMemo(() => computeInitials(userEmail), [userEmail])
  const [refreshing, setRefreshing] = React.useState(false)

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 print:hidden">
      <div className="flex min-w-0 items-center gap-2">
        {onOpenMobileNav ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg lg:hidden"
            aria-label="Open navigation"
            onClick={onOpenMobileNav}
          >
            <PanelLeftOpen className="size-4 opacity-70" aria-hidden />
          </Button>
        ) : null}
        {onToggleSidebar ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden rounded-lg lg:inline-flex"
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={onToggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="size-4 opacity-70" aria-hidden /> : <PanelLeftClose className="size-4 opacity-70" aria-hidden />}
          </Button>
        ) : null}
        <h1 className="truncate text-sm font-medium text-zinc-950">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        <SessionExpiryBadge onExpired={onSessionExpired ?? onSignOut} className="shrink-0" />
        <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg" aria-label="Notifications">
          <Bell className="size-4 opacity-70" aria-hidden />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-10 gap-2 rounded-full px-2">
              <Avatar className="size-9">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[180px] truncate text-sm font-medium text-zinc-950 sm:inline">
                {userEmail ?? "—"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="text-xs text-muted-foreground">Signed in</span>
              <div className="truncate text-sm font-medium">{userEmail ?? "—"}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            {onRefreshProfile ? (
              <DropdownMenuItem
                disabled={refreshing}
                onSelect={(e) => {
                  e.preventDefault()
                  setRefreshing(true)
                  toast.loading("Refreshing your permissions…", {
                    id: "refresh-perms",
                  })
                  try {
                    onRefreshProfile()
                  } finally {
                    // The refresh kicks off async work; give the UI a tick to
                    // re-render with the new RBAC snapshot before resetting.
                    setTimeout(() => {
                      setRefreshing(false)
                      toast.success("Permissions refreshed.", { id: "refresh-perms" })
                    }, 600)
                  }
                }}
              >
                <RefreshCw className="size-4 opacity-70" />
                <span>Refresh permissions</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
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
      </div>
    </header>
  )
}
