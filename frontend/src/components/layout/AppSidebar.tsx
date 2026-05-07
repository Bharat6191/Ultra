import type { LucideIcon } from "lucide-react"
import { LayoutDashboard, BriefcaseBusiness } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export type SidebarNavItem = {
  id: string
  label: string
  to: string
  icon: LucideIcon
}

const defaultItems: SidebarNavItem[] = [
  { id: "dashboard", label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { id: "contractors", label: "Contractors", to: "/dashboard/contractors", icon: BriefcaseBusiness },
]

function pathMatches(pathname: string, to: string) {
  if (to === "/dashboard") return pathname === "/dashboard" || pathname === "/dashboard/"
  return pathname === to || pathname.startsWith(`${to}/`)
}

export type AppSidebarProps = {
  logoTitle?: string
  logoSubtitle?: string
  items?: SidebarNavItem[]
}

export function AppSidebar({
  logoTitle = "Ultra Workspace",
  logoSubtitle = "Operations",
  items = defaultItems,
}: AppSidebarProps) {
  const location = useLocation()

  return (
    <aside className="hidden h-svh min-h-0 w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50 lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-3 px-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-xs font-semibold text-white">
          UL
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight text-zinc-950">{logoTitle}</div>
          <div className="truncate text-xs text-muted-foreground">{logoSubtitle}</div>
        </div>
      </div>

      <Separator className="bg-gray-200" />

      <nav
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-4"
        aria-label="Workspace"
      >
        {items.map((item) => {
          const Icon = item.icon
          const isActive = pathMatches(location.pathname, item.to)
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              className={cn(
                "h-9 w-full justify-start gap-2 rounded-lg px-3 text-left font-normal text-zinc-950 hover:bg-muted",
                isActive && "bg-muted"
              )}
              asChild
            >
              <Link to={item.to}>
                <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            </Button>
          )
        })}
      </nav>
    </aside>
  )
}

