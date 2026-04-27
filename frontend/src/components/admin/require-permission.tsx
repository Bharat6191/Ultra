import * as React from "react"

import { AccessDenied } from "@/components/admin/access-denied"
import { hasPermission } from "@/lib/permissions"

export function RequirePermission({
  code,
  anyOf,
  children,
}: {
  code?: string
  /** If set, user needs at least one of these (e.g. ``view`` or legacy ``update``). */
  anyOf?: string[]
  children: React.ReactNode
}) {
  const ok = anyOf?.length
    ? anyOf.some((c) => hasPermission(c))
    : code
      ? hasPermission(code)
      : false
  if (!ok) {
    const label = anyOf?.length ? anyOf.join(" · ") : (code ?? "")
    return <AccessDenied message={`Missing permission: ${label}`} />
  }
  return <>{children}</>
}
