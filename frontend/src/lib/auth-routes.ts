const STORAGE_RETURN_TO = "auth.passwordResetReturnTo"

/**
 * Prevents open redirects: only same-origin path-style values are allowed.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== "string") return "/login"
  const t = raw.trim()
  if (t === "") return "/login"
  if (t.startsWith("/") && !t.startsWith("//") && !t.includes(":\\") && !t.includes("\\")) {
    return t.split("?")[0]!.split("#")[0]! || "/login"
  }
  return "/login"
}

export function storePasswordResetReturnTo(path: string) {
  try {
    sessionStorage.setItem(STORAGE_RETURN_TO, path)
  } catch {
    // ignore
  }
}

export function takePasswordResetReturnTo(): string | null {
  try {
    const v = sessionStorage.getItem(STORAGE_RETURN_TO)
    sessionStorage.removeItem(STORAGE_RETURN_TO)
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}
