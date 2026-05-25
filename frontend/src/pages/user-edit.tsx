import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
  employee_code?: string | null
  department?: string | null
  designation?: string | null
  address?: string | null
  is_active: boolean
  is_superuser: boolean
  roles?: { id: number; name: string }[]
  role: { id: number; name: string } | null
  org_unit: { id: number; name: string; type: string } | null
  created_at: string
  updated_at: string
}

const editUserSchema = z.object({
  full_name: z.string().min(1, "Full name is required").max(255),
  username: z.string().min(3, "Username is required").max(64),
  phone: z.string().trim().regex(/^\d{10}$/, "Phone must be exactly 10 digits"),
  email: z.string().email("Enter a valid email"),
  employee_code: z.string().max(64).optional(),
  department: z.string().max(128).optional(),
  designation: z.string().max(128).optional(),
  address: z.string().max(5000).optional(),
  role_ids: z.array(z.number()).min(1, "Select at least one role"),
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
      employee_code: "",
      department: "",
      designation: "",
      address: "",
      role_ids: [] as number[],
      org_unit_id: "",
      is_active: true,
    },
    mode: "onSubmit",
  })

  const plantId = form.watch("org_unit_id")
  const phoneField = form.register("phone")

  React.useEffect(() => {
    if (!roles) return
    const allowed = new Set(rolesForPlant(roles, plantId).map((r) => r.id))
    const cur = form.getValues("role_ids")
    const next = cur.filter((id) => allowed.has(id))
    if (next.length !== cur.length) {
      form.setValue("role_ids", next, { shouldValidate: true })
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
            employee_code: u.employee_code ?? "",
            department: u.department ?? "",
            designation: u.designation ?? "",
            address: u.address ?? "",
            role_ids:
              u.roles && u.roles.length > 0
                ? u.roles.map((r) => r.id)
                : u.role?.id != null
                  ? [u.role.id]
                  : [],
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
      const orgUnitId = Number(values.org_unit_id)
      if (!values.role_ids.length) {
        toast.error("Select at least one role", { id: "edit-user" })
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
        employee_code: values.employee_code?.trim() || null,
        department: values.department?.trim() || null,
        designation: values.designation?.trim() || null,
        address: values.address?.trim() || null,
        role_ids: values.role_ids,
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
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold tracking-tight">Edit user</h2>
        <Button asChild variant="outline" size="xs">
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
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-base">{user.full_name}</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-full-name" showRequired>
                    Full name
                  </Label>
                  <Input id="edit-full-name" {...form.register("full_name")} disabled={user.is_superuser} />
                  {form.formState.errors.full_name?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-username" showRequired>
                    Username
                  </Label>
                  <Input id="edit-username" autoComplete="username" {...form.register("username")} disabled={user.is_superuser} />
                  {form.formState.errors.username?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-phone" showRequired>
                    Phone
                  </Label>
                  <Input
                    id="edit-phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit phone number"
                    {...phoneField}
                    onChange={(e) => {
                      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10)
                      phoneField.onChange(e)
                    }}
                    disabled={user.is_superuser}
                  />
                  {form.formState.errors.phone?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-email" showRequired>
                    Email
                  </Label>
                  <Input id="edit-email" type="email" {...form.register("email")} disabled={user.is_superuser} />
                  {form.formState.errors.email?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-employee-code">Employee code</Label>
                  <Input id="edit-employee-code" {...form.register("employee_code")} disabled={user.is_superuser} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-department">Department</Label>
                  <Input id="edit-department" {...form.register("department")} disabled={user.is_superuser} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-designation">Designation</Label>
                  <Input id="edit-designation" {...form.register("designation")} disabled={user.is_superuser} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-address">Address</Label>
                  <textarea
                    id="edit-address"
                    className="min-h-[60px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    {...form.register("address")}
                    disabled={user.is_superuser}
                  />
                </div>

                <div className="space-y-2">
                  <Label showRequired>Plant</Label>
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

                <div className="space-y-2 sm:col-span-2">
                  <Label showRequired>Roles</Label>
                  <p className="text-xs text-muted-foreground">Select every role this user should have.</p>
                  <div className="mt-2 max-h-28 overflow-y-auto rounded-md border border-input bg-muted/20 p-2.5">
                    {rolesForPlant(roles, plantId).length === 0 ? (
                      <p className="text-xs text-muted-foreground">Pick a plant to see roles.</p>
                    ) : (
                      <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                        {rolesForPlant(roles, plantId).map((r) => {
                          const checked = form.watch("role_ids").includes(r.id)
                          return (
                            <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm leading-5">
                              <Checkbox
                                checked={checked}
                                disabled={user.is_superuser}
                                onCheckedChange={(v) => {
                                  const on = v === true
                                  const cur = form.getValues("role_ids")
                                  const next = on ? [...new Set([...cur, r.id])] : cur.filter((id) => id !== r.id)
                                  form.setValue("role_ids", next, { shouldDirty: true, shouldValidate: true })
                                }}
                              />
                              <span>{r.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {form.formState.errors.role_ids?.message ? (
                    <p className="text-xs text-destructive">{String(form.formState.errors.role_ids.message)}</p>
                  ) : null}
                </div>

                <div className="sm:col-span-2 rounded-md border border-input bg-muted/10 px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center justify-between gap-3 sm:flex-1">
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

                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => navigate("..")} disabled={form.formState.isSubmitting}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={form.formState.isSubmitting || user.is_superuser}>
                        {form.formState.isSubmitting ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
