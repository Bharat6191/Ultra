import * as React from "react"
import { toast } from "sonner"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { ApiError, getJson, patchJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

type OrgUnit = { id: number; name: string; type: string }

type AuthPolicy = {
  company_id: number
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
}

export function AuthSettingsPage() {
  const canView = hasPermission("auth_policy.view")
  const canUpdate = hasPermission("auth_policy.update")
  const [companies, setCompanies] = React.useState<OrgUnit[]>([])
  const [companyId, setCompanyId] = React.useState<number | null>(null)
  const [pol, setPol] = React.useState<AuthPolicy | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const loadCompanies = React.useCallback(async () => {
    setLoading(true)
    try {
      // Prefer explicit company org units, but fall back to any org unit
      // so existing installs (that only have plants) still work.
      let all: OrgUnit[] = []
      try {
        all = await getJson<OrgUnit[]>("/admin/org-units?type=company")
      } catch {
        all = []
      }
      if (!all.length) {
        all = await getJson<OrgUnit[]>("/admin/org-units")
      }
      setCompanies(all)
      setCompanyId((prev) => prev ?? (all[0]?.id ?? null))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load companies.")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPolicy = React.useCallback(async () => {
    if (!companyId) {
      setPol(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const p = await getJson<AuthPolicy>(`/admin/auth-policy?company_id=${companyId}`)
      setPol(p)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load policy.")
      setPol(null)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  React.useEffect(() => {
    void loadCompanies()
  }, [loadCompanies])

  React.useEffect(() => {
    if (companyId) void loadPolicy()
  }, [companyId, loadPolicy])

  async function save(next: Partial<AuthPolicy>) {
    if (!companyId || !canUpdate) return
    setSaving(true)
    try {
      const p = await patchJson<AuthPolicy>(`/admin/auth-policy?company_id=${companyId}`, {
        password_enabled: next.password_enabled,
        mfa_enabled: next.mfa_enabled,
        captcha_enabled: next.captcha_enabled,
        mfa_enforced: next.mfa_enforced,
      })
      setPol(p)
      toast.success("Policy saved.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return <p className="text-sm text-muted-foreground">You do not have access to auth policy settings.</p>
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Authentication Policy</h2>
        <p className="text-sm text-muted-foreground">Per-company sign-in, MFA, and captcha. Superusers are not affected.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Company</CardTitle>
          <CardDescription>Select the company org unit to configure.</CardDescription>
        </CardHeader>
        <CardContent>
          {companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No org units found. Create one under Plants first.
            </p>
          ) : (
            <select
              className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
              value={companyId ?? ""}
              onChange={(e) => setCompanyId(Number(e.target.value))}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.type ? `(${c.type})` : ""}
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !companyId ? (
        <p className="text-sm text-muted-foreground">Select a company to edit its policy.</p>
      ) : !pol ? (
        <p className="text-sm text-muted-foreground">Could not load policy for the selected company.</p>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Policy</CardTitle>
            <CardDescription>Enforcement applies to workspace users in this company.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Password sign-in</div>
                <div className="text-xs text-muted-foreground">Allow email/phone + password.</div>
              </div>
              <Switch
                checked={pol.password_enabled}
                disabled={!canUpdate || saving}
                onCheckedChange={(v) => {
                  setPol({ ...pol, password_enabled: v })
                  void save({ ...pol, password_enabled: v })
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">MFA (TOTP)</div>
                <div className="text-xs text-muted-foreground">Require authenticator for users who have enrolled.</div>
              </div>
              <Switch
                checked={pol.mfa_enabled}
                disabled={!canUpdate || saving}
                onCheckedChange={(v) => {
                  setPol({ ...pol, mfa_enabled: v })
                  void save({ ...pol, mfa_enabled: v })
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">MFA enforced</div>
                <div className="text-xs text-muted-foreground">Block sign-in until MFA is set up (when MFA is on).</div>
              </div>
              <Switch
                checked={pol.mfa_enforced}
                disabled={!canUpdate || saving || !pol.mfa_enabled}
                onCheckedChange={(v) => {
                  setPol({ ...pol, mfa_enforced: v })
                  void save({ ...pol, mfa_enforced: v })
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Captcha</div>
                <div className="text-xs text-muted-foreground">Require captcha on login (see API / CAPTCHA_SKIP_VALIDATION for dev).</div>
              </div>
              <Switch
                checked={pol.captcha_enabled}
                disabled={!canUpdate || saving}
                onCheckedChange={(v) => {
                  setPol({ ...pol, captcha_enabled: v })
                  void save({ ...pol, captcha_enabled: v })
                }}
              />
            </div>
            {pol.captcha_enabled ? (
              <p className="text-xs text-muted-foreground">
                Send field <code className="rounded bg-muted px-1">captcha_token</code> on login. Dev: set{" "}
                <code className="rounded bg-muted px-1">CAPTCHA_SKIP_VALIDATION=1</code> or use value{" "}
                <code className="rounded bg-muted px-1">captcha-ok</code>.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
