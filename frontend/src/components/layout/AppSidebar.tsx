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
  group?: string
}

const defaultItems: SidebarNavItem[] = [
  { id: "dashboard", label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, group: "Operations" },
  { id: "contractors", label: "Contractors", to: "/dashboard/contractors", icon: BriefcaseBusiness, group: "Operations" },
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
  const groupedItems = items.reduce<Array<{ group: string; items: SidebarNavItem[] }>>((acc, item) => {
    const group = item.group ?? "Menu"
    const existing = acc.find((entry) => entry.group === group)
    if (existing) {
      existing.items.push(item)
    } else {
      acc.push({ group, items: [item] })
    }
    return acc
  }, [])

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
          "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain py-4",
          collapsed ? "px-2" : "px-3",
        )}
        aria-label="Workspace"
      >
        {groupedItems.map((section) => (
          <div key={section.group} className="space-y-1">
            {!collapsed ? (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {section.group}
              </div>
            ) : null}
            {section.items.map((item) => {
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
          </div>
        ))}
      </nav>
    </aside>
  )
}
