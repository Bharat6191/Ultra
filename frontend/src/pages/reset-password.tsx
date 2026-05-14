import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { AppAuthMarketingLayout } from "@/components/layout/app-auth-marketing-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, postJson } from "@/lib/api"
import { safeReturnTo, takePasswordResetReturnTo } from "@/lib/auth-routes"

function useResetToken() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tokenFromToken = (searchParams.get("token") ?? "").trim()
  const tokenFromLegacy = (searchParams.get("reset_token") ?? "").trim()
  const token = tokenFromToken || tokenFromLegacy

  React.useEffect(() => {
    if (tokenFromLegacy && !tokenFromToken) {
      setSearchParams({ token: tokenFromLegacy }, { replace: true })
    }
  }, [setSearchParams, tokenFromLegacy, tokenFromToken])

  return { token, searchParams, setSearchParams }
}

export function ResetPasswordPage() {
  const { token } = useResetToken()
  const [searchParams] = useSearchParams()
  const qReturn = searchParams.get("returnTo")

  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)
  const [returnTo, setReturnTo] = React.useState(() => safeReturnTo(qReturn))

  React.useEffect(() => {
    if (qReturn) {
      setReturnTo(safeReturnTo(qReturn))
      return
    }
    const stored = takePasswordResetReturnTo()
    if (stored) setReturnTo(safeReturnTo(stored))
  }, [qReturn])

  const backLogin = returnTo
  const forgotHref = backLogin === "/admin/login" ? "/forgot-password?returnTo=%2Fadmin%2Flogin" : "/forgot-password"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) {
      toast.error("Missing reset token. Open the link from your email, or request a new reset.")
      return
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.")
      return
    }
    setIsSubmitting(true)
    try {
      await postJson("/reset-password", { token, new_password: password })
      setSuccess(true)
      toast.success("Your password was updated. You can sign in now.")
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Reset failed. The link may have expired. Request a new one from the sign-in page."
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AppAuthMarketingLayout>
        <Card className="w-full max-w-md rounded-2xl p-8 shadow-lg">
          <CardHeader className="space-y-2 p-0 pb-4">
            <CardTitle className="text-2xl">Invalid link</CardTitle>
            <CardDescription>This page needs a valid reset token from your email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-0 text-sm text-muted-foreground">
            <Button asChild className="w-full">
              <Link to={forgotHref}>Request a new reset link</Link>
            </Button>
            <p className="text-center">
              <Link to="/login" className="text-primary underline-offset-2 hover:underline">
                Workspace sign in
              </Link>
              {" · "}
              <Link to="/admin/login" className="text-primary underline-offset-2 hover:underline">
                Admin sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </AppAuthMarketingLayout>
    )
  }

  if (success) {
    return (
      <AppAuthMarketingLayout>
        <Card className="w-full max-w-md rounded-2xl p-8 shadow-lg">
          <CardHeader className="space-y-2 p-0 pb-4">
            <CardTitle className="text-2xl">Password updated</CardTitle>
            <CardDescription>You can sign in with your new password.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-0">
            <Button asChild className="w-full">
              <Link to={backLogin}>Continue to sign in</Link>
            </Button>
            {backLogin !== "/login" ? (
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="text-primary underline-offset-2 hover:underline">
                  Workspace sign in
                </Link>
                {" instead"}
              </p>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/admin/login" className="text-primary underline-offset-2 hover:underline">
                  Superadmin sign in
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </AppAuthMarketingLayout>
    )
  }

  return (
    <AppAuthMarketingLayout>
      <Card className="w-full max-w-md rounded-2xl p-8 shadow-lg">
        <CardHeader className="space-y-2 p-0 pb-6">
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>Choose a strong password for your account.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password" showRequired>
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                disabled={isSubmitting}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password" showRequired>
                Confirm password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(ev) => setConfirm(ev.target.value)}
                disabled={isSubmitting}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Update password"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link to={backLogin} className="text-primary underline-offset-2 hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AppAuthMarketingLayout>
  )
}
