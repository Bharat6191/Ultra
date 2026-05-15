import {
  computeVsBaseTolerance,
  vsBaseToleranceToneClasses,
  type VsBaseTolerance,
} from "@/components/contractors/rateStatus"

type Props = {
  negotiated: number | string | null | undefined
  baseRate: number | string | null | undefined
  /** Pre-computed from API timeline payload. */
  tolerance?: VsBaseTolerance | null
  className?: string
}

export function VsBaseToleranceBadge({
  negotiated,
  baseRate,
  tolerance: toleranceProp,
  className = "",
}: Props) {
  const tolerance = toleranceProp ?? computeVsBaseTolerance(negotiated, baseRate)
  if (!tolerance) return null

  return (
    <div
      className={`inline-flex rounded-lg border px-3 py-2 ${vsBaseToleranceToneClasses(tolerance.tone, "box")} ${className}`}
    >
      <span
        className={`text-base font-semibold tabular-nums tracking-tight ${vsBaseToleranceToneClasses(tolerance.tone, "text")}`}
      >
        {tolerance.pct_display}
      </span>
    </div>
  )
}
