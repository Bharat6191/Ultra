import * as React from "react"

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

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-sm font-semibold">UL</div>
            <div className="text-xs font-medium tracking-wide text-white/90">ULTRA CORPOTECH PVT. LTD.</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold">Engineering &amp; energy solutions.</h1>
          <p className="mt-4 text-sm text-white/70">
            Operations workspace for master data, planning, and plant performance — aligned with Ultra
            Corpotech.
          </p>
        </div>

        <div className="relative text-xs text-white/60">© Ultra Corpotech Pvt. Ltd.</div>
      </aside>

      <main className="bg-gray-100 px-6 py-10" id="bg">
        <div className="mx-auto flex min-h-full max-w-md items-center">{children}</div>
      </main>
    </div>
  )
}
