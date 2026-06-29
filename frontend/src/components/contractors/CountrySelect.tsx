import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { contractorCountryOptions } from "@/lib/countries"
import { cn } from "@/lib/utils"

type CountrySelectProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  ariaInvalid?: boolean
  disabled?: boolean
  size?: "md" | "lg"
}

export function CountrySelect({
  value,
  onChange,
  onBlur,
  placeholder = "Select a country",
  ariaInvalid = false,
  disabled = false,
  size = "md",
}: CountrySelectProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties | null>(null)

  const options = React.useMemo(() => contractorCountryOptions(value), [value])
  const filteredOptions = React.useMemo(() => {
    const next = query.trim().toLowerCase()
    if (!next) return options
    return options.filter((country) => country.toLowerCase().includes(next))
  }, [options, query])

  const triggerClassName =
    size === "lg"
      ? "h-14 rounded-2xl border-zinc-200 px-4 text-[15px] shadow-sm"
      : "h-10 rounded-lg px-3 text-sm"
  const panelClassName =
    size === "lg"
      ? "rounded-[22px] border border-zinc-200 bg-white shadow-[0_26px_70px_-40px_rgba(15,23,42,0.45)]"
      : "rounded-xl border border-zinc-200 bg-white shadow-[0_18px_44px_-28px_rgba(15,23,42,0.4)]"
  const searchInputClassName =
    size === "lg"
      ? "h-12 rounded-2xl border-emerald-400/70 pl-12 pr-4 text-[15px]"
      : "h-9 rounded-lg border-gray-200 pl-10 pr-3 text-sm"
  const optionClassName =
    size === "lg"
      ? "rounded-xl px-4 py-3 text-[15px]"
      : "rounded-lg px-3 py-2 text-sm"

  React.useEffect(() => {
    if (!open) {
      setQuery("")
      return
    }
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  React.useLayoutEffect(() => {
    if (!open) return

    function syncPanelPosition() {
      const trigger = rootRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const estimatedHeight = 304
      const spaceBelow = viewportHeight - rect.bottom
      const openUpward = spaceBelow < estimatedHeight && rect.top > spaceBelow
      const top = openUpward ? Math.max(12, rect.top - estimatedHeight - 8) : rect.bottom + 8

      setPanelStyle({
        position: "fixed",
        top,
        left: rect.left,
        width: rect.width,
        minWidth: rect.width,
      })
    }

    syncPanelPosition()
    window.addEventListener("resize", syncPanelPosition)
    window.addEventListener("scroll", syncPanelPosition, true)
    return () => {
      window.removeEventListener("resize", syncPanelPosition)
      window.removeEventListener("scroll", syncPanelPosition, true)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
      onBlur?.()
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setOpen(false)
      onBlur?.()
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [open, onBlur])

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        className={cn(
          "w-full justify-between font-normal",
          triggerClassName,
          !value.trim() && "text-muted-foreground",
          ariaInvalid && "border-destructive ring-1 ring-destructive/20",
        )}
        aria-expanded={open}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate text-left">{value.trim() || placeholder}</span>
        {open ? <ChevronUp className="size-4 shrink-0 opacity-60" /> : <ChevronDown className="size-4 shrink-0 opacity-60" />}
      </Button>

      {open && panelStyle
        ? createPortal(
            <div
              ref={panelRef}
              style={panelStyle}
              className={cn("z-[9999] overflow-hidden", panelClassName)}
            >
              <div className={cn("border-b border-zinc-100", size === "lg" ? "p-3.5" : "p-2.5")}>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search country..."
                    className={cn(
                      "w-full border bg-white transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-emerald-500/70 focus-visible:ring-2 focus-visible:ring-emerald-500/15",
                      searchInputClassName,
                    )}
                  />
                </div>
              </div>
              <ScrollArea className={size === "lg" ? "h-72" : "h-60"}>
                <div className={cn(size === "lg" ? "p-2.5" : "p-1.5")}>
                  {filteredOptions.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">No countries found.</div>
                  ) : (
                    filteredOptions.map((country) => {
                      const selected = country === value
                      return (
                        <button
                          key={country}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between text-left text-zinc-900 transition-colors hover:bg-zinc-50",
                            optionClassName,
                            selected && "bg-emerald-50 text-emerald-700",
                          )}
                          onClick={() => {
                            onChange(country)
                            setOpen(false)
                            onBlur?.()
                          }}
                        >
                          <span className="truncate">{country}</span>
                          {selected ? <Check className="size-4 shrink-0" /> : null}
                        </button>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
