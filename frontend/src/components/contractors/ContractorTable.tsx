import { useNavigate } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Building2 } from "lucide-react"

import {
  // complianceLabel,
  // complianceVariant,
  contractorTypeLabel,
  statusLabel,
  statusVariant,
} from "./status"

export type ContractorComplianceSummary = {
  state: "compliant" | "warning" | "non_compliant" | "no_data"
  expired_documents: number
  expiring_soon: number
  pending_verification: number
  missing_critical_types: string[]
  next_expiry: string | null
}

export type ContractorRow = {
  id: number
  contractor_code?: string | null
  name: string
  legal_name?: string | null
  contractor_type?: string | null
  status?: string | null
  contact_person?: string | null
  email?: string | null
  phone?: string | null
  pan?: string | null
  gstin?: string | null
  is_active: boolean
  plant_count?: number
  compliance?: ContractorComplianceSummary | null
  created_at?: string
}

function initialsFromName(name: string) {
  const parts = name
    .trim()
    .split(/[.\-_ ]+/)
    .filter(Boolean)
  const a = (parts[0]?.[0] ?? name[0] ?? "?").toUpperCase()
  const b = (parts[1]?.[0] ?? name[1] ?? "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}

export function ContractorTable({
  rows,
  loading = false,
}: {
  rows: ContractorRow[] | null
  loading?: boolean
}) {
  const navigate = useNavigate()

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-gray-50">
          <TableHead>Contractor</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          {/* <TableHead>Compliance</TableHead> */}
          <TableHead>Plants</TableHead>
          {/* <TableHead>Statutory IDs</TableHead> */}
          {/* <TableHead className="w-[72px] text-right">Actions</TableHead> */}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading || rows === null ? (
          <TableRow>
            <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
              Loading…
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
              No contractors match this filter.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((c) => {
            const display = c.legal_name || c.name
            const subtitle = c.contractor_code || c.contact_person || c.email || `ID #${c.id}`
            return (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => navigate(`/dashboard/contractors/${c.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 rounded-xl">
                      <AvatarFallback className="rounded-xl bg-emerald-50 text-[12px] font-medium text-emerald-700">
                        {initialsFromName(display)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-950">{display}</div>
                      <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="text-sm text-zinc-700">
                  {c.contractor_type ? (
                    <Badge variant="secondary" className="bg-zinc-50 text-zinc-700">
                      {contractorTypeLabel(c.contractor_type)}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell>
                  <Badge variant={statusVariant(c.status)}>{statusLabel(c.status)}</Badge>
                </TableCell>

                {/* <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={
                        "inline-block h-2 w-2 rounded-full " +
                        (compliance === "compliant"
                          ? "bg-emerald-500"
                          : compliance === "warning"
                          ? "bg-amber-500"
                          : compliance === "non_compliant"
                          ? "bg-red-500"
                          : "bg-zinc-300")
                      }
                    />
                    <Badge variant={complianceVariant(compliance)}>
                      {complianceLabel(compliance)}
                    </Badge>
                  </div>
                </TableCell> */}

                <TableCell>
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-zinc-700">
                    <Building2 className="size-3 opacity-70" aria-hidden />
                    {c.plant_count ?? 0}
                  </div>
                </TableCell>

                {/*
                <TableCell className="text-xs text-zinc-700">
                  <div className="space-y-0.5">
                    <div>
                      <span className="text-muted-foreground">PAN: </span>
                      <span className="font-mono">{c.pan || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">GSTIN: </span>
                      <span className="font-mono">{c.gstin || "—"}</span>
                    </div>
                  </div>
                </TableCell>
                */}
                {/*
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="rounded-lg" aria-label="Row actions">
                        <MoreHorizontal className="size-4 opacity-70" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault()
                          navigate(`/dashboard/contractors/${c.id}`)
                        }}
                      >
                        <Eye className="mr-2 size-4 opacity-70" aria-hidden />
                        View
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault()
                          navigate(`/dashboard/contractors/${c.id}/edit`)
                        }}
                      >
                        <Pencil className="mr-2 size-4 opacity-70" aria-hidden />
                        Edit
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
                */}
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
