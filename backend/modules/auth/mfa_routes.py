from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.session import get_db
from modules.auth.schema import TokenPair
from modules.auth.service import AuthService
from modules.emails.service import EmailNotificationService
from modules.mfa.service import MfaService
from modules.users.model import User

router = APIRouter(prefix="/auth", tags=["auth", "mfa"])


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db)


class MfaVerifyRequest(BaseModel):
    challenge_token: str = Field(min_length=10, max_length=512)
    otp: str = Field(min_length=6, max_length=12)


class MfaSetupInitBody(BaseModel):
    setup_token: str = Field(min_length=10, max_length=512)


class MfaSetupVerifyBody(BaseModel):
    setup_token: str = Field(min_length=10, max_length=512)
    otp: str = Field(min_length=6, max_length=12)


@router.post("/mfa/verify", response_model=TokenPair)
def verify_mfa_otp(
    payload: MfaVerifyRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
    db: Annotated[Session, Depends(get_db)],
) -> TokenPair:
    mfa = MfaService(db)
    ch = mfa.verify_login_challenge(payload.challenge_token)
    if ch is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired challenge")
    user = db.get(User, int(ch.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")
    if not mfa.verify_totp_for_user(int(user.id), payload.otp):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP")
    mfa.mark_challenge_used(ch)
    return svc.issue_token_pair(user)


@router.post("/mfa/setup/init")
def mfa_setup_init(
    body: MfaSetupInitBody,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    mfa = MfaService(db)
    row = mfa.find_valid_setup_token(body.setup_token)
    if row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired setup token")
    user = db.get(User, int(row.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")
    res = mfa.init_enrollment(int(user.id))
    return {"otpauth_url": res.otpauth_url, "account_name": res.account_name}


@router.post("/mfa/setup/verify")
def mfa_setup_verify(
    body: MfaSetupVerifyBody,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    mfa = MfaService(db)
    row = mfa.find_valid_setup_token(body.setup_token)
    if row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired setup token")
    user = db.get(User, int(row.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")
    if not mfa.complete_enrollment(int(user.id), body.otp):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP or enrollment state")
    mfa.mark_setup_token_used(row)
    if user.email:
        EmailNotificationService(db).trigger_event(
            event_code="MFA_ENABLED",
            payload={"user_name": user.full_name, "email": user.email},
        )
    return {"ok": True}
