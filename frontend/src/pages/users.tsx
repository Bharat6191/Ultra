import * as React from "react"
import { Eye, Pencil } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type UserPublic = {
  id: number
  full_name: string
  username: string
  phone: string | null
  email: string | null
  is_active: boolean
  is_superuser: boolean
  role: { id: number; name: string } | null
  org_unit: { id: number; name: string; type: string } | null
  created_at: string
  updated_at: string
}

export function UsersPage() {
  const [users, setUsers] = React.useState<UserPublic[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const canUpdate = hasPermission("users.update")
  const canCreate = hasPermission("users.create")
  const navigate = useNavigate()

  async function load() {
    setError(null)
    try {
      const u = await getJson<UserPublic[]>("/admin/users?skip=0&limit=50")
      setUsers(u)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users")
      setUsers([])
    }
  }

  React.useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-full space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Users</CardTitle>
          <CardDescription>
            Pick a plant and role when creating or editing users. The Plants admin tab is separate and
            uses only Plants (org units) permissions.
          </CardDescription>
          {canCreate ? (
            <CardAction>
              <Button asChild size="sm">
                <Link to="new">Create user</Link>
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-11">Name</TableHead>
                <TableHead className="h-11">Phone</TableHead>
                <TableHead className="h-11">Role</TableHead>
                <TableHead className="h-11">Plant</TableHead>
                <TableHead className="h-11 w-[100px]">Status</TableHead>
                <TableHead className="h-11 w-[150px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users === null ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow
                    key={u.id}
                    className="hover:bg-muted/30"
                  >
                    <TableCell className="text-sm align-top">
                      <button
                        type="button"
                        className="block w-full max-w-[220px] truncate text-left font-medium text-foreground underline-offset-2 hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2"
                        onClick={() => navigate(String(u.id))}
                      >
                        {u.full_name}
                      </button>
                      <div className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">
                        {u.email ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{u.phone ?? "—"}</TableCell>
                    <TableCell className="text-sm">{u.role?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{u.org_unit?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      <Badge
                        variant={u.is_active ? "default" : "secondary"}
                        className={cn(u.is_active && "border-0 bg-primary text-primary-foreground hover:bg-primary")}
                      >
                        {u.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(String(u.id))}
                        >
                          <Eye className="mr-1 size-3.5 opacity-80" aria-hidden />
                          View
                        </Button>
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`${u.id}/edit`)}
                            disabled={u.is_superuser}
                          >
                            <Pencil className="mr-1 size-3.5 opacity-80" aria-hidden />
                            Edit
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
