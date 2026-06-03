import * as React from "react"
import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CollapsibleAuditListProps<T> = {
  items: T[]
  renderItem: (item: T, index: number, visibleItems: T[]) => React.ReactNode
  initialVisibleCount?: number
  className?: string
  showMoreLabel?: (hiddenCount: number) => string
  hideLabel?: string
}

export function CollapsibleAuditList<T>({
  items,
  renderItem,
  initialVisibleCount = 1,
  className,
  showMoreLabel = (hiddenCount) => `Show ${hiddenCount} More`,
  hideLabel = "Hide Older Entries",
}: CollapsibleAuditListProps<T>) {
  const [expanded, setExpanded] = React.useState(false)

  React.useEffect(() => {
    setExpanded(false)
  }, [items.length])

  const visibleItems = expanded ? items : items.slice(0, initialVisibleCount)
  const hiddenCount = Math.max(0, items.length - initialVisibleCount)

  return (
    <div className={cn("space-y-3", className)}>
      {visibleItems.map((item, index) => renderItem(item, index, visibleItems))}
      {hiddenCount > 0 ? (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((current) => !current)}
          >
            <ChevronDown className={cn("size-4 transition-transform", expanded ? "rotate-180" : "rotate-0")} />
            {expanded ? hideLabel : showMoreLabel(hiddenCount)}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
