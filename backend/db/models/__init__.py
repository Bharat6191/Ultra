"""Import models so SQLAlchemy registers them on Base.metadata."""

from modules.audit.model import AuditLog
from modules.auth.model import PasswordResetToken, UserSession
from modules.auth_policy.model import AuthPolicy
from modules.mfa.model import MfaChallenge, MfaSetupToken, UserMfa
from modules.features.model import Feature
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    ApprovalWorkflowMapping,
)
from modules.rbac_audit.model import RbacAuditLog
from modules.rbac_versioning.model import RbacCompanyPermissionVersion, RbacUserPermissionVersion
from modules.rbac_association import role_org_unit, role_permission, user_org_unit, user_role  # noqa: F401
from modules.roles.model import Role
from modules.settings.model import Setting
from modules.users.model import User
from modules.contractor.models import Contractor, ContractorDocument
from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateAuditLog,
    ContractorRateVersion,
    NegotiationAttachment,
    NegotiationLog,
)
from modules.part_master.models import (
    PartMaster,
    PartMasterAttachment,
    PartMasterAuditLog,
    PartMasterVersion,
)
from modules.notifications.model import NotificationDedupKey, NotificationSetting
from modules.work_orders.models import (
    WorkOrder,
    WorkOrderAuditLog,
    WorkOrderContractor,
    WorkOrderItem,
    WorkOrderItemProgress,
)
from modules.invoices.models import (
    ContractorInvoiceCompliance,
    Invoice,
    InvoiceAttachment,
    InvoiceAuditLog,
    InvoiceLine,
    InvoiceValidationIssue,
)

__all__ = [
    "AuditLog",
    "Feature",
    "OrgUnit",
    "Permission",
    "ApprovalWorkflow",
    "ApprovalWorkflowMapping",
    "ApprovalStep",
    "ApprovalRequest",
    "ApprovalTask",
    "ApprovalAction",
    "RbacAuditLog",
    "RbacCompanyPermissionVersion",
    "RbacUserPermissionVersion",
    "Role",
    "Setting",
    "User",
    "Contractor",
    "ContractorDocument",
    "PartMaster",
    "PartMasterAuditLog",
    "PartMasterVersion",
    "PartMasterAttachment",
    "ContractorRate",
    "ContractorRateAuditLog",
    "ContractorRateVersion",
    "NegotiationLog",
    "NegotiationAttachment",
    "NotificationSetting",
    "NotificationDedupKey",
    "UserSession",
    "PasswordResetToken",
    "AuthPolicy",
    "UserMfa",
    "MfaChallenge",
    "MfaSetupToken",
    "role_permission",
    "WorkOrder",
    "WorkOrderContractor",
    "WorkOrderItem",
    "WorkOrderItemProgress",
    "WorkOrderAuditLog",
    "Invoice",
    "InvoiceLine",
    "InvoiceValidationIssue",
    "InvoiceAttachment",
    "InvoiceAuditLog",
    "ContractorInvoiceCompliance",
]
