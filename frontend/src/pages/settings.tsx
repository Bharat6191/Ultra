import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getJson, putJson } from "@/lib/api"
import {
  applyAppearanceSettings,
  DEFAULT_PAGE_BACKGROUND_COLOR,
  normalizePageBackgroundColor,
  type AppearanceSettings,
} from "@/lib/appearance"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { cn } from "@/lib/utils"

export type PasswordPolicy = {
  min_length: number
  require_uppercase: boolean
  require_lowercase: boolean
  require_digit: boolean
  require_special: boolean
  max_age_days: number
}

type SessionTimeoutMode = "token_expiry" | "idle_timeout"

type AuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
  session_timeout_mode: SessionTimeoutMode
  idle_timeout_minutes: number
}

export function SettingsPage() {
  const canEditSettings = hasPermission("settings.update") || isSuperuser()

  const [policy, setPolicy] = React.useState<PasswordPolicy | null>(null)
  const [authPolicy, setAuthPolicy] = React.useState<AuthPolicy | null>(null)
  const [appearance, setAppearance] = React.useState<AppearanceSettings | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [savingAuth, setSavingAuth] = React.useState(false)
  const [savingAppearance, setSavingAppearance] = React.useState(false)
  const [tab, setTab] = React.useState<"auth" | "password" | "appearance">("auth")

  async function load() {
    setLoadError(null)
    const [passwordResult, authResult, appearanceResult] = await Promise.allSettled([
        getJson<PasswordPolicy>("/admin/settings/password-policy"),
        getJson<AuthPolicy>("/admin/settings/auth-policy"),
        getJson<AppearanceSettings>("/admin/settings/appearance"),
      ])

    if (passwordResult.status === "fulfilled") {
      setPolicy(passwordResult.value)
    } else {
      setLoadError(passwordResult.reason instanceof Error ? passwordResult.reason.message : "Failed to load settings")
      setPolicy(null)
    }

    if (authResult.status === "fulfilled") {
      setAuthPolicy(authResult.value)
    } else {
      setAuthPolicy(null)
    }

    if (appearanceResult.status === "fulfilled") {
      const normalized = applyAppearanceSettings(appearanceResult.value)
      setAppearance(normalized)
    } else {
      setAppearance({ page_background_color: DEFAULT_PAGE_BACKGROUND_COLOR })
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

  async function saveAppearance() {
    if (!appearance) return
    const normalized = normalizePageBackgroundColor(appearance.page_background_color)
    if (!normalized) {
      toast.error("Use a valid hex color like #f9fafb.")
      return
    }

    setSavingAppearance(true)
    toast.loading("Saving appearance…", { id: "appearance-save" })
    try {
      const updated = await putJson<AppearanceSettings>("/admin/settings/appearance", {
        page_background_color: normalized,
      })
      const applied = applyAppearanceSettings(updated)
      setAppearance(applied)
      toast.success("Saved", { id: "appearance-save" })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed"
      toast.error(message, { id: "appearance-save" })
    } finally {
      setSavingAppearance(false)
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

  const previewBackgroundColor =
    normalizePageBackgroundColor(appearance?.page_background_color) ?? DEFAULT_PAGE_BACKGROUND_COLOR

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="space-y-2">
        <PageHeader title="Settings" />
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
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
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
                        <div className="text-sm font-medium">Password Sign-In</div>
                        {/* <div className="text-xs text-muted-foreground">Allow email/phone + password.</div> */}
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
                        {/* <div className="text-xs text-muted-foreground">Require captcha token on login.</div> */}
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
                        {/* <div className="text-xs text-muted-foreground">Require authenticator code after password.</div> */}
                      </div>
                      <Switch
                        checked={authPolicy.mfa_enabled}
                        disabled={!canEditSettings}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, mfa_enabled: Boolean(v) } : p))}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">MFA Enforced</div>
                        {/* <div className="text-xs text-muted-foreground">Block login until MFA is set up.</div> */}
                      </div>
                      <Switch
                        checked={authPolicy.mfa_enforced}
                        disabled={!canEditSettings || !authPolicy.mfa_enabled}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, mfa_enforced: Boolean(v) } : p))}
                      />
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Session Timeout Mode</div>
                      {/* <p className="text-xs text-muted-foreground">
                        Choose whether logout is controlled by backend access-token expiry or by true user inactivity.
                      </p> */}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <button
                        type="button"
                        disabled={!canEditSettings}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          authPolicy.session_timeout_mode === "token_expiry"
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-border hover:border-emerald-200",
                          !canEditSettings && "cursor-not-allowed opacity-60",
                        )}
                        onClick={() =>
                          setAuthPolicy((p) =>
                            p
                              ? {
                                  ...p,
                                  session_timeout_mode: "token_expiry",
                                }
                              : p
                          )
                        }
                      >
                        <div className="text-sm font-medium">Use access token expiry</div>
                        {/* <p className="mt-1 text-xs text-muted-foreground">
                          Users stay signed in until the current access token lifetime ends.
                        </p> */}
                      </button>

                      <button
                        type="button"
                        disabled={!canEditSettings}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          authPolicy.session_timeout_mode === "idle_timeout"
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-border hover:border-emerald-200",
                          !canEditSettings && "cursor-not-allowed opacity-60",
                        )}
                        onClick={() =>
                          setAuthPolicy((p) =>
                            p
                              ? {
                                  ...p,
                                  session_timeout_mode: "idle_timeout",
                                }
                              : p
                          )
                        }
                      >
                        <div className="text-sm font-medium">Use true idle logout</div>
                        {/* <p className="mt-1 text-xs text-muted-foreground">
                          Users are logged out only after the configured minutes with no mouse, keyboard, click, scroll,
                          or touch activity.
                        </p> */}
                      </button>
                    </div>

                    <div className="grid gap-1.5 sm:max-w-xs">
                      <Label htmlFor="idle_timeout_minutes">Inactivity Timeout (min)</Label>
                      <Input
                        id="idle_timeout_minutes"
                        type="number"
                        min={1}
                        max={1440}
                        step={1}
                        disabled={!canEditSettings || authPolicy.session_timeout_mode !== "idle_timeout"}
                        value={authPolicy.idle_timeout_minutes}
                        onChange={(e) => {
                          const value = Number(e.target.value)
                          if (!Number.isFinite(value)) return
                          const next = Math.min(1440, Math.max(1, Math.trunc(value)))
                          setAuthPolicy((p) => (p ? { ...p, idle_timeout_minutes: next } : p))
                        }}
                      />
                      {/* <p className="text-xs text-muted-foreground">
                        {authPolicy.session_timeout_mode === "idle_timeout"
                          ? "The header timer shows a live MM:SS countdown and resets on user activity."
                          : "Token-expiry mode uses the backend access-token lifetime. Idle minutes are ignored until idle logout is selected."}
                      </p> */}
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
                          window.dispatchEvent(new Event("auth-policy-updated"))
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

        <TabsContent value="appearance" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Workspace Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {!appearance ? (
                <Alert variant="destructive">
                  <AlertTitle>Appearance settings unavailable</AlertTitle>
                  <AlertDescription>Could not load the workspace background color.</AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="page_background_color">Page background color</Label>
                        <div className="flex items-center gap-3">
                          <input
                            id="page_background_color_picker"
                            type="color"
                            value={previewBackgroundColor}
                            disabled={!canEditSettings}
                            onChange={(e) => setAppearance((p) => (p ? { ...p, page_background_color: e.target.value } : p))}
                            className="h-10 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                          <Input
                            id="page_background_color"
                            disabled={!canEditSettings}
                            value={appearance.page_background_color}
                            onChange={(e) => setAppearance((p) => (p ? { ...p, page_background_color: e.target.value } : p))}
                            placeholder="#f9fafb"
                          />
                        </div>
                        {/* <p className="text-xs text-muted-foreground">
                          Admin-controlled background for dashboard, admin, login, and workspace screens.
                        </p> */}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium">Preview</div>
                      <div className="rounded-2xl border border-zinc-200 p-4" style={{ backgroundColor: previewBackgroundColor }}>
                        <div className="rounded-2xl border border-zinc-200/80 bg-white/88 p-5 shadow-sm backdrop-blur-sm">
                          <div className="text-lg font-semibold text-zinc-950">Ultra Workspace</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {/* Main page background preview using <span className="font-medium text-zinc-900">{previewBackgroundColor}</span>. */}
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Card</div>
                              <div className="mt-1 text-sm font-medium text-zinc-950">Content stays readable</div>
                            </div>
                            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usage</div>
                              <div className="mt-1 text-sm font-medium text-zinc-950">Applied from a DB setting</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!canEditSettings || savingAppearance}
                      onClick={() => void saveAppearance()}
                    >
                      {savingAppearance ? "Saving…" : "Save appearance"}
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
              <CardTitle className="text-base">Password Rules</CardTitle>
              {/* <CardDescription>These rules are enforced on password changes and resets.</CardDescription> */}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="min_length">Minimum Length</Label>
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
                  <Label htmlFor="max_age_days">Max Age (Days)</Label>
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
                  {/* <p className="text-xs text-muted-foreground">Use 0 to disable password expiry.</p> */}
                </div>
              </div>

              <Separator />

              {(
                [
                  ["require_uppercase", "Required Uppercase (A–Z)"],
                  ["require_lowercase", "Required Lowercase (a–z)"],
                  ["require_digit", "Required Digit"],
                  ["require_special", "Required Special Character"],
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
