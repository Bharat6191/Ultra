import type { ComponentProps } from "react"

import type { Badge } from "@/components/ui/badge"

/** Maps work order `status` values to badge variants for list/detail UIs. */
export function workOrderStatusBadgeVariant(
  status: string,
): NonNullable<ComponentProps<typeof Badge>["variant"]> {
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
