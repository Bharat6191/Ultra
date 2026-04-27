from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.settings.lookup import get_setting
from modules.auth_policy.model import AuthPolicy
from modules.mfa.model import UserMfa
from modules.org_units.model import OrgUnit
from modules.users.model import User


@dataclass(frozen=True, slots=True)
class EffectiveAuthPolicy:
    company_id: int | None
    password_enabled: bool
    mfa_enabled: bool
    captcha_enabled: bool
    mfa_enforced: bool


_DEFAULT = EffectiveAuthPolicy(
    company_id=None,
    password_enabled=True,
    mfa_enabled=False,
    captcha_enabled=False,
    mfa_enforced=False,
)

def _b(v: str | None, default: bool) -> bool:
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def get_global_policy(db: Session) -> EffectiveAuthPolicy:
    """
    Org-wide authentication policy stored in settings table.
    Keys:
      - auth.password_enabled (default true)
      - auth.mfa_enabled (default false)
      - auth.captcha_enabled (default false)
      - auth.mfa_enforced (default false)
    """
    # settings.lookup uses its own session/cache; db arg kept for compatibility.
    return EffectiveAuthPolicy(
        company_id=None,
        password_enabled=_b(get_setting("auth.password_enabled"), True),
        mfa_enabled=_b(get_setting("auth.mfa_enabled"), False),
        captcha_enabled=_b(get_setting("auth.captcha_enabled"), False),
        mfa_enforced=_b(get_setting("auth.mfa_enforced"), False),
    )


def resolve_company_org_unit_id(db: Session, user: User) -> int | None:
    """Resolve the company org_unit for RBAC (walk parent chain from user's org units)."""
    if user.is_superuser:
        return None
    ous = list(user.org_units or [])
    if not ous:
        return None

    def walk(ou_id: int) -> int | None:
        cur: OrgUnit | None = db.get(OrgUnit, ou_id)
        depth = 0
        while cur is not None and depth < 32:
            if (cur.type or "").lower() == "company":
                return int(cur.id)
            if cur.parent_id is None:
                return int(cur.id)
            cur = db.get(OrgUnit, int(cur.parent_id))
            depth += 1
        return None

    for ou in ous:
        cid = walk(int(ou.id))
        if cid is not None:
            return cid
    return int(ous[0].id)


def get_effective_policy(db: Session, company_id: int | None) -> EffectiveAuthPolicy:
    # New requirement: org-wide policy (not plant scoped). Prefer global settings.
    global_pol = get_global_policy(db)
    if (
        global_pol.password_enabled is not True
        or global_pol.mfa_enabled is not False
        or global_pol.captcha_enabled is not False
        or global_pol.mfa_enforced is not False
    ):
        return global_pol

    if company_id is None:
        return _DEFAULT
    row = db.scalar(select(AuthPolicy).where(AuthPolicy.company_id == int(company_id)))
    if row is None:
        return EffectiveAuthPolicy(
            company_id=int(company_id),
            password_enabled=True,
            mfa_enabled=False,
            captcha_enabled=False,
            mfa_enforced=False,
        )
    return EffectiveAuthPolicy(
        company_id=int(row.company_id),
        password_enabled=bool(row.password_enabled),
        mfa_enabled=bool(row.mfa_enabled),
        captcha_enabled=bool(row.captcha_enabled),
        mfa_enforced=bool(row.mfa_enforced),
    )


def get_auth_policy_row(db: Session, company_id: int) -> AuthPolicy | None:
    return db.scalar(select(AuthPolicy).where(AuthPolicy.company_id == int(company_id)))


def upsert_auth_policy(
    db: Session,
    *,
    company_id: int,
    password_enabled: bool | None = None,
    mfa_enabled: bool | None = None,
    captcha_enabled: bool | None = None,
    mfa_enforced: bool | None = None,
) -> tuple[AuthPolicy, bool]:
    """
    Returns (policy, mfa_just_enabled) where mfa_just_enabled is True when MFA was off and is now on.
    """
    row = get_auth_policy_row(db, company_id)
    prev_mfa = bool(row.mfa_enabled) if row else False
    if row is None:
        row = AuthPolicy(
            company_id=int(company_id),
            password_enabled=True if password_enabled is None else password_enabled,
            mfa_enabled=False if mfa_enabled is None else mfa_enabled,
            captcha_enabled=False if captcha_enabled is None else captcha_enabled,
            mfa_enforced=False if mfa_enforced is None else mfa_enforced,
        )
        db.add(row)
        db.flush()
        mfa_just = bool(row.mfa_enabled) and not prev_mfa
        db.commit()
        db.refresh(row)
        return row, mfa_just

    if password_enabled is not None:
        row.password_enabled = password_enabled
    if mfa_enabled is not None:
        row.mfa_enabled = mfa_enabled
    if captcha_enabled is not None:
        row.captcha_enabled = captcha_enabled
    if mfa_enforced is not None:
        row.mfa_enforced = mfa_enforced
    row.updated_at = datetime.now(timezone.utc)
    mfa_just = bool(row.mfa_enabled) and not prev_mfa
    db.commit()
    db.refresh(row)
    return row, mfa_just


def iter_active_users_needing_mfa_email(db: Session, company_id: int) -> list[User]:
    """Users assigned to this company who are active, non-superuser, and have not completed MFA setup."""
    stmt = (
        select(User)
        .where(User.is_active.is_(True), User.is_superuser.is_(False))
        .options(selectinload(User.org_units), selectinload(User.mfa_record))
    )
    out: list[User] = []
    for u in db.scalars(stmt).unique().all():
        if resolve_company_org_unit_id(db, u) != int(company_id):
            continue
        m = u.mfa_record
        if m is not None and bool(m.setup_completed):
            continue
        out.append(u)
    return out
