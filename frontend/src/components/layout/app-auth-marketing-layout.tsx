import * as React from "react"

import { AppLogo } from "@/components/layout/AppLogo"
import { APP_PAGE_BACKGROUND_STYLE } from "@/lib/appearance"

type AppAuthMarketingLayoutProps = {
  children: React.ReactNode
}

/**
 * Branded split layout for public app auth: login, forgot password, reset password.
 */
export function AppAuthMarketingLayout({ children }: AppAuthMarketingLayoutProps) {
  return (
    <div id="layout" className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden px-12 py-12 text-white lg:flex"
        id="gradient"
        aria-hidden
      >
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 via-teal-800 to-emerald-700" />
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -right-28 h-80 w-80 rounded-full bg-black/20 blur-3xl" />

        

       
        <div className="absolute top-64 z-10 w-full pt-10 flex flex-col items-center justify-center">
          <AppLogo className="w-[220px]" />
          <h1 className="marketing-hero-title mt-4 text-3xl font-bold">Sub-Contractor Spend Management</h1>
        </div>

        <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-center text-xs text-white/60">
          © Ultra Corpotech Pvt. Ltd.
        </div>
      </aside>

      <main className="px-6 py-10" id="bg" style={APP_PAGE_BACKGROUND_STYLE}>
        <div className="mx-auto flex min-h-full max-w-md items-center">{children}</div>
      </main>
    </div>
  )
}
