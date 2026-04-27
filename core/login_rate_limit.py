"""Simple in-memory limits for ``POST /login`` (per client IP)."""

from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, Request, status

_LOCK = threading.Lock()
# Monotonic timestamps of recent login POST attempts (all outcomes).
_attempts_by_ip: dict[str, deque[float]] = {}
# Monotonic timestamps of failed credential attempts.
_failures_by_ip: dict[str, deque[float]] = {}
# Monotonic time until IP is blocked (failed-attempt lockout).
_locked_until_mono: dict[str, float] = {}

_MAX_ATTEMPTS_PER_MINUTE = 30
_ATTEMPT_WINDOW_SEC = 60.0
_MAX_FAILURES = 10
_FAILURE_WINDOW_SEC = 900.0
_LOCKOUT_SEC = 900.0


def _client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def check_login_allowed(request: Request) -> str:
    """
    Raise ``429`` if the client is locked out or exceeds the per-minute attempt budget.

    Returns the client IP key used for counters.
    """
    ip = _client_ip(request)
    now = time.monotonic()
    with _LOCK:
        lock_until = _locked_until_mono.get(ip, 0.0)
        if now < lock_until:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Try again later.",
            )
        dq = _attempts_by_ip.setdefault(ip, deque())
        while dq and dq[0] < now - _ATTEMPT_WINDOW_SEC:
            dq.popleft()
        if len(dq) >= _MAX_ATTEMPTS_PER_MINUTE:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again in a minute.",
            )
        dq.append(now)
    return ip


def record_login_failure(ip: str) -> None:
    now = time.monotonic()
    with _LOCK:
        dq = _failures_by_ip.setdefault(ip, deque())
        while dq and dq[0] < now - _FAILURE_WINDOW_SEC:
            dq.popleft()
        dq.append(now)
        if len(dq) >= _MAX_FAILURES:
            _locked_until_mono[ip] = now + _LOCKOUT_SEC


def clear_login_failures(ip: str) -> None:
    with _LOCK:
        _failures_by_ip.pop(ip, None)
        _locked_until_mono.pop(ip, None)
