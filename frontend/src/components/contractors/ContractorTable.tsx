import * as React from "react"
import { useNavigate } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type ContractorRow = {
  id: number
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  is_active: boolean
}

export function ContractorTable({ rows }: { rows: ContractorRow[] | null }) {
  const navigate = useNavigate()

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="h-11">Name</TableHead>
          <TableHead className="h-11">Contact person</TableHead>
          <TableHead className="h-11">Email</TableHead>
          <TableHead className="h-11">Phone</TableHead>
          <TableHead className="h-11 w-[120px]">Status</TableHead>
          <TableHead className="h-11 w-[120px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows === null ? (
          <TableRow>
            <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
              Loading…
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
              No contractors found.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((c) => (
            <TableRow
              key={c.id}
              className="cursor-pointer hover:bg-muted/30"
              onClick={() => navigate(`/dashboard/contractors/${c.id}`)}
            >
              <TableCell className="text-sm font-medium">{c.name}</TableCell>
              <TableCell className="text-sm">{c.contact_person ?? "—"}</TableCell>
              <TableCell className="text-sm">{c.email ?? "—"}</TableCell>
              <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
              <TableCell className="text-sm">
                <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/contractors/${c.id}`)}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

