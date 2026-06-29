from __future__ import annotations

from typing import TYPE_CHECKING

__all__ = ["AdminAuditMiddleware", "AuditLog"]

if TYPE_CHECKING:
    from modules.audit.middleware import AdminAuditMiddleware
    from modules.audit.model import AuditLog


def __getattr__(name: str):
    if name == "AdminAuditMiddleware":
        from modules.audit.middleware import AdminAuditMiddleware

        return AdminAuditMiddleware
    if name == "AuditLog":
        from modules.audit.model import AuditLog

        return AuditLog
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
