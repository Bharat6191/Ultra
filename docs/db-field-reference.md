# Database Field Reference

This reference is based on the SQLAlchemy models currently registered in `Ultra/backend/db/models/__init__.py`.

## Scope

- The live metadata currently contains `56` tables.
- This file shows the real column names, SQL types, primary keys, foreign keys, nullability, and server defaults.
- Some columns are logical links only and are **not** enforced as database foreign keys:
  - `contractor_rates.approval_request_id`
  - `work_orders.approval_request_id`
  - `work_order_items.override_approval_request_id`
  - `invoices.approval_request_id`
  - `invoice_lines.resolved_contractor_rate_id`
  - `invoice_lines.resolved_part_master_id`

## Domain Map

- Identity and security: `users`, `user_sessions`, `password_reset_tokens`, `auth_policies`, `user_mfa`, `mfa_challenges`, `mfa_setup_tokens`
- RBAC and org structure: `features`, `permissions`, `roles`, `user_roles`, `user_org_units`, `role_permissions`, `role_org_units`, `org_units`, `rbac_audit_logs`, `rbac_company_permission_versions`, `rbac_user_permission_versions`
- Approvals and inbox: `approval_workflows`, `approval_workflow_mappings`, `approval_steps`, `approval_requests`, `approval_tasks`, `approval_actions`, `task_comments`, `task_audit_logs`
- Contractor master and compliance: `contractors`, `contractor_plants`, `contractor_documents`, `contractor_document_versions`, `contractor_compliance_configs`, `contractor_audit_logs`
- Commercial master and negotiations: `part_master`, `part_master_versions`, `part_master_attachments`, `part_master_audit_logs`, `contractor_rates`, `contractor_rate_versions`, `contractor_rate_audit_logs`, `negotiation_logs`, `negotiation_attachments`
- Operations and billing: `work_orders`, `work_order_items`, `work_order_item_progress`, `work_order_audit_logs`, `invoices`, `invoice_lines`, `invoice_extra_lines`, `invoice_validation_issues`, `invoice_attachments`, `invoice_audit_logs`, `contractor_invoice_compliance`
- Platform support: `settings`, `notification_settings`, `notification_dedup_keys`, `audit_logs`

## Important Non-Obvious Fields

- `contractor_documents.file_path` stores the latest uploaded file path; `contractor_document_versions` keeps the immutable upload history.
- `contractor_documents.file_url` is a backward-compatibility column for older clients.
- `contractor_documents.issue_date` and `issued_date` both exist; `issued_date` is a legacy compatibility field.
- `part_master.billing_basis` controls how invoice math is applied. Current code uses `WEIGHT`, `PCS`, or `MANUAL`.
- `part_master.allow_manual_amount_override` allows manual commercial override behavior at the part level.
- `work_order_items.pricing_snapshot` stores a point-in-time copy of part pricing context so later part changes do not rewrite older work orders.
- `work_order_items.weight_per_piece_snapshot` preserves the conversion factor used when the rate is weight-based.
- `work_order_items.taxable_value` is the stored commercial value used for audit and invoice-cap logic.
- `work_orders.approved_value_total` is the approved total ex-VAT ceiling used to govern cumulative invoice value.
- `invoice_lines.resolved_contractor_rate_id` and `invoice_lines.resolved_part_master_id` are traceability snapshots, not hard foreign keys.
- `invoice_extra_lines` holds freight, rounding, or other ad-hoc charges not tied to a work order item.
- `invoices.extra_amount_ex_vat` is the total ex-VAT adjustment amount from extra lines and similar charges.
- `invoices.validation_status` is a denormalized summary used by dashboards and approval routing.
- `contractor_invoice_compliance.compliance_score` is a derived contractor-level score stored for fast analytics.
- `approval_requests.payload` captures the approval payload snapshot at the time the request is opened.
- `approval_tasks.form_schema` and `approval_tasks.form_data` support unified manual or approval-driven tasks in the inbox.

## Common Status and Enum Values

- `contractors.status`: `draft`, `pending`, `active`, `suspended`, `blacklisted`, `expired`, `non_compliant`
- `contractors.contractor_type`: `vendor`, `labour`, `service`, `epc`
- `contractor_plants.role`: `approved_vendor`, `temporary`, `restricted`
- `contractor_documents.verification_status`: `pending`, `verified`, `rejected`
- `part_master.pricing_method`: `weight_based`, `piece_based`
- `part_master.billing_basis`: `WEIGHT`, `PCS`, `MANUAL`
- `part_master.status`: `draft`, `active`, `inactive`, `superseded`
- `contractor_rates.status`: `draft`, `pending_approval`, `approved`, `rejected`, `expired`, `cancelled`
- `work_orders.status`: `draft`, `pending_approval`, `approved`, `rejected`, `cancelled`, `active`, `closed`
- `work_order_items.progress_type`: `quantity`, `percentage`
- `work_order_items.rate_source` and `invoice_lines.rate_source`: `master`, `negotiated`, `override`
- `work_order_items.override_status`: `pending`, `approved`, `rejected`
- `invoices.status`: `draft`, `submitted`, `blocked`, `pending_exception_approval`, `approved`, `rejected`, `paid`, `cancelled`
- `invoices.validation_status`: `pass`, `warn`, `fail`, `blocked`
- `invoice_validation_issues.severity`: `info`, `warning`, `error`, `blocker`
- `approval_requests.status`: `pending`, `approved`, `rejected`, `in_rework`
- `approval_tasks.task_type`: defaults to `approval`; the model also supports unified manual tasks
- `approval_actions.action`: `approve`, `reject`

## Full Table Reference

## `approval_actions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `task_id` | `INTEGER` | FK -> approval_tasks.id | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `action` | `VARCHAR(16)` | - | NO | `` |
| `comment` | `TEXT` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `approval_requests`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `workflow_id` | `INTEGER` | FK -> approval_workflows.id | NO | `` |
| `entity_type` | `VARCHAR(64)` | - | NO | `` |
| `entity_id` | `INTEGER` | - | NO | `` |
| `status` | `VARCHAR(16)` | - | NO | `pending` |
| `current_step` | `INTEGER` | - | NO | `1` |
| `payload` | `JSON` | - | NO | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `last_resubmitted_at` | `DATETIME` | - | YES | `` |

## `approval_steps`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `workflow_id` | `INTEGER` | FK -> approval_workflows.id | NO | `` |
| `step_order` | `INTEGER` | - | NO | `` |
| `approver_role_id` | `INTEGER` | FK -> roles.id | NO | `` |
| `required_approvals` | `INTEGER` | - | NO | `1` |

## `approval_tasks`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `task_type` | `VARCHAR(16)` | - | NO | `approval` |
| `title` | `VARCHAR(255)` | - | YES | `` |
| `description` | `TEXT` | - | YES | `` |
| `entity_type` | `VARCHAR(64)` | - | YES | `` |
| `entity_id` | `INTEGER` | - | YES | `` |
| `form_schema` | `JSON` | - | YES | `` |
| `form_data` | `JSON` | - | YES | `` |
| `due_date` | `DATETIME` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `assigned_to_user_id` | `INTEGER` | FK -> users.id | YES | `` |
| `closed_at` | `DATETIME` | - | YES | `` |
| `request_id` | `INTEGER` | FK -> approval_requests.id | YES | `` |
| `step_id` | `INTEGER` | FK -> approval_steps.id | YES | `` |
| `assigned_user_id` | `INTEGER` | FK -> users.id | YES | `` |
| `assigned_role_id` | `INTEGER` | FK -> roles.id | YES | `` |
| `status` | `VARCHAR(16)` | - | NO | `pending` |
| `acted_at` | `DATETIME` | - | YES | `` |

## `approval_workflow_mappings`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `action_code` | `VARCHAR(128)` | - | NO | `` |
| `workflow_id` | `INTEGER` | FK -> approval_workflows.id | NO | `` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `approval_workflows`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `name` | `VARCHAR(255)` | - | NO | `` |
| `entity_type` | `VARCHAR(64)` | - | NO | `` |
| `is_active` | `BOOLEAN` | - | NO | `false` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `actor_user_id` | `INTEGER` | FK -> users.id | YES | `` |
| `action` | `VARCHAR(16)` | - | NO | `` |
| `path` | `VARCHAR(2048)` | - | NO | `` |
| `status_code` | `INTEGER` | - | YES | `` |
| `client_ip` | `VARCHAR(45)` | - | YES | `` |
| `user_agent` | `VARCHAR(512)` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `auth_policies`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `company_id` | `INTEGER` | FK -> org_units.id | NO | `` |
| `password_enabled` | `BOOLEAN` | - | NO | `true` |
| `mfa_enabled` | `BOOLEAN` | - | NO | `false` |
| `captcha_enabled` | `BOOLEAN` | - | NO | `false` |
| `mfa_enforced` | `BOOLEAN` | - | NO | `false` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `contractor_audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_id` | `INTEGER` | FK -> contractors.id | NO | `` |
| `action` | `VARCHAR(64)` | - | NO | `` |
| `changed_by` | `INTEGER` | FK -> users.id | YES | `` |
| `old_value` | `JSON` | - | YES | `` |
| `new_value` | `JSON` | - | YES | `` |
| `metadata_json` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `contractor_compliance_configs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `document_type` | `VARCHAR(64)` | - | NO | `` |
| `label` | `VARCHAR(255)` | - | YES | `` |
| `is_critical` | `BOOLEAN` | - | NO | `true` |
| `warn_days` | `INTEGER` | - | NO | `7` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `contractor_document_versions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `document_id` | `INTEGER` | FK -> contractor_documents.id | NO | `` |
| `version_number` | `INTEGER` | - | NO | `` |
| `file_path` | `VARCHAR(1024)` | - | NO | `` |
| `issue_date` | `DATE` | - | YES | `` |
| `expiry_date` | `DATE` | - | YES | `` |
| `remarks` | `TEXT` | - | YES | `` |
| `uploaded_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `contractor_documents`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_id` | `INTEGER` | FK -> contractors.id | NO | `` |
| `document_name` | `VARCHAR(255)` | - | NO | `` |
| `document_type` | `VARCHAR(64)` | - | NO | `` |
| `file_path` | `VARCHAR(1024)` | - | NO | `` |
| `file_url` | `VARCHAR(1024)` | - | YES | `` |
| `issue_date` | `DATE` | - | YES | `` |
| `issued_date` | `DATE` | - | YES | `` |
| `expiry_date` | `DATE` | - | YES | `` |
| `verification_status` | `VARCHAR(16)` | - | NO | `pending` |
| `verified_by` | `INTEGER` | FK -> users.id | YES | `` |
| `verified_at` | `DATETIME` | - | YES | `` |
| `remarks` | `TEXT` | - | YES | `` |
| `current_version` | `INTEGER` | - | NO | `1` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `contractor_invoice_compliance`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_id` | `INTEGER` | FK -> contractors.id | NO | `` |
| `invoices_total` | `INTEGER` | - | NO | `0` |
| `invoices_blocked` | `INTEGER` | - | NO | `0` |
| `tolerance_breaches` | `INTEGER` | - | NO | `0` |
| `exception_approvals` | `INTEGER` | - | NO | `0` |
| `overbilling_attempts` | `INTEGER` | - | NO | `0` |
| `compliance_score` | `NUMERIC(7, 2)` | - | NO | `100` |
| `last_computed_at` | `DATETIME` | - | YES | `` |

## `contractor_plants`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_id` | `INTEGER` | FK -> contractors.id | NO | `` |
| `org_unit_id` | `INTEGER` | FK -> org_units.id | NO | `` |
| `role` | `VARCHAR(32)` | - | NO | `approved_vendor` |
| `start_date` | `DATE` | - | YES | `` |
| `end_date` | `DATE` | - | YES | `` |
| `notes` | `TEXT` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `contractor_rate_audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_rate_id` | `INTEGER` | FK -> contractor_rates.id | NO | `` |
| `action` | `VARCHAR(64)` | - | NO | `` |
| `changed_by` | `INTEGER` | FK -> users.id | YES | `` |
| `old_value` | `JSON` | - | YES | `` |
| `new_value` | `JSON` | - | YES | `` |
| `metadata_json` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `contractor_rate_versions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_rate_id` | `INTEGER` | FK -> contractor_rates.id | NO | `` |
| `version_number` | `INTEGER` | - | NO | `` |
| `snapshot_json` | `JSON` | - | NO | `` |
| `change_reason` | `VARCHAR(64)` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `contractor_rates`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_id` | `INTEGER` | FK -> contractors.id | NO | `` |
| `part_master_id` | `INTEGER` | FK -> part_master.id | NO | `` |
| `negotiated_rate` | `NUMERIC(12, 2)` | - | NO | `` |
| `initial_rate` | `NUMERIC(12, 2)` | - | YES | `` |
| `previous_rate` | `NUMERIC(12, 2)` | - | YES | `` |
| `savings_amount` | `NUMERIC(12, 2)` | - | YES | `` |
| `savings_percentage` | `NUMERIC(7, 2)` | - | YES | `` |
| `effective_from` | `DATE` | - | NO | `` |
| `effective_to` | `DATE` | - | YES | `` |
| `status` | `VARCHAR(32)` | - | NO | `draft` |
| `current_round` | `INTEGER` | - | NO | `0` |
| `remarks` | `TEXT` | - | YES | `` |
| `approval_request_id` | `INTEGER` | - | YES | `` |
| `approved_by` | `INTEGER` | FK -> users.id | YES | `` |
| `approved_at` | `DATETIME` | - | YES | `` |
| `rejected_by` | `INTEGER` | FK -> users.id | YES | `` |
| `rejected_at` | `DATETIME` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `contractors`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_code` | `VARCHAR(64)` | - | YES | `` |
| `name` | `VARCHAR(255)` | - | NO | `` |
| `legal_name` | `VARCHAR(255)` | - | YES | `` |
| `trade_name` | `VARCHAR(255)` | - | YES | `` |
| `pan` | `VARCHAR(16)` | - | YES | `` |
| `gstin` | `VARCHAR(32)` | - | YES | `` |
| `cin` | `VARCHAR(32)` | - | YES | `` |
| `contractor_type` | `VARCHAR(32)` | - | YES | `` |
| `status` | `VARCHAR(32)` | - | NO | `draft` |
| `contact_person` | `VARCHAR(255)` | - | YES | `` |
| `contact_person_title` | `VARCHAR(128)` | - | YES | `` |
| `email` | `VARCHAR(255)` | - | YES | `` |
| `alternate_email` | `VARCHAR(255)` | - | YES | `` |
| `phone` | `VARCHAR(32)` | - | YES | `` |
| `alternate_phone` | `VARCHAR(32)` | - | YES | `` |
| `address` | `TEXT` | - | YES | `` |
| `city` | `VARCHAR(128)` | - | YES | `` |
| `state` | `VARCHAR(128)` | - | YES | `` |
| `country` | `VARCHAR(128)` | - | YES | `` |
| `postal_code` | `VARCHAR(32)` | - | YES | `` |
| `gst_number` | `VARCHAR(32)` | - | YES | `` |
| `pan_number` | `VARCHAR(16)` | - | YES | `` |
| `registration_number` | `VARCHAR(64)` | - | YES | `` |
| `website` | `VARCHAR(255)` | - | YES | `` |
| `notes` | `TEXT` | - | YES | `` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `updated_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `features`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `key` | `VARCHAR(100)` | - | NO | `` |
| `name` | `VARCHAR(255)` | - | NO | `` |
| `description` | `TEXT` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `invoice_attachments`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `invoice_id` | `INTEGER` | FK -> invoices.id | NO | `` |
| `file_path` | `VARCHAR(1024)` | - | NO | `` |
| `file_name` | `VARCHAR(255)` | - | YES | `` |
| `content_type` | `VARCHAR(128)` | - | YES | `` |
| `uploaded_by` | `INTEGER` | FK -> users.id | YES | `` |
| `uploaded_at` | `DATETIME` | - | NO | `now()` |

## `invoice_audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `invoice_id` | `INTEGER` | FK -> invoices.id | NO | `` |
| `action` | `VARCHAR(64)` | - | NO | `` |
| `changed_by` | `INTEGER` | FK -> users.id | YES | `` |
| `old_value` | `JSON` | - | YES | `` |
| `new_value` | `JSON` | - | YES | `` |
| `metadata_json` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `invoice_extra_lines`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `invoice_id` | `INTEGER` | FK -> invoices.id | NO | `` |
| `description` | `VARCHAR(512)` | - | NO | `` |
| `quantity` | `NUMERIC(14, 3)` | - | YES | `` |
| `unit` | `VARCHAR(32)` | - | YES | `` |
| `unit_price` | `NUMERIC(14, 2)` | - | YES | `` |
| `amount_ex_vat` | `NUMERIC(14, 2)` | - | NO | `` |
| `sort_order` | `INTEGER` | - | NO | `0` |

## `invoice_lines`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `invoice_id` | `INTEGER` | FK -> invoices.id | NO | `` |
| `work_order_item_id` | `INTEGER` | FK -> work_order_items.id | NO | `` |
| `quantity` | `NUMERIC(14, 3)` | - | NO | `` |
| `rate` | `NUMERIC(12, 2)` | - | NO | `` |
| `amount` | `NUMERIC(14, 2)` | - | NO | `` |
| `tax_pct` | `NUMERIC(7, 4)` | - | YES | `` |
| `rate_source` | `VARCHAR(16)` | - | YES | `` |
| `resolved_contractor_rate_id` | `INTEGER` | - | YES | `` |
| `resolved_part_master_id` | `INTEGER` | - | YES | `` |
| `notes` | `TEXT` | - | YES | `` |

## `invoice_validation_issues`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `invoice_id` | `INTEGER` | FK -> invoices.id | NO | `` |
| `line_id` | `INTEGER` | FK -> invoice_lines.id | YES | `` |
| `code` | `VARCHAR(64)` | - | NO | `` |
| `severity` | `VARCHAR(16)` | - | NO | `warning` |
| `message` | `TEXT` | - | NO | `` |
| `allowed_value` | `NUMERIC(14, 2)` | - | YES | `` |
| `actual_value` | `NUMERIC(14, 2)` | - | YES | `` |
| `allowed_qty` | `NUMERIC(14, 3)` | - | YES | `` |
| `actual_qty` | `NUMERIC(14, 3)` | - | YES | `` |
| `tolerance_pct` | `NUMERIC(7, 2)` | - | YES | `` |
| `requires_justification` | `BOOLEAN` | - | NO | `false` |
| `requires_attachments` | `BOOLEAN` | - | NO | `false` |
| `justification` | `TEXT` | - | YES | `` |
| `metadata_json` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `invoices`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_id` | `INTEGER` | FK -> contractors.id | NO | `` |
| `org_unit_id` | `INTEGER` | FK -> org_units.id | NO | `` |
| `invoice_number` | `VARCHAR(64)` | - | NO | `` |
| `invoice_date` | `DATE` | - | NO | `` |
| `status` | `VARCHAR(32)` | - | NO | `draft` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `currency` | `VARCHAR(8)` | - | NO | `INR` |
| `total_amount` | `NUMERIC(14, 2)` | - | NO | `0` |
| `extra_amount_ex_vat` | `NUMERIC(14, 2)` | - | NO | `0` |
| `last_validated_at` | `DATETIME` | - | YES | `` |
| `validation_status` | `VARCHAR(16)` | - | YES | `` |
| `validation_score` | `NUMERIC(7, 2)` | - | YES | `` |
| `approval_request_id` | `INTEGER` | - | YES | `` |
| `approved_by` | `INTEGER` | FK -> users.id | YES | `` |
| `approved_at` | `DATETIME` | - | YES | `` |
| `rejected_by` | `INTEGER` | FK -> users.id | YES | `` |
| `rejected_at` | `DATETIME` | - | YES | `` |
| `submitted_by` | `INTEGER` | FK -> users.id | YES | `` |
| `submitted_at` | `DATETIME` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `mfa_challenges`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `token_hash` | `VARCHAR(64)` | - | NO | `` |
| `expires_at` | `DATETIME` | - | NO | `` |
| `used_at` | `DATETIME` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `mfa_setup_tokens`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `token_hash` | `VARCHAR(64)` | - | NO | `` |
| `expires_at` | `DATETIME` | - | NO | `` |
| `used_at` | `DATETIME` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `negotiation_attachments`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `negotiation_log_id` | `INTEGER` | FK -> negotiation_logs.id | NO | `` |
| `file_path` | `VARCHAR(1024)` | - | NO | `` |
| `file_name` | `VARCHAR(255)` | - | YES | `` |
| `content_type` | `VARCHAR(128)` | - | YES | `` |
| `uploaded_by` | `INTEGER` | FK -> users.id | YES | `` |
| `uploaded_at` | `DATETIME` | - | NO | `now()` |

## `negotiation_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `contractor_rate_id` | `INTEGER` | FK -> contractor_rates.id | NO | `` |
| `round_number` | `INTEGER` | - | NO | `` |
| `proposed_rate` | `NUMERIC(12, 2)` | - | YES | `` |
| `counter_rate` | `NUMERIC(12, 2)` | - | YES | `` |
| `remarks` | `TEXT` | - | YES | `` |
| `round_summary` | `VARCHAR(255)` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `notification_dedup_keys`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `key` | `VARCHAR(255)` | PK | NO | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `notification_settings`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `event_code` | `VARCHAR(128)` | - | NO | `` |
| `notify_roles` | `JSONB` | - | YES | `` |
| `days_before` | `INTEGER` | - | NO | `7` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `org_units`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `name` | `VARCHAR(255)` | - | NO | `` |
| `type` | `VARCHAR(32)` | - | NO | `` |
| `parent_id` | `INTEGER` | FK -> org_units.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `part_master`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `part_code` | `VARCHAR(64)` | - | NO | `` |
| `part_name` | `VARCHAR(255)` | - | NO | `` |
| `description` | `TEXT` | - | YES | `` |
| `unit_type` | `VARCHAR(32)` | - | NO | `` |
| `pricing_method` | `VARCHAR(32)` | - | NO | `` |
| `billing_basis` | `VARCHAR(16)` | - | NO | `PCS` |
| `allow_manual_amount_override` | `BOOLEAN` | - | NO | `false` |
| `weight_per_piece` | `NUMERIC(14, 6)` | - | YES | `` |
| `labour_headcount` | `INTEGER` | - | YES | `` |
| `standard_man_hours` | `NUMERIC(10, 2)` | - | YES | `` |
| `labour_cost` | `NUMERIC(14, 2)` | - | YES | `` |
| `man_days` | `NUMERIC(14, 4)` | - | YES | `` |
| `base_rate` | `NUMERIC(12, 2)` | - | NO | `` |
| `rate_unit_type` | `VARCHAR(32)` | - | NO | `` |
| `org_unit_id` | `INTEGER` | FK -> org_units.id | NO | `` |
| `effective_from` | `DATE` | - | NO | `` |
| `effective_to` | `DATE` | - | YES | `` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `status` | `VARCHAR(32)` | - | NO | `active` |
| `notes` | `TEXT` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `part_master_attachments`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `part_master_id` | `INTEGER` | FK -> part_master.id | NO | `` |
| `file_path` | `VARCHAR(1024)` | - | NO | `` |
| `file_name` | `VARCHAR(255)` | - | YES | `` |
| `content_type` | `VARCHAR(128)` | - | YES | `` |
| `uploaded_by` | `INTEGER` | FK -> users.id | YES | `` |
| `uploaded_at` | `DATETIME` | - | NO | `now()` |

## `part_master_audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `part_master_id` | `INTEGER` | FK -> part_master.id | NO | `` |
| `action` | `VARCHAR(64)` | - | NO | `` |
| `changed_by` | `INTEGER` | FK -> users.id | YES | `` |
| `old_value` | `JSON` | - | YES | `` |
| `new_value` | `JSON` | - | YES | `` |
| `metadata_json` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `part_master_versions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `part_master_id` | `INTEGER` | FK -> part_master.id | NO | `` |
| `version_number` | `INTEGER` | - | NO | `` |
| `snapshot_json` | `JSON` | - | NO | `` |
| `change_reason` | `VARCHAR(64)` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `password_reset_tokens`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `token_hash` | `VARCHAR(64)` | - | NO | `` |
| `expires_at` | `DATETIME` | - | NO | `` |
| `used_at` | `DATETIME` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `permissions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `feature_id` | `INTEGER` | FK -> features.id | NO | `` |
| `action` | `VARCHAR(32)` | - | NO | `` |
| `code` | `VARCHAR(255)` | - | NO | `` |
| `description` | `TEXT` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `rbac_audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `actor_user_id` | `INTEGER` | FK -> users.id | YES | `` |
| `target_type` | `VARCHAR(32)` | - | NO | `` |
| `target_id` | `INTEGER` | - | NO | `` |
| `action` | `VARCHAR(32)` | - | NO | `` |
| `old_value` | `JSON` | - | YES | `` |
| `new_value` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `rbac_company_permission_versions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `company_id` | `INTEGER` | PK | NO | `` |
| `version` | `INTEGER` | - | NO | `0` |

## `rbac_user_permission_versions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `user_id` | `INTEGER` | PK; FK -> users.id | NO | `` |
| `version` | `INTEGER` | - | NO | `0` |

## `role_org_units`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `role_id` | `INTEGER` | PK; FK -> roles.id | NO | `` |
| `org_unit_id` | `INTEGER` | PK; FK -> org_units.id | NO | `` |

## `role_permissions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `role_id` | `INTEGER` | PK; FK -> roles.id | NO | `` |
| `permission_id` | `INTEGER` | PK; FK -> permissions.id | NO | `` |

## `roles`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `name` | `VARCHAR(128)` | - | NO | `` |
| `description` | `TEXT` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `settings`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `key` | `VARCHAR(255)` | - | NO | `` |
| `value` | `TEXT` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `task_audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `task_id` | `INTEGER` | FK -> approval_tasks.id | NO | `` |
| `action` | `VARCHAR(32)` | - | NO | `` |
| `actor_user_id` | `INTEGER` | FK -> users.id | YES | `` |
| `old_value` | `JSON` | - | YES | `` |
| `new_value` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `task_comments`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `task_id` | `INTEGER` | FK -> approval_tasks.id | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `comment` | `TEXT` | - | NO | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `user_mfa`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `is_enabled` | `BOOLEAN` | - | NO | `true` |
| `secret_encrypted` | `TEXT` | - | NO | `` |
| `setup_completed` | `BOOLEAN` | - | NO | `false` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `user_org_units`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `org_unit_id` | `INTEGER` | FK -> org_units.id | NO | `` |

## `user_roles`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `user_id` | `INTEGER` | PK; FK -> users.id | NO | `` |
| `role_id` | `INTEGER` | PK; FK -> roles.id | NO | `` |

## `user_sessions`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `user_id` | `INTEGER` | FK -> users.id | NO | `` |
| `refresh_jti` | `VARCHAR(36)` | - | NO | `` |
| `expires_at` | `DATETIME` | - | NO | `` |
| `revoked_at` | `DATETIME` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `users`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `full_name` | `VARCHAR(255)` | - | NO | `` |
| `username` | `VARCHAR(64)` | - | NO | `` |
| `email` | `VARCHAR(255)` | - | YES | `` |
| `phone` | `VARCHAR(32)` | - | YES | `` |
| `employee_code` | `VARCHAR(64)` | - | YES | `` |
| `department` | `VARCHAR(128)` | - | YES | `` |
| `designation` | `VARCHAR(128)` | - | YES | `` |
| `address` | `TEXT` | - | YES | `` |
| `hashed_password` | `VARCHAR(255)` | - | NO | `` |
| `password_changed_at` | `DATETIME` | - | NO | `` |
| `is_superuser` | `BOOLEAN` | - | NO | `false` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |

## `work_order_audit_logs`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `work_order_id` | `INTEGER` | FK -> work_orders.id | NO | `` |
| `action` | `VARCHAR(64)` | - | NO | `` |
| `changed_by` | `INTEGER` | FK -> users.id | YES | `` |
| `old_value` | `JSON` | - | YES | `` |
| `new_value` | `JSON` | - | YES | `` |
| `metadata_json` | `JSON` | - | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `work_order_item_progress`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `work_order_item_id` | `INTEGER` | FK -> work_order_items.id | NO | `` |
| `completed_quantity` | `NUMERIC(14, 3)` | - | YES | `` |
| `completed_percentage` | `NUMERIC(7, 2)` | - | YES | `` |
| `remarks` | `TEXT` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |

## `work_order_items`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `work_order_id` | `INTEGER` | FK -> work_orders.id | NO | `` |
| `part_master_id` | `INTEGER` | FK -> part_master.id | NO | `` |
| `pricing_snapshot` | `JSON` | - | NO | `` |
| `progress_type` | `VARCHAR(16)` | - | NO | `quantity` |
| `planned_quantity` | `NUMERIC(14, 3)` | - | YES | `` |
| `planned_percentage` | `NUMERIC(7, 2)` | - | YES | `` |
| `resolved_rate` | `NUMERIC(12, 2)` | - | NO | `` |
| `rate_source` | `VARCHAR(16)` | - | NO | `master` |
| `contractor_rate_id` | `INTEGER` | FK -> contractor_rates.id | YES | `` |
| `weight_per_piece_snapshot` | `NUMERIC(14, 6)` | - | YES | `` |
| `taxable_value` | `NUMERIC(14, 2)` | - | NO | `0` |
| `override_rate` | `NUMERIC(12, 2)` | - | YES | `` |
| `override_reason` | `TEXT` | - | YES | `` |
| `override_approval_request_id` | `INTEGER` | - | YES | `` |
| `override_status` | `VARCHAR(16)` | - | YES | `` |
| `notes` | `TEXT` | - | YES | `` |

## `work_orders`

| Column | Type | Keys | Null | Default |
|---|---|---|---|---|
| `id` | `INTEGER` | PK | NO | `` |
| `work_order_number` | `VARCHAR(64)` | - | NO | `` |
| `org_unit_id` | `INTEGER` | FK -> org_units.id | NO | `` |
| `contractor_id` | `INTEGER` | FK -> contractors.id | NO | `` |
| `title` | `VARCHAR(255)` | - | NO | `` |
| `description` | `TEXT` | - | YES | `` |
| `status` | `VARCHAR(32)` | - | NO | `draft` |
| `is_active` | `BOOLEAN` | - | NO | `true` |
| `approval_request_id` | `INTEGER` | - | YES | `` |
| `approved_by` | `INTEGER` | FK -> users.id | YES | `` |
| `approved_at` | `DATETIME` | - | YES | `` |
| `rejected_by` | `INTEGER` | FK -> users.id | YES | `` |
| `rejected_at` | `DATETIME` | - | YES | `` |
| `approved_value_total` | `NUMERIC(14, 2)` | - | YES | `` |
| `created_by` | `INTEGER` | FK -> users.id | YES | `` |
| `created_at` | `DATETIME` | - | NO | `now()` |
| `updated_at` | `DATETIME` | - | NO | `now()` |
