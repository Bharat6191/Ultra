import type { ComponentProps } from "react"

import type { Badge } from "@/components/ui/badge"

/** Maps work order `status` values to badge variants for list/detail UIs. */
export function workOrderStatusBadgeVariant(
  status: string,
  isActive?: boolean,
): NonNullable<ComponentProps<typeof Badge>["variant"]> {
  if (isActive === false) {
    return "secondary"
  }
  switch (String(status || "").toLowerCase()) {
    case "draft":
      return "secondary"
    case "pending_approval":
      return "warning"
    case "approved":
      return "success"
    case "active":
      return "success"
    case "rejected":
      return "destructive"
    case "cancelled":
      return "ghost"
    case "closed":
      return "outline"
    default:
      return "outline"
  }
}

export function workOrderStatusLabel(status: string, isActive?: boolean): string {
  if (isActive === false) {
    return "Archived"
  }
  switch (String(status || "").toLowerCase()) {
    case "closed":
      return "Completed"
    case "pending_approval":
      return "In approval"
    case "draft":
      return "Draft"
    case "rejected":
      return "Returned"
    default:
      return status
  }
}
