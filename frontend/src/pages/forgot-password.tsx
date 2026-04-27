import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { AppAuthMarketingLayout } from "@/components/layout/app-auth-marketing-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, postJson } from "@/lib/api"
import { safeReturnTo, storePasswordResetReturnTo } from "@/lib/auth-routes"

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams()
  const returnTo = safeReturnTo(searchParams.get("returnTo"))

  const [email, setEmail] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const eNorm = email.trim()
    if (!eNorm) {
      toast.error("Enter the email for your account.")
      return
    }
    setIsSubmitting(true)
    try {
      await postJson("/forgot-password", { email: eNorm })
      storePasswordResetReturnTo(returnTo)
      setSubmitted(true)
      toast.message("If an account exists for that email, you will receive a reset link.")
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Request failed. Try again later."
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppAuthMarketingLayout>
      <Card className="w-full max-w-md rounded-2xl p-8 shadow-lg">
        <CardHeader className="space-y-2 p-0 pb-6">
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <CardDescription>
            Enter the email for your account. We will send a link to set a new password if the account
            exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          {submitted ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>
                If an account with that email exists, check your inbox for a reset link. The link expires after a
                limited time.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                  <Link to={returnTo}>Back to sign in</Link>
                </Button>
                <Button type="button" size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => setSubmitted(false)}>
                  Use a different email
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send reset link"}
              </Button>
              <p className="text-center text-sm">
                <Link to={returnTo} className="text-primary underline-offset-2 hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AppAuthMarketingLayout>
  )
}
