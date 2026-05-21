import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"

import { AppAuthMarketingLayout } from "@/components/layout/app-auth-marketing-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, getJson, postJson } from "@/lib/api"
import { clearAuthProfile, persistAuthFromMe } from "@/lib/permissions"

type LoginResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  mfa_required?: boolean
  setup_required?: boolean
  setup_token?: string
  challenge_token?: string
  expires_in?: number
  [k: string]: unknown
}

type MeResponse = {
  is_superuser?: boolean
  permissions?: string[]
  [k: string]: unknown
}

type PublicAuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
}

export function AppLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const legacyReset = (searchParams.get("reset_token") ?? "").trim()

  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [captchaToken, setCaptchaToken] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null)
  const [step, setStep] = React.useState<"password" | "otp">("password")
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [policy, setPolicy] = React.useState<PublicAuthPolicy | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)

  if (legacyReset) {
    return <Navigate to={`/reset-password?token=${encodeURIComponent(legacyReset)}`} replace />
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

  function clearTokens() {
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
    clearAuthProfile()
  }

  async function completeSession(accessToken: string, refreshToken: string) {
    localStorage.setItem("access_token", accessToken)
    localStorage.setItem("refresh_token", refreshToken)
    const me = await getJson<MeResponse>("/me")
    const isSuper = me?.is_superuser === true
    if (isSuper) {
      clearTokens()
      setError("Superadmin accounts must sign in from /admin/login.")
      return
    }
    persistAuthFromMe(me)
    navigate("/dashboard", { replace: true })
  }

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const u = username.trim()
    const p = password

    if (!u || !p) {
      setError("Email/username and password are required.")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await postJson<LoginResponse>("/login", {
        email: u,
        password: p,
        captcha_token: policy?.captcha_enabled ? (captchaToken.trim() || undefined) : undefined,
      })

      if (res.mfa_required === true) {
        if (res.setup_required === true && typeof res.setup_token === "string") {
          navigate(`/mfa/setup?token=${encodeURIComponent(res.setup_token)}`, { replace: true })
          return
        }
        if (typeof res.challenge_token === "string") {
          setChallengeToken(res.challenge_token)
          setStep("otp")
          setOtp("")
          return
        }
      }

      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : ""
      if (!accessToken || !refreshToken) {
        throw new Error("Login succeeded but tokens were not returned.")
      }
      await completeSession(accessToken, refreshToken)
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | undefined
        if (body?.error === "captcha_invalid") setError("Captcha verification failed.")
        else if (body?.error === "password_login_disabled") setError("Password sign-in is disabled for your organization.")
        else setError(err.message)
      } else if (err instanceof Error) setError(err.message)
      else setError("Login failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function onSubmitOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!challengeToken) {
      setError("Session expired. Sign in again.")
      return
    }
    const code = otp.trim()
    if (code.length < 6) {
      setError("Enter the 6-digit code from your authenticator app.")
      return
    }
    setIsSubmitting(true)
    try {
      const res = await postJson<LoginResponse>("/auth/mfa/verify", {
        challenge_token: challengeToken,
        otp: code,
      })
      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : ""
      if (!accessToken || !refreshToken) throw new Error("MFA verification incomplete.")
      await completeSession(accessToken, refreshToken)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else if (err instanceof Error) setError(err.message)
      else setError("Verification failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  function revealPassword() {
    setShowPassword(true)
  }

  function hidePassword() {
    setShowPassword(false)
  }

  return (
    <AppAuthMarketingLayout>
      <Card className="w-full max-w-md rounded-2xl p-8 shadow-lg">
        <CardHeader className="space-y-2 p-0 pb-6">
          <CardTitle className="text-2xl">{step === "otp" ? "Authenticator code" : "Welcome back"}</CardTitle>
          <CardDescription>
            {step === "otp"
              ? "Enter the code from your authenticator app to finish signing in."
              : "Sign in to access your dashboard"}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {step === "password" ? (
            <form onSubmit={onSubmitPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" showRequired>
                  Email or username
                </Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="you@example.com or username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password" showRequired>
                    Password
                  </Label>
                  <Link
                    to="/forgot-password"
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={isSubmitting}
                    required
                    className="pr-11"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    onMouseDown={revealPassword}
                    onMouseUp={hidePassword}
                    onMouseLeave={hidePassword}
                    onTouchStart={revealPassword}
                    onTouchEnd={hidePassword}
                    onBlur={hidePassword}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={isSubmitting}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </div>

              {policy?.captcha_enabled ? (
                <div className="space-y-2">
                  <Label htmlFor="captcha" showRequired>
                    Captcha token
                  </Label>
                  <Input
                    id="captcha"
                    value={captchaToken}
                    onChange={(e) => setCaptchaToken(e.target.value)}
                    disabled={isSubmitting}
                    placeholder="e.g. captcha-ok"
                    autoComplete="off"
                  />
                </div>
              ) : null}

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Logging in…" : "Login"}
              </Button>
            </form>
          ) : (
            <form onSubmit={onSubmitOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp" showRequired>
                  6-digit code
                </Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Verifying…" : "Continue"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isSubmitting}
                onClick={() => {
                  setStep("password")
                  setChallengeToken(null)
                  setOtp("")
                  setError(null)
                }}
              >
                Back
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AppAuthMarketingLayout>
  )
}
