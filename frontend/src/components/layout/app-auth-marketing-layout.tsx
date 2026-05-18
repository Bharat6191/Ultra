import * as React from "react"

type AppAuthMarketingLayoutProps = {
  children: React.ReactNode
}

export function AppAuthMarketingLayout({ children }: AppAuthMarketingLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden">

      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('/auth-bg.png')",
        }}
      />

      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Center Content */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">

        {/* Main Container */}
        <div className="w-full max-w-md">

          {/* Top Branding */}

          {/* Login Form */}
          {children}

        </div>
      </div>
    </div>
  )
}