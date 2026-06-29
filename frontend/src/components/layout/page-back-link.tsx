import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"

import { cn } from "@/lib/utils"

export type PageBackLinkProps = {
  to: string
  label: string
  className?: string
}

export function PageBackLink({ to, label, className }: PageBackLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex w-fit items-center gap-2 text-sm font-medium tracking-tight text-zinc-500 transition-colors hover:text-zinc-950",
        className,
      )}
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  )
}
