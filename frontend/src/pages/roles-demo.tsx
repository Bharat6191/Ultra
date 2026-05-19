import * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  Bell,
  BriefcaseBusiness,
  ChevronDown,
  ClipboardList,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type DemoRole = {
  id: string
  name: string
  kind: "System role" | "Operational" | "Read only"
  description: string
  plants: string[]
}

type ModuleActionDefinition = {
  id: string
  label: string
}

type ModuleTabDefinition = {
  id: string
  name: string
  actions: ModuleActionDefinition[]
}

type ModuleDefinition = {
  id: string
  name: string
  summary: string
  icon: LucideIcon
  tabs: ModuleTabDefinition[]
}

type DemoAction = ModuleActionDefinition & {
  enabled: boolean
}

type DemoTab = {
  id: string
  name: string
  actions: DemoAction[]
}

type DemoModule = {
  id: string
  name: string
  summary: string
  icon: LucideIcon
  tabs: DemoTab[]
}

type DemoRoleModules = Record<string, DemoModule[]>

const DEMO_ROLES: DemoRole[] = [
  {
    id: "all-access",
    name: "All Access",
    kind: "System role",
    description: "Platform-wide access across admin modules, workflow routing, notifications, and contractor operations.",
    plants: [],
  },
  {
    id: "read-only-auditor",
    name: "Read-only Auditor",
    kind: "Read only",
    description: "Cross-module visibility for audits and reviews, without change rights.",
    plants: [],
  },
  {
    id: "approval-manager",
    name: "Approval Workflow Manager",
    kind: "Operational",
    description: "Owns approval routing, task actioning, and oversight of pending decisions.",
    plants: ["Pune Plant", "Nashik Plant"],
  },
  {
    id: "notification-admin",
    name: "Notifications Admin",
    kind: "Operational",
    description: "Manages notification settings, recipients, and email templates.",
    plants: [],
  },
  {
    id: "plant-admin",
    name: "Plant Admin",
    kind: "Operational",
    description: "Runs local operations, user-role assignment, and contractor onboarding for assigned plants.",
    plants: ["Pune Plant", "Chennai Plant", "Indore Plant"],
  },
]

const MODULE_LIBRARY: ModuleDefinition[] = [
  {
    id: "settings",
    name: "Settings",
    summary: "Workspace defaults, policy controls, and operational guardrails.",
    icon: Settings,
    tabs: [
      {
        id: "settings",
        name: "Settings",
        actions: [
          { id: "view", label: "View" },
          { id: "manage", label: "Manage" },
          { id: "audit", label: "Audit" },
        ],
      },
    ],
  },
  {
    id: "features",
    name: "Features",
    summary: "Feature flags and module configuration visibility.",
    icon: Sparkles,
    tabs: [
      {
        id: "features",
        name: "Features",
        actions: [
          { id: "view", label: "View" },
          { id: "create", label: "Create" },
          { id: "edit", label: "Edit" },
          { id: "delete", label: "Delete" },
        ],
      },
    ],
  },
  {
    id: "approvals",
    name: "Approvals",
    summary: "Workflow visibility, acting rights, and routing control.",
    icon: ShieldCheck,
    tabs: [
      {
        id: "approvals",
        name: "Approvals",
        actions: [
          { id: "view", label: "View" },
          { id: "act", label: "Act" },
          { id: "manage", label: "Manage" },
        ],
      },
    ],
  },
  {
    id: "tasks",
    name: "Tasks",
    summary: "Operational task lifecycle, assignment, and closure.",
    icon: ClipboardList,
    tabs: [
      {
        id: "tasks",
        name: "Tasks",
        actions: [
          { id: "view", label: "View" },
          { id: "create", label: "Create" },
          { id: "act", label: "Act" },
          { id: "assign", label: "Assign" },
          { id: "close", label: "Close" },
        ],
      },
    ],
  },
  {
    id: "notifications",
    name: "Notifications",
    summary: "Alerts, recipients, and email template administration.",
    icon: Bell,
    tabs: [
      {
        id: "notification-settings",
        name: "Notification settings",
        actions: [{ id: "manage", label: "Manage" }],
      },
      {
        id: "email-templates",
        name: "Email templates",
        actions: [{ id: "manage", label: "Manage" }],
      },
    ],
  },
  {
    id: "contractor-master",
    name: "Contractor master",
    summary: "Vendor onboarding, activation, plant mapping, and document control.",
    icon: BriefcaseBusiness,
    tabs: [
      {
        id: "contractors",
        name: "Contractors",
        actions: [
          { id: "view", label: "View" },
          { id: "create", label: "Create" },
          { id: "edit", label: "Edit" },
          { id: "delete", label: "Delete" },
          { id: "activate", label: "Activate" },
          { id: "manage-plants", label: "Manage plants" },
        ],
      },
      {
        id: "contractor-documents",
        name: "Contractor documents",
        actions: [
          { id: "upload", label: "Upload" },
          { id: "verify", label: "Verify" },
        ],
      },
    ],
  },
]

const ALL_ACTION_IDS = MODULE_LIBRARY.flatMap((module) =>
  module.tabs.flatMap((tab) => tab.actions.map((action) => actionKey(module.id, tab.id, action.id)))
)

const ROLE_ACCESS: Record<string, Set<string>> = {
  "all-access": new Set(ALL_ACTION_IDS),
  "read-only-auditor": new Set([
    "settings.settings.view",
    "features.features.view",
    "approvals.approvals.view",
    "tasks.tasks.view",
    "contractor-master.contractors.view",
  ]),
  "approval-manager": new Set([
    "approvals.approvals.view",
    "approvals.approvals.act",
    "approvals.approvals.manage",
    "tasks.tasks.view",
    "tasks.tasks.act",
    "tasks.tasks.assign",
    "tasks.tasks.close",
    "notifications.notification-settings.manage",
    "notifications.email-templates.manage",
  ]),
  "notification-admin": new Set([
    "settings.settings.view",
    "notifications.notification-settings.manage",
    "notifications.email-templates.manage",
    "tasks.tasks.view",
  ]),
  "plant-admin": new Set([
    "settings.settings.view",
    "features.features.view",
    "tasks.tasks.view",
    "tasks.tasks.create",
    "tasks.tasks.assign",
    "notifications.notification-settings.manage",
    "contractor-master.contractors.view",
    "contractor-master.contractors.create",
    "contractor-master.contractors.edit",
    "contractor-master.contractors.activate",
    "contractor-master.contractors.manage-plants",
    "contractor-master.contractor-documents.upload",
    "contractor-master.contractor-documents.verify",
  ]),
}

const INITIAL_EXPANDED_MODULES = new Set(MODULE_LIBRARY.slice(0, 4).map((module) => module.id))

function actionKey(moduleId: string, tabId: string, actionId: string) {
  return `${moduleId}.${tabId}.${actionId}`
}

function buildModules(allowed: Set<string>): DemoModule[] {
  return MODULE_LIBRARY.map((module) => ({
    ...module,
    tabs: module.tabs.map((tab) => ({
      ...tab,
      actions: tab.actions.map((action) => ({
        ...action,
        enabled: allowed.has(actionKey(module.id, tab.id, action.id)),
      })),
    })),
  }))
}

function cloneModules(modules: DemoModule[]): DemoModule[] {
  return modules.map((module) => ({
    ...module,
    tabs: module.tabs.map((tab) => ({
      ...tab,
      actions: tab.actions.map((action) => ({ ...action })),
    })),
  }))
}

function buildInitialRoleModules(): DemoRoleModules {
  return Object.fromEntries(
    DEMO_ROLES.map((role) => [role.id, buildModules(ROLE_ACCESS[role.id] ?? new Set<string>())])
  )
}

function moduleStats(module: DemoModule) {
  const total = module.tabs.reduce((sum, tab) => sum + tab.actions.length, 0)
  const enabled = module.tabs.reduce(
    (sum, tab) => sum + tab.actions.filter((action) => action.enabled).length,
    0
  )
  return {
    total,
    enabled,
    isFull: enabled === total,
  }
}

function roleStats(modules: DemoModule[]) {
  const total = modules.reduce((sum, module) => sum + moduleStats(module).total, 0)
  const enabled = modules.reduce((sum, module) => sum + moduleStats(module).enabled, 0)
  const fullModules = modules.filter((module) => moduleStats(module).isFull).length
  return { total, enabled, fullModules }
}

function roleSnapshot(modules: DemoModule[]) {
  return JSON.stringify(
    modules.map((module) => ({
      id: module.id,
      tabs: module.tabs.map((tab) => ({
        id: tab.id,
        actions: tab.actions.map((action) => ({
          id: action.id,
          enabled: action.enabled,
        })),
      })),
    }))
  )
}

function roleKindBadgeVariant(kind: DemoRole["kind"]) {
  if (kind === "System role") return "outline"
  if (kind === "Read only") return "secondary"
  return "outline"
}

export function RolesRedesignDemoPage() {
  const [search, setSearch] = React.useState("")
  const [selectedRoleId, setSelectedRoleId] = React.useState(DEMO_ROLES[0]?.id ?? "")
  const [initialModulesByRole, setInitialModulesByRole] = React.useState<DemoRoleModules>(() =>
    buildInitialRoleModules()
  )
  const [modulesByRole, setModulesByRole] = React.useState<DemoRoleModules>(() =>
    buildInitialRoleModules()
  )
  const [expandedModules, setExpandedModules] = React.useState<Set<string>>(
    () => new Set(INITIAL_EXPANDED_MODULES)
  )
  const [lastSavedRoleId, setLastSavedRoleId] = React.useState<string | null>(null)

  const filteredRoles = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return DEMO_ROLES
    return DEMO_ROLES.filter((role) => {
      const haystack = `${role.name} ${role.kind} ${role.description}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [search])

  const activeRole =
    DEMO_ROLES.find((role) => role.id === selectedRoleId) ??
    filteredRoles[0] ??
    DEMO_ROLES[0]

  const activeModules = modulesByRole[activeRole.id] ?? []
  const activeInitialModules = initialModulesByRole[activeRole.id] ?? []
  const activeStats = roleStats(activeModules)
  const activeHasUnsaved = roleSnapshot(activeModules) !== roleSnapshot(activeInitialModules)

  React.useEffect(() => {
    if (!filteredRoles.some((role) => role.id === selectedRoleId) && filteredRoles[0]) {
      setSelectedRoleId(filteredRoles[0].id)
    }
  }, [filteredRoles, selectedRoleId])

  function toggleModule(moduleId: string) {
    setExpandedModules((current) => {
      const next = new Set(current)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }

  function toggleAction(moduleId: string, tabId: string, actionId: string) {
    setLastSavedRoleId(null)
    setModulesByRole((current) => ({
      ...current,
      [activeRole.id]: (current[activeRole.id] ?? []).map((module) =>
        module.id !== moduleId
          ? module
          : {
              ...module,
              tabs: module.tabs.map((tab) =>
                tab.id !== tabId
                  ? tab
                  : {
                      ...tab,
                      actions: tab.actions.map((action) =>
                        action.id !== actionId ? action : { ...action, enabled: !action.enabled }
                      ),
                    }
              ),
            }
      ),
    }))
  }

  function setModuleEnabled(moduleId: string, enabled: boolean) {
    setLastSavedRoleId(null)
    setModulesByRole((current) => ({
      ...current,
      [activeRole.id]: (current[activeRole.id] ?? []).map((module) =>
        module.id !== moduleId
          ? module
          : {
              ...module,
              tabs: module.tabs.map((tab) => ({
                ...tab,
                actions: tab.actions.map((action) => ({ ...action, enabled })),
              })),
            }
      ),
    }))
  }

  function saveDemoState() {
    setInitialModulesByRole((current) => ({
      ...current,
      [activeRole.id]: cloneModules(modulesByRole[activeRole.id] ?? []),
    }))
    setLastSavedRoleId(activeRole.id)
  }

  function resetActiveRole() {
    setLastSavedRoleId(null)
    setModulesByRole((current) => ({
      ...current,
      [activeRole.id]: cloneModules(initialModulesByRole[activeRole.id] ?? []),
    }))
  }

  function restoreDemoDefaults() {
    const defaults = buildInitialRoleModules()
    setInitialModulesByRole(defaults)
    setModulesByRole(buildInitialRoleModules())
    setExpandedModules(new Set(INITIAL_EXPANDED_MODULES))
    setLastSavedRoleId(null)
  }

  return (
    <div className="min-h-svh bg-stone-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Roles redesign demo</Badge>
              <Badge variant="outline">Preview only</Badge>
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Role editor concept</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                A card-based editor that gives high-level role context first, then exposes module actions as compact pills instead of a long spreadsheet.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/dashboard/roles">Open live editor</Link>
            </Button>
            <Button variant="secondary" onClick={restoreDemoDefaults}>
              Restore defaults
            </Button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="border-zinc-200 bg-white">
            <CardHeader className="space-y-4">
              <div>
                <CardTitle>Roles</CardTitle>
                <CardDescription>Search, scan scope, and jump into a role without losing context.</CardDescription>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search roles"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredRoles.map((role) => {
                const modules = modulesByRole[role.id] ?? []
                const stats = roleStats(modules)
                const isActive = role.id === activeRole.id
                const scopeLabel = role.plants.length === 0 ? "Global" : `${role.plants.length} plants`
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3 text-left transition",
                      isActive
                        ? "border-zinc-300 bg-zinc-50 shadow-sm"
                        : "border-gray-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-950">{role.name}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {role.description}
                        </div>
                      </div>
                      <div className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
                        {stats.enabled}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant={roleKindBadgeVariant(role.kind)}>{role.kind}</Badge>
                      <Badge variant="outline">{scopeLabel}</Badge>
                      <Badge variant="outline">{stats.fullModules}/{modules.length} full modules</Badge>
                    </div>
                  </button>
                )
              })}
              {filteredRoles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-muted-foreground">
                  No roles match this search.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="overflow-hidden border-zinc-200 bg-white shadow-sm">
              <CardContent className="px-6 pb-6 pt-6">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={roleKindBadgeVariant(activeRole.kind)}>{activeRole.kind}</Badge>
                        <Badge variant="outline">
                          {activeRole.plants.length === 0 ? "Global role" : `${activeRole.plants.length} plants`}
                        </Badge>
                        <Badge variant="outline">
                          {activeStats.enabled}/{activeStats.total} actions enabled
                        </Badge>
                      </div>
                      <div>
                        <h2 className="text-3xl font-semibold tracking-tight text-zinc-950">{activeRole.name}</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                          {activeRole.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={resetActiveRole} disabled={!activeHasUnsaved}>
                        Discard
                      </Button>
                      <Button
                        onClick={saveDemoState}
                        disabled={!activeHasUnsaved}
                        className="border border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800"
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Coverage
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">
                        {Math.round((activeStats.enabled / Math.max(activeStats.total, 1)) * 100)}%
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Enabled actions across all modules
                      </div>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Module depth
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">
                        {activeStats.fullModules}/{activeModules.length}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Modules currently at full access
                      </div>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Status
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">
                        {activeHasUnsaved ? "Draft" : "Saved"}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {activeHasUnsaved
                          ? "You have unsaved changes in this preview."
                          : lastSavedRoleId === activeRole.id
                            ? "Demo state saved for this role."
                            : "Matches the seeded demo defaults."}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                {activeModules.map((module) => {
                  const stats = moduleStats(module)
                  const isExpanded = expandedModules.has(module.id)
                  const coverage = Math.round((stats.enabled / Math.max(stats.total, 1)) * 100)
                  const Icon = module.icon
                  return (
                    <Card key={module.id} className="border-gray-200 bg-white/95">
                      <CardContent className="px-5 pb-5 pt-5">
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="flex items-start gap-3">
                              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
                                <Icon className="size-5" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-base font-semibold text-zinc-950">{module.name}</h3>
                                  <Badge
                                    variant={stats.isFull ? "secondary" : "outline"}
                                    className={stats.isFull ? "bg-zinc-100 text-zinc-700" : undefined}
                                  >
                                    {stats.isFull ? "Full access" : `${stats.enabled}/${stats.total} actions`}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">{module.summary}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <div className="mr-1 flex items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-2">
                                <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200">
                                  <div
                                    className="h-full rounded-full bg-zinc-900 transition-[width]"
                                    style={{ width: `${coverage}%` }}
                                  />
                                </div>
                                <span className="text-xs font-medium text-zinc-600">{coverage}%</span>
                              </div>
                              <Button variant="outline" size="xs" onClick={() => setModuleEnabled(module.id, true)}>
                                Select all
                              </Button>
                              <Button variant="outline" size="xs" onClick={() => setModuleEnabled(module.id, false)}>
                                Clear
                              </Button>
                              <Button variant="secondary" size="icon-xs" onClick={() => toggleModule(module.id)}>
                                <ChevronDown
                                  className={cn("size-4 transition-transform", isExpanded ? "rotate-0" : "-rotate-90")}
                                />
                              </Button>
                            </div>
                          </div>

                          {isExpanded ? (
                            <div className="space-y-3">
                              {module.tabs.map((tab) => (
                                <div
                                  key={tab.id}
                                  className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-zinc-900">{tab.name}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      Compact action pills make it easier to scan than isolated checkboxes.
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {tab.actions.map((action) => (
                                      <button
                                        key={action.id}
                                        type="button"
                                        onClick={() => toggleAction(module.id, tab.id, action.id)}
                                        className={cn(
                                          "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                                          action.enabled
                                            ? "border-zinc-300 bg-zinc-100 text-zinc-900 shadow-sm"
                                            : "border-gray-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
                                        )}
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              <div className="space-y-4">
                <Card className="border-gray-200 bg-white/95">
                  <CardHeader>
                    <CardTitle>Scope</CardTitle>
                    <CardDescription>Plant visibility is treated as first-class metadata instead of an afterthought above the table.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {activeRole.plants.length === 0 ? (
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                        <div className="text-sm font-semibold text-zinc-900">Global role</div>
                        <div className="mt-1 text-sm text-zinc-700">
                          This role can be assigned at any plant. No plant-level restriction is applied.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-sm text-muted-foreground">
                          This role is limited to selected plants during assignment.
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {activeRole.plants.map((plant) => (
                            <Badge key={plant} variant="outline" className="h-auto px-3 py-1.5 text-sm">
                              {plant}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-gray-200 bg-white/95">
                  <CardHeader>
                    <CardTitle>Why this reads better</CardTitle>
                    <CardDescription>The redesign removes the "spreadsheet first" feeling from the current screen.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <div className="rounded-2xl bg-gray-50 px-4 py-3">
                      The role summary gives admins context immediately: type, scope, coverage, and save state.
                    </div>
                    <div className="rounded-2xl bg-gray-50 px-4 py-3">
                      Each module becomes a compact card with a visible access score, rather than a long row block.
                    </div>
                    <div className="rounded-2xl bg-gray-50 px-4 py-3">
                      Action pills are faster to scan than detached checkboxes, especially for "All Access" roles.
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
