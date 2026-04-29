import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function ContractorHeader({
  name,
  isActive,
  onEdit,
}: {
  name: string
  isActive: boolean
  onEdit?: () => void
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950">{name}</h1>
          <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">Contractor master profile</div>
      </div>
      {onEdit ? (
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
      ) : null}
    </div>
  )
}

