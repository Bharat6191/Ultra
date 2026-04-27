import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ApiError, getJson, patchJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

type RoleListItem = { id: number; name: string; org_unit_ids?: number[] }

function rolesForPlant(all: RoleListItem[] | null, plantId: string): RoleListItem[] {
  if (!all) return []
  const pid = Number(plantId)
  if (!plantId || !Number.isFinite(pid)) return all
  return all.filter((r) => {
    const ids = r.org_unit_ids ?? []
    if (ids.length === 0) return true
    return ids.includes(pid)
  })
}

type OrgUnitPublic = {
  id: number
  name: string
  type: string
  parent_id: number | null
  created_at: string
  updated_at: string
}

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

const editUserSchema = z.object({
  full_name: z.string().min(1, "Full name is required").max(255),
  username: z.string().min(3, "Username is required").max(64),
  phone: z.string().min(3, "Phone is required").max(32),
  email: z.string().email("Enter a valid email"),
  role_id: z.string().min(1, "Role is required"),
  org_unit_id: z.string().min(1, "Plant is required"),
  is_active: z.boolean(),
})

type EditUserValues = z.infer<typeof editUserSchema>

export function UserEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [user, setUser] = React.useState<UserPublic | null>(null)
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const canLoadPlantList = canListOrgUnitsForAssignments()

  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      full_name: "",
      username: "",
      phone: "",
      email: "",
      role_id: "",
      org_unit_id: "",
      is_active: true,
    },
    mode: "onSubmit",
  })

  const plantId = form.watch("org_unit_id")

  React.useEffect(() => {
    if (!roles) return
    const rid = form.getValues("role_id")
    if (!rid) return
    if (!rolesForPlant(roles, plantId).some((r) => String(r.id) === rid)) {
      form.setValue("role_id", "")
    }
  }, [plantId, roles, form])

  React.useEffect(() => {
    const userId = Number(id)
    if (!hasPermission("users.update") || !Number.isFinite(userId) || userId <= 0) {
      navigate("..", { replace: true })
      return
    }
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [all, r] = await Promise.all([
          getJson<UserPublic[]>("/admin/users?skip=0&limit=200"),
          getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200"),
        ])
        const u = all.find((x) => x.id === userId) ?? null
        setUser(u)
        setRoles(r)
        if (canLoadPlantList) {
          try {
            const p = await getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT")
            setPlants(p)
          } catch {
            setPlants([])
          }
        } else {
          setPlants([])
        }

        if (u) {
          form.reset({
            full_name: u.full_name,
            username: u.username ?? "",
            phone: u.phone ?? "",
            email: u.email ?? "",
            role_id: u.role?.id ? String(u.role.id) : "",
            org_unit_id: u.org_unit?.id ? String(u.org_unit.id) : "",
            is_active: u.is_active,
          })
        }
      } catch (e) {
        const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load user"
        setError(message)
      } finally {
        setLoading(false)
      }
    })()
  }, [id, navigate, canLoadPlantList, form])

  async function onSubmit(values: EditUserValues) {
    if (!user) return
    toast.loading("Saving user…", { id: "edit-user" })
    setError(null)
    try {
      const email = values.email.trim()
      const roleId = Number(values.role_id)
      const orgUnitId = Number(values.org_unit_id)
      if (!Number.isFinite(roleId) || roleId <= 0) {
        toast.error("Role is required", { id: "edit-user" })
        return
      }
      if (!Number.isFinite(orgUnitId) || orgUnitId <= 0) {
        toast.error("Plant is required", { id: "edit-user" })
        return
      }
      await patchJson<UserPublic>(`/admin/users/${user.id}`, {
        full_name: values.full_name.trim(),
        username: values.username.trim(),
        phone: values.phone.trim(),
        email,
        role_id: roleId,
        org_unit_id: orgUnitId,
        is_active: values.is_active,
      })
      toast.success("User updated", { id: "edit-user" })
      navigate(`../${user.id}`, { replace: true })
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to update user"
      toast.error(message, { id: "edit-user" })
      setError(message)
    }
  }

  if (loading) {
    return (
      <div className="w-full space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Edit user</h2>
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="..">Back</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Edit user</h2>
          <p className="text-sm text-muted-foreground">Update profile, plant, role, and status.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="..">Back</Link>
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!user ? (
        <Alert>
          <AlertTitle>User not found</AlertTitle>
          <AlertDescription>This user may have been deleted or is outside the loaded range.</AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{user.full_name}</CardTitle>
            <CardDescription>Make changes and save.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="edit-full-name">Full name</Label>
                  <Input id="edit-full-name" {...form.register("full_name")} disabled={user.is_superuser} />
                  {form.formState.errors.full_name?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="edit-username">Username</Label>
                  <Input id="edit-username" autoComplete="username" {...form.register("username")} disabled={user.is_superuser} />
                  {form.formState.errors.username?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input id="edit-phone" {...form.register("phone")} disabled={user.is_superuser} />
                  {form.formState.errors.phone?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input id="edit-email" type="email" {...form.register("email")} disabled={user.is_superuser} />
                  {form.formState.errors.email?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Plant</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    {...form.register("org_unit_id")}
                    disabled={user.is_superuser}
                  >
                    <option value="">Select a plant…</option>
                    {(plants ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {form.formState.errors.org_unit_id?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.org_unit_id.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Role</Label>
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" {...form.register("role_id")} disabled={user.is_superuser}>
                    <option value="">Select a role…</option>
                    {rolesForPlant(roles, plantId).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {form.formState.errors.role_id?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.role_id.message}</p>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-3 sm:col-span-2">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Active</div>
                    <div className="text-xs text-muted-foreground">Inactive users cannot sign in.</div>
                  </div>
                  <Switch
                    checked={form.watch("is_active")}
                    onCheckedChange={(v) => form.setValue("is_active", v, { shouldDirty: true })}
                    disabled={user.is_superuser}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => navigate("..")} disabled={form.formState.isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting || user.is_superuser}>
                  {form.formState.isSubmitting ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

