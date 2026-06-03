import type { LucideIcon } from "lucide-react"
import { LayoutDashboard, BriefcaseBusiness } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { AppLogo } from "@/components/layout/AppLogo"
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
  items?: SidebarNavItem[]
  collapsed?: boolean
}

export function AppSidebar({ items = defaultItems, collapsed = false }: AppSidebarProps) {
  const location = useLocation()

  return (
    <aside
      className={cn(
        "hidden h-svh min-h-0 shrink-0 flex-col border-r border-gray-200 bg-gray-50 transition-[width] duration-200 lg:flex print:hidden",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div className={cn("shrink-0 py-5", collapsed ? "px-3" : "px-4")}>
        <AppLogo
          className={cn("mx-auto overflow-hidden", collapsed ? "w-10 justify-start" : "w-[176px]")}
          imageClassName={cn(collapsed ? "w-[176px] max-w-none object-left" : undefined)}
        />
      </div>

      <Separator className="bg-gray-200" />

      <nav
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain py-4",
          collapsed ? "px-2" : "px-3",
        )}
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
                "h-9 w-full rounded-lg text-left font-normal text-zinc-950 hover:bg-muted",
                collapsed ? "justify-center px-0" : "justify-start gap-2 px-3",
                isActive && "bg-muted"
              )}
              title={item.label}
              asChild
            >
              <Link to={item.to}>
                <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            </Button>
          )
        })}
      </nav>
    </aside>
  )
}
