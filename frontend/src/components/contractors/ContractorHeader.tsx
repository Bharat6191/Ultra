import { ArrowLeft, MoreHorizontal } from "lucide-react"
import { Link } from "react-router-dom"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import {
  complianceLabel,
  complianceVariant,
  contractorTypeLabel,
  statusLabel,
  statusVariant,
} from "./status"

function initials(name: string) {
  const parts = name.trim().split(/[ ._-]+/).filter(Boolean)
  const a = (parts[0]?.[0] ?? name[0] ?? "?").toUpperCase()
  const b = (parts[1]?.[0] ?? name[1] ?? "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}

export type ContractorHeaderProps = {
  name: string
  legalName?: string | null
  contractorCode?: string | null
  contractorType?: string | null
  status: string
  complianceState?: string | null
  isActive: boolean
  canEdit: boolean
  canActivate: boolean
  onEdit?: () => void
  onActivate?: () => void
  onSuspend?: () => void
  onBlacklist?: () => void
  onViewAudit?: () => void
}

export function ContractorHeader(props: ContractorHeaderProps) {
  const {
    name,
    legalName,
    contractorCode,
    contractorType,
    status,
    complianceState,
    isActive,
    canEdit,
    canActivate,
    onEdit,
    onActivate,
    onSuspend,
    onBlacklist,
    onViewAudit,
  } = props
  const display = legalName || name
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Button asChild variant="ghost" size="icon-sm" className="rounded-lg" aria-label="Back to list">
            <Link to="/dashboard/contractors">
              <ArrowLeft className="size-4 opacity-70" aria-hidden />
            </Link>
          </Button>
          <Avatar className="h-12 w-12 rounded-2xl">
            <AvatarFallback className="rounded-2xl bg-emerald-50 text-sm font-semibold text-emerald-700">
              {initials(display)}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{display}</h1>
              <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
              {complianceState ? (
                <Badge variant={complianceVariant(complianceState)}>
                  {complianceLabel(complianceState)}
                </Badge>
              ) : null}
              {!isActive ? (
                <Badge variant="secondary" className="bg-zinc-100 text-zinc-700">
                  Disabled
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {contractorCode ? (
                <span>
                  <span className="text-zinc-500">Code:</span>{" "}
                  <span className="font-mono text-zinc-700">{contractorCode}</span>
                </span>
              ) : null}
              {contractorType ? <span>{contractorTypeLabel(contractorType)}</span> : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && onEdit ? (
            <Button size="sm" variant="outline" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MoreHorizontal className="mr-2 size-4 opacity-70" aria-hidden />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Lifecycle</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canActivate || !onActivate || status === "active"}
                onSelect={(e) => {
                  e.preventDefault()
                  onActivate?.()
                }}
              >
                Activate
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canActivate || !onSuspend || status === "suspended"}
                onSelect={(e) => {
                  e.preventDefault()
                  onSuspend?.()
                }}
              >
                Suspend
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canActivate || !onBlacklist || status === "blacklisted"}
                onSelect={(e) => {
                  e.preventDefault()
                  onBlacklist?.()
                }}
                className="text-destructive focus:text-destructive"
              >
                Blacklist
              </DropdownMenuItem>
              {onViewAudit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault()
                      onViewAudit?.()
                    }}
                  >
                    View audit trail
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
