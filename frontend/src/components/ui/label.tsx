import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** Required-field asterisk: vivid red with a soft glow (used app-wide). */
const REQUIRED_STAR_CLASS =
  "ml-0.5 inline font-semibold text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.45)]"

type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root> & {
  /** When true, appends a red asterisk after the label text (does not set HTML `required`). */
  showRequired?: boolean
}

function Label({ className, showRequired, children, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-1 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {showRequired ? (
        <span className={REQUIRED_STAR_CLASS} aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  )
}

export { Label }
