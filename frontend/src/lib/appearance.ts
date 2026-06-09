import { getJson } from "@/lib/api"

export type AppearanceSettings = {
  page_background_color: string
}

export const DEFAULT_PAGE_BACKGROUND_COLOR = "#f9fafb"
export const APP_PAGE_BACKGROUND_STYLE = { backgroundColor: "var(--app-page-background)" } as const

export function normalizePageBackgroundColor(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return null
  const hex = raw.slice(1)
  const normalized = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex
  return `#${normalized.toLowerCase()}`
}

export function applyAppearanceSettings(settings: AppearanceSettings | null | undefined): AppearanceSettings {
  const pageBackgroundColor =
    normalizePageBackgroundColor(settings?.page_background_color) ?? DEFAULT_PAGE_BACKGROUND_COLOR
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--app-page-background", pageBackgroundColor)
  }
  return { page_background_color: pageBackgroundColor }
}

let cachedAppearance: AppearanceSettings | null = null
let appearanceRequest: Promise<AppearanceSettings | null> | null = null

export async function loadAndApplyAppearanceSettings(opts?: { force?: boolean }): Promise<AppearanceSettings | null> {
  if (!opts?.force && cachedAppearance) {
    applyAppearanceSettings(cachedAppearance)
    return cachedAppearance
  }
  if (!opts?.force && appearanceRequest) return appearanceRequest

  appearanceRequest = (async () => {
    try {
      const data = await getJson<AppearanceSettings>("/settings/appearance")
      cachedAppearance = applyAppearanceSettings(data)
      return cachedAppearance
    } catch {
      cachedAppearance = applyAppearanceSettings({ page_background_color: DEFAULT_PAGE_BACKGROUND_COLOR })
      return cachedAppearance
    } finally {
      appearanceRequest = null
    }
  })()

  return appearanceRequest
}
