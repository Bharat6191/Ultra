import * as React from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { postJson } from "@/lib/api"

type ContractorCreate = {
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  address: string | null
}

export function CreateContractorDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({
    name: "",
    contact_person: "",
    email: "",
    phone: "",
    address: "",
  })

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const payload: ContractorCreate = {
        name: form.name.trim(),
        contact_person: form.contact_person.trim() ? form.contact_person.trim() : null,
        email: form.email.trim() ? form.email.trim() : null,
        phone: form.phone.trim() ? form.phone.trim() : null,
        address: form.address.trim() ? form.address.trim() : null,
      }
      await postJson("/contractors", payload as unknown as Record<string, unknown>)
      setOpen(false)
      setForm({ name: "", contact_person: "", email: "", phone: "", address: "" })
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create contractor")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Create Contractor</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create contractor</DialogTitle>
          <DialogDescription>Add a new contractor master record.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">Name</div>
            <Input
              id="cc-name"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              placeholder="ABC Contractors Pvt Ltd"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Contact person</div>
              <Input
                id="cc-contact"
                value={form.contact_person}
                onChange={(e) => setForm((s) => ({ ...s, contact_person: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Phone</div>
              <Input
                id="cc-phone"
                value={form.phone}
                onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                placeholder="+91..."
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Email</div>
              <Input
                id="cc-email"
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                placeholder="contractor@example.com"
              />
            </div>
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Address</div>
              <Input
                id="cc-address"
                value={form.address}
                onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))}
                placeholder="Street, City"
              />
            </div>
          </div>
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={saving || !form.name.trim()}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

