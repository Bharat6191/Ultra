import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"

export type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon: Icon = Search, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border bg-white">
        <Icon className="size-5 opacity-70" aria-hidden />
      </div>
      <div className="text-sm font-medium text-zinc-950">{title}</div>
      {description ? <div className="max-w-sm text-sm text-muted-foreground">{description}</div> : null}
      {action ? (
        <Button
          className="mt-2 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={action.onClick}
          size="sm"
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

