import * as React from "react"
import { LayoutGrid, LogOut, Settings2, User2 } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"

export type AppLayoutProps = {
  children: React.ReactNode
  pageTitle?: string
  userEmail?: string | null
  onSignOut?: () => void
}

export function AppLayout({ children, pageTitle, userEmail, onSignOut }: AppLayoutProps) {
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
    <div className="min-h-svh bg-gray-50 text-foreground">
      <header className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center">
            <AppLogo className="w-[118px]" />
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block text-right">
              <div className="text-xs text-muted-foreground">Signed in</div>
              <div className="max-w-[240px] truncate text-sm font-medium">{userEmail ?? "—"}</div>
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
                  <span className="text-xs text-muted-foreground">Account</span>
                  <div className="truncate text-sm font-medium">{userEmail ?? "—"}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <LayoutGrid className="mr-2 size-4 opacity-70" aria-hidden />
                  Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <User2 className="mr-2 size-4 opacity-70" aria-hidden />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings2 className="mr-2 size-4 opacity-70" aria-hidden />
                  Settings
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
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {pageTitle ? (
          <div className="mb-6">
            <h1 className="text-lg font-semibold tracking-tight">{pageTitle}</h1>
            <Separator className="mt-4" />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}
