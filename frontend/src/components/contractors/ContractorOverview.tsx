import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ContractorOverview({
  contractor,
}: {
  contractor: {
    name: string
    contact_person: string | null
    email: string | null
    phone: string | null
    address: string | null
  }
}) {
  const left = [
    { label: "Name", value: contractor.name },
    { label: "Contact person", value: contractor.contact_person ?? "—" },
  ]
  const right = [
    { label: "Email", value: contractor.email ?? "—" },
    { label: "Phone", value: contractor.phone ?? "—" },
    { label: "Address", value: contractor.address ?? "—" },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Overview</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-3">
          {left.map((it) => (
            <div key={it.label} className="grid gap-1">
              <div className="text-xs text-muted-foreground">{it.label}</div>
              <div className="text-sm font-medium">{it.value}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-3">
          {right.map((it) => (
            <div key={it.label} className="grid gap-1">
              <div className="text-xs text-muted-foreground">{it.label}</div>
              <div className="text-sm font-medium">{it.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

