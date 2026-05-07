import json
from typing import Annotated
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.login_rate_limit import check_login_allowed, clear_login_failures, record_login_failure
from core.password_policy import PasswordExpiredError
from db.session import get_db
from modules.auth.login_result import (
    CaptchaInvalidError,
    LoginOutcomeMfaOtp,
    LoginOutcomeMfaSetup,
    LoginOutcomeTokens,
    PasswordLoginDisabledError,
)
from modules.auth.schema import LoginRequest, RefreshRequest, TokenPair, UserMe
from modules.auth.service import (
    AuthService,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
)
from modules.auth.schema import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from modules.errors import NotFoundError
from modules.settings.service import SettingsService
from modules.settings.schema import AuthPolicyPublic

router = APIRouter(tags=["auth"])


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db)


@router.get("/auth/policy", response_model=AuthPolicyPublic)
def public_auth_policy(db: Session = Depends(get_db)) -> AuthPolicyPublic:
    """
    Public, unauthenticated policy snapshot for login UI (do not leak user/company data).
    """
    return SettingsService(db).get_auth_policy()


async def get_login_payload(request: Request) -> LoginRequest:
    """
    Accept JSON (default) or form bodies (e.g. OAuth2-style ``username`` + ``password``).

    Plain ``LoginRequest`` injection only parses JSON; form clients otherwise get 422.
    """
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    payload_dict: dict[str, str]
    if content_type == "application/x-www-form-urlencoded":
        raw = await request.body()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Form body must be UTF-8",
            ) from exc
        pairs = parse_qs(text, keep_blank_values=False, strict_parsing=False)
        payload_dict = {str(k): v[-1] for k, v in pairs.items() if v}
    elif content_type == "multipart/form-data":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Use application/json or application/x-www-form-urlencoded for /login",
        )
    else:
        try:
            body = await request.json()
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid JSON body",
            ) from exc
        if not isinstance(body, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="JSON body must be an object",
            )
        payload_dict = {}
        for key, value in body.items():
            if value is None:
                continue
            if isinstance(value, (dict, list)):
                continue
            payload_dict[str(key)] = value if isinstance(value, str) else str(value)
    try:
        return LoginRequest.model_validate(payload_dict)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(),
        ) from exc


@router.post("/login", response_model=None)
async def login(
    request: Request,
    payload: Annotated[LoginRequest, Depends(get_login_payload)],
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenPair | JSONResponse:
    client_ip = check_login_allowed(request)
    try:
        out = svc.login_outcome(payload)
    except PasswordExpiredError:
        clear_login_failures(client_ip)
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"error": "password_expired"},
        )
    except PasswordLoginDisabledError:
        clear_login_failures(client_ip)
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"error": "password_login_disabled"},
        )
    except CaptchaInvalidError:
        clear_login_failures(client_ip)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "captcha_invalid"},
        )
    except InvalidCredentialsError:
        record_login_failure(client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        ) from None
    clear_login_failures(client_ip)
    if isinstance(out, LoginOutcomeTokens):
        return out.tokens
    if isinstance(out, LoginOutcomeMfaSetup):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "mfa_required": True,
                "setup_required": True,
                "setup_token": out.setup_token,
                "expires_in": out.expires_in_seconds,
            },
        )
    if isinstance(out, LoginOutcomeMfaOtp):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "mfa_required": True,
                "setup_required": False,
                "challenge_token": out.challenge_token,
                "expires_in": out.expires_in_seconds,
            },
        )
    return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"error": "login_state"})


@router.post("/refresh", response_model=TokenPair)
def refresh_tokens(
    payload: RefreshRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenPair:
    try:
        return svc.refresh(payload.refresh_token)
    except InvalidRefreshTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        ) from None


@router.get("/me", response_model=UserMe)
def me(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> UserMe:
    try:
        return svc.get_me_public(int(current.subject))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        ) from exc
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> ForgotPasswordResponse:
    svc.forgot_password(email=payload.email)
    return ForgotPasswordResponse(ok=True)


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    payload: ResetPasswordRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> ResetPasswordResponse:
    try:
        svc.reset_password(token=payload.token, new_password=payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset failed") from exc
    return ResetPasswordResponse(ok=True)
