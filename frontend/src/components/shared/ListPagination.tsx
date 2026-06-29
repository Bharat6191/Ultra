import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ListPaginationProps = {
  page: number
  pageSize: number
  total: number
  loading?: boolean
  onPageChange: (page: number) => void
  className?: string
}

export function ListPagination({
  page,
  pageSize,
  total,
  loading = false,
  onPageChange,
  className,
}: ListPaginationProps) {
  if (total <= 0) return null

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const rangeStart = safePage * pageSize + 1
  const rangeEnd = Math.min(total, (safePage + 1) * pageSize)

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3", className)}>
      <p className="text-xs text-muted-foreground">
        Showing {rangeStart}–{rangeEnd} of {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2"
          disabled={safePage <= 0 || loading}
          onClick={() => onPageChange(Math.max(0, safePage - 1))}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground">
          {safePage + 1} / {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2"
          disabled={safePage >= pageCount - 1 || loading}
          onClick={() => onPageChange(Math.min(pageCount - 1, safePage + 1))}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
