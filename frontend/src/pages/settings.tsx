import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getJson, putJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"

export type PasswordPolicy = {
  min_length: number
  require_uppercase: boolean
  require_lowercase: boolean
  require_digit: boolean
  require_special: boolean
  max_age_days: number
}

type AuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
}

export function SettingsPage() {
  const canEditSettings = hasPermission("settings.update") || isSuperuser()

  const [policy, setPolicy] = React.useState<PasswordPolicy | null>(null)
  const [authPolicy, setAuthPolicy] = React.useState<AuthPolicy | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [savingAuth, setSavingAuth] = React.useState(false)
  const [tab, setTab] = React.useState<"auth" | "password">("auth")

  async function load() {
    setLoadError(null)
    try {
      const [data, auth] = await Promise.all([
        getJson<PasswordPolicy>("/admin/settings/password-policy"),
        getJson<AuthPolicy>("/admin/settings/auth-policy"),
      ])
      setPolicy(data)
      setAuthPolicy(auth)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load settings")
      setPolicy(null)
      setAuthPolicy(null)
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  async function save() {
    if (!policy) return
    setSaving(true)
    toast.loading("Saving…", { id: "settings-save" })
    try {
      const updated = await putJson<PasswordPolicy>(
        "/admin/settings/password-policy",
        policy as unknown as Record<string, unknown>
      )
      setPolicy(updated)
      toast.success("Saved", { id: "settings-save" })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed"
      toast.error(message, { id: "settings-save" })
    } finally {
      setSaving(false)
    }
  }

  if (!policy && loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load settings</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    )
  }

  if (!policy) {
    return (
      <p className="text-sm text-muted-foreground">Loading settings…</p>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        {/* <p className="text-sm text-muted-foreground">Security and authentication policy for the organization.</p> */}
        {!canEditSettings ? (
          <p className="text-sm text-amber-800">
            You have read-only access. Saving changes requires{" "}
            <span className="font-medium">settings.update</span> (grant &quot;Edit&quot; on the Settings module for
            this role).
          </p>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
        <TabsList>
          <TabsTrigger value="auth">Authentication</TabsTrigger>
          <TabsTrigger value="password">Password Policy</TabsTrigger>
        </TabsList>

        <TabsContent value="auth" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Authentication Policy</CardTitle>
              {/* <CardDescription>
                Org-wide controls for password login, MFA, and captcha. Superusers are not affected.
              </CardDescription> */}
            </CardHeader>
            <CardContent className="space-y-4">
              {!authPolicy ? (
                <Alert variant="destructive">
                  <AlertTitle>Auth policy unavailable</AlertTitle>
                  <AlertDescription>Missing permission: auth_policy.view</AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Password sign-in</div>
                        <div className="text-xs text-muted-foreground">Allow email/phone + password.</div>
                      </div>
                      <Switch
                        checked={authPolicy.password_enabled}
                        disabled={!canEditSettings}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, password_enabled: Boolean(v) } : p))}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Captcha</div>
                        <div className="text-xs text-muted-foreground">Require captcha token on login.</div>
                      </div>
                      <Switch
                        checked={authPolicy.captcha_enabled}
                        disabled={!canEditSettings}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, captcha_enabled: Boolean(v) } : p))}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">MFA (TOTP)</div>
                        <div className="text-xs text-muted-foreground">Require authenticator code after password.</div>
                      </div>
                      <Switch
                        checked={authPolicy.mfa_enabled}
                        disabled={!canEditSettings}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, mfa_enabled: Boolean(v) } : p))}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">MFA enforced</div>
                        <div className="text-xs text-muted-foreground">Block login until MFA is set up.</div>
                      </div>
                      <Switch
                        checked={authPolicy.mfa_enforced}
                        disabled={!canEditSettings || !authPolicy.mfa_enabled}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, mfa_enforced: Boolean(v) } : p))}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!canEditSettings || savingAuth}
                      onClick={async () => {
                        if (!authPolicy) return
                        setSavingAuth(true)
                        toast.loading("Saving auth policy…", { id: "auth-policy-save" })
                        try {
                          const updated = await putJson<AuthPolicy>(
                            "/admin/settings/auth-policy",
                            authPolicy as unknown as Record<string, unknown>
                          )
                          setAuthPolicy(updated)
                          toast.success("Saved", { id: "auth-policy-save" })
                        } catch (e) {
                          const message = e instanceof Error ? e.message : "Save failed"
                          toast.error(message, { id: "auth-policy-save" })
                        } finally {
                          setSavingAuth(false)
                        }
                      }}
                    >
                      {savingAuth ? "Saving…" : "Save auth policy"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="password" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Password rules</CardTitle>
              {/* <CardDescription>These rules are enforced on password changes and resets.</CardDescription> */}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="min_length">Minimum length</Label>
                  <Input
                    id="min_length"
                    type="number"
                    min={1}
                    max={256}
                    disabled={!canEditSettings}
                    value={policy.min_length}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setPolicy((p) => (p ? { ...p, min_length: Number.isFinite(n) ? n : p.min_length } : p))
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max_age_days">Max age (days)</Label>
                  <Input
                    id="max_age_days"
                    type="number"
                    min={0}
                    max={36500}
                    disabled={!canEditSettings}
                    value={policy.max_age_days}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setPolicy((p) => (p ? { ...p, max_age_days: Number.isFinite(n) ? n : p.max_age_days } : p))
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Use 0 to disable password expiry.</p>
                </div>
              </div>

              <Separator />

              {(
                [
                  ["require_uppercase", "Require uppercase (A–Z)"],
                  ["require_lowercase", "Require lowercase (a–z)"],
                  ["require_digit", "Require a digit"],
                  ["require_special", "Require a special character"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={key} className="font-normal text-muted-foreground">
                    {label}
                  </Label>
                  <Switch
                    id={key}
                    checked={policy[key]}
                    disabled={!canEditSettings}
                    onCheckedChange={(v) =>
                      setPolicy((p) => (p ? { ...p, [key]: Boolean(v) } : p))
                    }
                  />
                </div>
              ))}

              <div className="flex justify-end">
                <Button size="sm" onClick={() => void save()} disabled={!canEditSettings || saving}>
                  {saving ? "Saving…" : "Save Password Policy"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Advanced JSON editor hidden to keep the password settings page simpler for users.
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Password Policy (JSON)</CardTitle>
              <CardDescription>Advanced edit. Apply parses JSON into the form above.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className={cn(
                  "min-h-[200px] w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  jsonError && "border-destructive"
                )}
                spellCheck={false}
                disabled={!canEditSettings}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
              {jsonError ? <p className="text-xs text-destructive">{jsonError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={!canEditSettings} onClick={applyJson}>
                  Apply JSON
                </Button>
              </div>
            </CardContent>
          </Card>
          */}
        </TabsContent>
      </Tabs>
    </div>
  )
}
