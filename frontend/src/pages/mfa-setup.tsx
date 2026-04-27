import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, postJson } from "@/lib/api"

export function MfaSetupPage() {
  const [searchParams] = useSearchParams()
  const token = (searchParams.get("token") ?? "").trim()

  const [otpauthUrl, setOtpauthUrl] = React.useState<string | null>(null)
  const [accountName, setAccountName] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [initDone, setInitDone] = React.useState(false)

  async function init() {
    if (!token) {
      toast.error("Missing setup token.")
      return
    }
    setLoading(true)
    try {
      const res = await postJson<{ otpauth_url: string; account_name: string }>("/auth/mfa/setup/init", {
        setup_token: token,
      })
      setOtpauthUrl(res.otpauth_url)
      setAccountName(res.account_name)
      setInitDone(true)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start MFA setup.")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (token) void init()
  }, [token])

  async function verify() {
    if (!token) return
    setLoading(true)
    try {
      await postJson("/auth/mfa/setup/verify", { setup_token: token, otp: otp.trim() })
      toast.success("Authenticator linked. You can sign in now.")
      setOtp("")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Verification failed.")
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid link</CardTitle>
            <CardDescription>Open the MFA setup link from your email.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Set up authenticator</CardTitle>
          <CardDescription>
            Use Google Authenticator, Microsoft Authenticator, or any TOTP app. Scan the QR or paste the key from the
            otpauth link below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!initDone && !otpauthUrl ? (
            <p className="text-sm text-muted-foreground">{loading ? "Preparing…" : "Starting…"}</p>
          ) : null}
          {otpauthUrl ? (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Account</div>
              <div className="font-mono text-xs break-all">{accountName}</div>
              <div className="pt-2 text-xs font-medium text-muted-foreground">Secret URI (add manually if needed)</div>
              <div className="max-h-32 overflow-auto font-mono text-[11px] break-all text-muted-foreground">
                {otpauthUrl}
              </div>
              <Button type="button" size="sm" variant="outline" className="mt-2" asChild>
                <a href={otpauthUrl}>Open in authenticator app</a>
              </Button>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="mfa-otp">6-digit code</Label>
            <Input
              id="mfa-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="000000"
              disabled={loading || !initDone}
            />
          </div>
          <Button type="button" className="w-full" disabled={loading || !initDone} onClick={() => void verify()}>
            {loading ? "Checking…" : "Verify and finish"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="text-primary underline-offset-2 hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
