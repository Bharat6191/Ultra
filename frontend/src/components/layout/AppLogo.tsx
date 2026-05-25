import { cn } from "@/lib/utils"

export type AppLogoProps = {
  className?: string
  imageClassName?: string
}

export function AppLogo({ className, imageClassName }: AppLogoProps) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center", className)}>
      <img
        src="/logo/logo.png"
        alt="Ultra Corpotech Pvt. Ltd."
        width={528}
        height={194}
        className={cn("block h-auto w-full object-contain", imageClassName)}
      />
    </div>
  )
}
