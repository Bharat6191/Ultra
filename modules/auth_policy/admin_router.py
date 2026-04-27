from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.permissions import require_permission
from db.session import get_db
from modules.auth_policy.model import AuthPolicy
from modules.auth_policy.service import get_auth_policy_row, iter_active_users_needing_mfa_email, upsert_auth_policy
from modules.mfa.notify import trigger_mfa_setup_email
from modules.org_units.model import OrgUnit

router = APIRouter(prefix="/auth-policy", tags=["admin", "auth-policy"])


class AuthPolicyPublic(BaseModel):
    company_id: int
    password_enabled: bool
    mfa_enabled: bool
    captcha_enabled: bool
    mfa_enforced: bool

    model_config = {"from_attributes": True}

    @classmethod
    def from_row(cls, row: AuthPolicy) -> "AuthPolicyPublic":
        return cls(
            company_id=int(row.company_id),
            password_enabled=bool(row.password_enabled),
            mfa_enabled=bool(row.mfa_enabled),
            captcha_enabled=bool(row.captcha_enabled),
            mfa_enforced=bool(row.mfa_enforced),
        )


class AuthPolicyPatch(BaseModel):
    password_enabled: bool | None = None
    mfa_enabled: bool | None = None
    captcha_enabled: bool | None = None
    mfa_enforced: bool | None = None


@router.get("", response_model=AuthPolicyPublic)
def get_auth_policy(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[object, Depends(require_permission("auth_policy.view"))],
    company_id: int = Query(..., ge=1),
) -> AuthPolicyPublic:
    org = db.get(OrgUnit, int(company_id))
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company org unit not found")
    row = get_auth_policy_row(db, int(company_id))
    if row is None:
        return AuthPolicyPublic(
            company_id=int(company_id),
            password_enabled=True,
            mfa_enabled=False,
            captcha_enabled=False,
            mfa_enforced=False,
        )
    return AuthPolicyPublic.from_row(row)


@router.patch("", response_model=AuthPolicyPublic)
def patch_auth_policy(
    body: AuthPolicyPatch,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[object, Depends(require_permission("auth_policy.update"))],
    company_id: int = Query(..., ge=1),
) -> AuthPolicyPublic:
    org = db.get(OrgUnit, int(company_id))
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company org unit not found")
    row, mfa_just = upsert_auth_policy(
        db,
        company_id=int(company_id),
        password_enabled=body.password_enabled,
        mfa_enabled=body.mfa_enabled,
        captcha_enabled=body.captcha_enabled,
        mfa_enforced=body.mfa_enforced,
    )
    if mfa_just:
        for u in iter_active_users_needing_mfa_email(db, int(company_id)):
            trigger_mfa_setup_email(db, u, "MFA_SETUP_REQUIRED")
    return AuthPolicyPublic.from_row(row)
