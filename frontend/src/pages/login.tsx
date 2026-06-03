import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Eye, EyeOff } from "lucide-react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"

import { AppLogo } from "@/components/layout/AppLogo"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getJson, postJson } from "@/lib/api"
import { persistAuthFromMe } from "@/lib/permissions"

const loginSchema = z.object({
  email: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
})

type LoginValues = z.infer<typeof loginSchema>

type LoginResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  mfa_required?: boolean
  setup_required?: boolean
  setup_token?: string
  challenge_token?: string
  [k: string]: unknown
}

type PublicAuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
}

const AUTH_POWERED_BY = "Powered by TiMAD"
const AUTH_APP_VERSION = "V 0.0.0.0"

export type LoginPageProps = {
  onLoggedIn?: (tokens: { accessToken: string; refreshToken?: string }) => void
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const legacyReset = (searchParams.get("reset_token") ?? "").trim()

  const [serverError, setServerError] = React.useState<string | null>(null)
  const [mfaChallenge, setMfaChallenge] = React.useState<string | null>(null)
  const [otp, setOtp] = React.useState("")
  const [policy, setPolicy] = React.useState<PublicAuthPolicy | null>(null)
  const [captchaToken, setCaptchaToken] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  })

  const isSubmitting = form.formState.isSubmitting

  if (legacyReset) {
    return <Navigate to={`/reset-password?token=${encodeURIComponent(legacyReset)}&returnTo=%2Fadmin%2Flogin`} replace />
  }

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const p = await getJson<PublicAuthPolicy>("/auth/policy")
        if (!cancelled) setPolicy(p)
      } catch {
        if (!cancelled) setPolicy(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(values: LoginValues) {
    setServerError(null)
    toast.loading("Signing in…", { id: "login" })

    try {
      const res = await postJson<LoginResponse>("/login", {
        ...values,
        captcha_token: policy?.captcha_enabled ? (captchaToken.trim() || undefined) : undefined,
      })

      if (res.mfa_required === true) {
        if (res.setup_required === true && typeof res.setup_token === "string") {
          toast.dismiss("login")
          navigate(`/mfa/setup?token=${encodeURIComponent(res.setup_token)}`)
          return
        }
        if (typeof res.challenge_token === "string") {
          setMfaChallenge(res.challenge_token)
          toast.dismiss("login")
          return
        }
      }

      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : undefined
      if (!accessToken) {
        throw new Error("Login succeeded but no access token was returned.")
      }

      localStorage.setItem("access_token", accessToken)
      if (refreshToken) localStorage.setItem("refresh_token", refreshToken)

      const me = await getJson<{
        is_superuser?: boolean
        permissions?: string[]
      }>("/me")
      persistAuthFromMe(me)

      toast.success("Signed in", { id: "login" })
      onLoggedIn?.({ accessToken, refreshToken })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Login failed"
      setServerError(message)
      toast.error(message, { id: "login" })
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaChallenge) return
    setServerError(null)
    toast.loading("Verifying…", { id: "mfa" })
    try {
      const res = await postJson<LoginResponse>("/auth/mfa/verify", {
        challenge_token: mfaChallenge,
        otp: otp.trim(),
      })
      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : undefined
      if (!accessToken) throw new Error("No access token")
      localStorage.setItem("access_token", accessToken)
      if (refreshToken) localStorage.setItem("refresh_token", refreshToken)
      const me = await getJson<{ is_superuser?: boolean; permissions?: string[] }>("/me")
      persistAuthFromMe(me)
      toast.success("Signed in", { id: "mfa" })
      onLoggedIn?.({ accessToken, refreshToken })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Verification failed"
      setServerError(message)
      toast.error(message, { id: "mfa" })
    }
  }

  function revealPassword() {
    setShowPassword(true)
  }

  function hidePassword() {
    setShowPassword(false)
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex justify-center">
          <AppLogo className="w-[200px]" />
        </div>

        <Card className="w-full">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">{mfaChallenge ? "Authenticator code" : "Admin login"}</CardTitle>
            <CardDescription>
              {mfaChallenge ? "Enter the code from your app." : "Sign in with your email and password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {serverError ? (
              <Alert variant="destructive">
                <AlertTitle>Couldn’t sign in</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}

            {mfaChallenge ? (
              <form className="space-y-3" onSubmit={submitOtp}>
                <div className="space-y-1.5">
                  <Label htmlFor="otp" showRequired>
                    6-digit code
                  </Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full">
                  Continue
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setMfaChallenge(null)
                    setOtp("")
                    setServerError(null)
                  }}
                >
                  Back
                </Button>
              </form>
            ) : (
              <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="space-y-1.5">
                  <Label htmlFor="email" showRequired>
                    Email or Username
                  </Label>
                  <Input
                    id="email"
                    type="text"
                    autoComplete="username"
                    placeholder="admin@example.com or admin"
                    aria-invalid={!!form.formState.errors.email}
                    {...form.register("email")}
                  />
                  {form.formState.errors.email?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="password" showRequired>
                      Password
                    </Label>
                    <Link
                      to="/forgot-password?returnTo=%2Fadmin%2Flogin"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      tabIndex={-1}
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      aria-invalid={!!form.formState.errors.password}
                      className="pr-11"
                      {...form.register("password")}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      onMouseDown={revealPassword}
                      onMouseUp={hidePassword}
                      onMouseLeave={hidePassword}
                      onTouchStart={revealPassword}
                      onTouchEnd={hidePassword}
                      onBlur={hidePassword}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                  {form.formState.errors.password?.message ? (
                    <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                  ) : null}
                </div>

                {policy?.captcha_enabled ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="captcha_token" showRequired>
                      Captcha token
                    </Label>
                    <Input
                      id="captcha_token"
                      autoComplete="off"
                      value={captchaToken}
                      onChange={(e) => setCaptchaToken(e.target.value)}
                      placeholder="e.g. captcha-ok"
                    />
                  </div>
                ) : null}

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </Button>

                <div className="pt-4 text-center text-foreground">
                  <div className="text-sm font-medium">{AUTH_POWERED_BY}</div>
                  <div className="mt-2 text-sm">{AUTH_APP_VERSION}</div>
                </div>
              </form>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  )
}
