import * as React from "react"
import { Bell } from "lucide-react"

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
}: AppNavbarProps) {
  const initials = React.useMemo(() => computeInitials(userEmail), [userEmail])

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-6">
      <h1 className="truncate text-sm font-medium text-zinc-950">{title}</h1>

      <div className="flex items-center gap-2">
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

