"""Log mutating HTTP requests for routes tagged ``admin``."""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from jose import JWTError
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from core.security import decode_access_token
from db.session import SessionLocal
from modules.audit.model import AuditLog

logger = logging.getLogger(__name__)

_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _parse_actor_user_id(request: Request) -> int | None:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    parts = auth.split(None, 1)
    if len(parts) != 2:
        return None
    try:
        payload = decode_access_token(parts[1])
        sub = payload.get("sub")
        if sub is None:
            return None
        return int(sub) if isinstance(sub, str) else int(sub)
    except (JWTError, ValueError, TypeError):
        return None


def _persist_audit_row(
    *,
    actor_user_id: int | None,
    action: str,
    path: str,
    status_code: int | None,
    client_ip: str | None,
    user_agent: str | None,
) -> None:
    db: Session = SessionLocal()
    try:
        db.add(
            AuditLog(
                actor_user_id=actor_user_id,
                action=action,
                path=path[:2048],
                status_code=status_code,
                client_ip=client_ip,
                user_agent=user_agent,
            )
        )
        db.commit()
    except Exception:
        logger.exception("audit_log insert failed")
        db.rollback()
    finally:
        db.close()


class AdminAuditMiddleware(BaseHTTPMiddleware):
    """After the response, record one row per mutating request to ``admin``-tagged routes."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        route = request.scope.get("route")
        tags = getattr(route, "tags", None) or ()
        if "admin" not in tags:
            return response
        if request.method not in _MUTATING:
            return response

        actor = _parse_actor_user_id(request)
        ip = request.client.host if request.client else None
        ua = (request.headers.get("user-agent") or "")[:512] or None
        path = request.url.path
        status = response.status_code

        await asyncio.to_thread(
            _persist_audit_row,
            actor_user_id=actor,
            action=request.method,
            path=path,
            status_code=status,
            client_ip=ip,
            user_agent=ua,
        )
        return response
