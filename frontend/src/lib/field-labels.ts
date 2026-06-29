const DEFAULT_FIELD_LABELS: Record<string, string> = {
  approval_request_id: "Approval Request ID",
  approver_role_id: "Approver Role ID",
  approver_role_name: "Approver Role Name",
  comment_id: "Comment ID",
  contractor_code: "Contractor Code",
  contractor_id: "Contractor ID",
  current_round: "Current Round",
  current_step: "Current Step",
  document_name: "Document Name",
  document_type: "Document Type",
  effective_from: "Effective From",
  effective_to: "Effective To",
  entity_id: "Entity ID",
  entity_type: "Entity Type",
  full_name: "Full Name",
  initial_rate: "Initial Rate",
  is_active: "Active",
  new_task_id: "New Task ID",
  org_unit_id: "Org Unit ID",
  org_unit_name: "Org Unit Name",
  pan: "PAN Number",
  pan_number: "PAN Number",
  part_master_id: "Part Master ID",
  postal_code: "Postal Code",
  request_id: "Request ID",
  role_id: "Role ID",
  role_name: "Role Name",
  task_id: "Task ID",
  user_id: "User ID",
}

const TOKEN_LABELS: Record<string, string> = {
  api: "API",
  cin: "CIN Number",
  gst: "GST Number",
  gstin: "GSTIN Number",
  id: "ID",
  pan: "PAN Number",
  po: "PO",
  uom: "UOM",
  url: "URL",
  wo: "WO",
}

export function humanizeFieldKey(
  key: string,
  overrides?: Record<string, string>,
): string {
  const trimmed = key.trim()
  if (!trimmed) return key
  const custom = overrides?.[trimmed] ?? DEFAULT_FIELD_LABELS[trimmed]
  if (custom) return custom
  return trimmed
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((part) => TOKEN_LABELS[part.toLowerCase()] ?? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}
