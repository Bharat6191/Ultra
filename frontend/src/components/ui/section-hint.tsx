import { CircleHelp } from "lucide-react"

export function SectionHint({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="inline-flex shrink-0 rounded-sm p-0.5 text-muted-foreground outline-offset-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      title={text}
      aria-label={text}
    >
      <CircleHelp className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  )
}
