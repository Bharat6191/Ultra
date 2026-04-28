"""
Compatibility wrapper.

Admin routers in this project import from `core.permissions`. The user story
requested `app/core/permissions.py`, so we re-export the same dependency here.
"""

from core.permissions import require_permission

__all__ = ["require_permission"]

