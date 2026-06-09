export const SESSION_LAST_ACTIVITY_KEY = "session_last_activity_at"

export function resetSessionLastActivity(): void {
  try {
    localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()))
  } catch {
    // ignore storage errors
  }
}

export function clearSessionLastActivity(): void {
  try {
    localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY)
  } catch {
    // ignore storage errors
  }
}
