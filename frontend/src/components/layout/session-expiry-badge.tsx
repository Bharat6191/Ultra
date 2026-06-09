import * as React from "react"

import { API_BASE_URL, getJson } from "@/lib/api"
import { SESSION_LAST_ACTIVITY_KEY } from "@/lib/session-timeout"
import { cn } from "@/lib/utils"

type SessionTimeoutMode = "token_expiry" | "idle_timeout"

type PublicAuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
  session_timeout_mode: SessionTimeoutMode
  idle_timeout_minutes: number
}

type RefreshResponse = {
  access_token?: string
  refresh_token?: string
}

const DEFAULT_POLICY: PublicAuthPolicy = {
  password_enabled: true,
  mfa_enabled: false,
  captcha_enabled: false,
  mfa_enforced: false,
  session_timeout_mode: "token_expiry",
  idle_timeout_minutes: 10,
}

const AUTH_POLICY_UPDATED_EVENT = "auth-policy-updated"
const ACTIVITY_WRITE_THROTTLE_MS = 1000
const REFRESH_THRESHOLD_SECONDS = 60

function readStorageString(key: string): string | null {
  try {
    const value = localStorage.getItem(key)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

function readAccessToken(): string | null {
  return readStorageString("access_token")
}

function readRefreshToken(): string | null {
  return readStorageString("refresh_token")
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".")
  if (parts.length < 2) return null
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    const json = atob(padded)
    const payload = JSON.parse(json) as unknown
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function getAccessTokenExpiryMs(): number | null {
  const token = readAccessToken()
  if (!token) return null
  const payload = decodeJwtPayload(token)
  const exp = payload?.exp
  const expSeconds = typeof exp === "number" ? exp : typeof exp === "string" ? Number(exp) : NaN
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) return null
  return expSeconds * 1000
}

function readLastActivityMs(): number | null {
  const raw = readStorageString(SESSION_LAST_ACTIVITY_KEY)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function writeLastActivityMs(value: number): void {
  try {
    localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(value))
  } catch {
    // ignore
  }
}

function remainingTokenSeconds(): number | null {
  const expiryMs = getAccessTokenExpiryMs()
  if (expiryMs == null) return null
  return Math.max(0, Math.floor((expiryMs - Date.now()) / 1000))
}

function remainingIdleSeconds(idleTimeoutMinutes: number): number {
  const now = Date.now()
  const fallback = now
  const lastActivityMs = readLastActivityMs() ?? fallback
  const deadline = lastActivityMs + idleTimeoutMinutes * 60_000
  return Math.max(0, Math.floor((deadline - now) / 1000))
}

function formatRemaining(seconds: number): string {
  const total = Math.max(0, seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

async function fetchPublicAuthPolicy(): Promise<PublicAuthPolicy> {
  try {
    const policy = await getJson<PublicAuthPolicy>("/auth/policy")
    return {
      ...DEFAULT_POLICY,
      ...policy,
      session_timeout_mode:
        policy?.session_timeout_mode === "idle_timeout" ? "idle_timeout" : "token_expiry",
      idle_timeout_minutes:
        Number.isFinite(Number(policy?.idle_timeout_minutes)) && Number(policy.idle_timeout_minutes) > 0
          ? Number(policy.idle_timeout_minutes)
          : DEFAULT_POLICY.idle_timeout_minutes,
    }
  } catch {
    return DEFAULT_POLICY
  }
}

async function refreshAccessTokenPair(): Promise<boolean> {
  const refreshToken = readRefreshToken()
  if (!refreshToken) return false
  const url = `${API_BASE_URL}/refresh`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    const text = await res.text()
    const data = text ? (JSON.parse(text) as RefreshResponse) : {}
    if (!res.ok || typeof data.access_token !== "string" || !data.access_token) return false
    localStorage.setItem("access_token", data.access_token)
    if (typeof data.refresh_token === "string" && data.refresh_token) {
      localStorage.setItem("refresh_token", data.refresh_token)
    }
    return true
  } catch {
    return false
  }
}

export function SessionExpiryBadge({
  onExpired,
  className,
}: {
  onExpired?: () => void
  className?: string
}) {
  const [policy, setPolicy] = React.useState<PublicAuthPolicy>(DEFAULT_POLICY)
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(null)
  const expiredRef = React.useRef(false)
  const onExpiredRef = React.useRef(onExpired)
  const hadTokenRef = React.useRef(Boolean(readAccessToken()))
  const refreshInFlightRef = React.useRef(false)
  const lastActivityWriteRef = React.useRef(0)

  React.useEffect(() => {
    onExpiredRef.current = onExpired
  }, [onExpired])

  const triggerExpiry = React.useCallback(() => {
    if (expiredRef.current) return
    expiredRef.current = true
    onExpiredRef.current?.()
  }, [])

  const markActivity = React.useCallback(() => {
    if (policy.session_timeout_mode !== "idle_timeout") return
    const now = Date.now()
    if (now - lastActivityWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return
    lastActivityWriteRef.current = now
    writeLastActivityMs(now)
    setRemainingSeconds(policy.idle_timeout_minutes * 60)
  }, [policy.idle_timeout_minutes, policy.session_timeout_mode])

  React.useEffect(() => {
    let cancelled = false
    const loadPolicy = async () => {
      const next = await fetchPublicAuthPolicy()
      if (cancelled) return
      setPolicy(next)
      if (next.session_timeout_mode === "idle_timeout" && readLastActivityMs() == null) {
        const now = Date.now()
        lastActivityWriteRef.current = now
        writeLastActivityMs(now)
      }
    }

    void loadPolicy()
    const handleAuthPolicyUpdated = () => {
      void loadPolicy()
    }
    window.addEventListener(AUTH_POLICY_UPDATED_EVENT, handleAuthPolicyUpdated)

    return () => {
      cancelled = true
      window.removeEventListener(AUTH_POLICY_UPDATED_EVENT, handleAuthPolicyUpdated)
    }
  }, [])

  React.useEffect(() => {
    if (policy.session_timeout_mode !== "idle_timeout") return

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ]
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, markActivity, { passive: true })
    }
    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, markActivity)
      }
    }
  }, [markActivity, policy.session_timeout_mode])

  React.useEffect(() => {
    expiredRef.current = false

    async function maybeRefreshToken() {
      if (policy.session_timeout_mode !== "idle_timeout") return
      if (refreshInFlightRef.current) return
      const tokenRemaining = remainingTokenSeconds()
      if (tokenRemaining == null || tokenRemaining > REFRESH_THRESHOLD_SECONDS) return
      refreshInFlightRef.current = true
      try {
        const ok = await refreshAccessTokenPair()
        if (!ok) triggerExpiry()
      } finally {
        refreshInFlightRef.current = false
      }
    }

    function tick() {
      const token = readAccessToken()
      if (!token) {
        if (hadTokenRef.current) triggerExpiry()
        setRemainingSeconds(null)
        return
      }
      hadTokenRef.current = true

      if (policy.session_timeout_mode === "idle_timeout") {
        if (readLastActivityMs() == null) {
          const now = Date.now()
          lastActivityWriteRef.current = now
          writeLastActivityMs(now)
        }
        const next = remainingIdleSeconds(policy.idle_timeout_minutes)
        setRemainingSeconds(next)
        if (next <= 0) {
          triggerExpiry()
          return
        }
        void maybeRefreshToken()
        return
      }

      const next = remainingTokenSeconds()
      setRemainingSeconds(next)
      if (next != null && next <= 0) {
        triggerExpiry()
      }
    }

    tick()
    const timerId = window.setInterval(tick, 1000)
    window.addEventListener("storage", tick)
    document.addEventListener("visibilitychange", tick)
    window.addEventListener("focus", tick)

    return () => {
      window.clearInterval(timerId)
      window.removeEventListener("storage", tick)
      document.removeEventListener("visibilitychange", tick)
      window.removeEventListener("focus", tick)
    }
  }, [policy, triggerExpiry])

  if (remainingSeconds == null) return null

  const label = policy.session_timeout_mode === "idle_timeout" ? "Idle logout" : "Auto logout"

  return (
    <div
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 text-amber-950",
        className,
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">{label}</span>
      <span className="font-semibold tabular-nums">{formatRemaining(remainingSeconds)}</span>
    </div>
  )
}
