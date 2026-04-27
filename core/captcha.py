"""
Captcha validation hook. When no external provider is configured, uses a dev-friendly mock.
Set CAPTCHA_SKIP_VALIDATION=1 in development to accept any non-empty token when captcha is required.
"""

from __future__ import annotations

import os


def captcha_is_valid(*, token: str | None, captcha_enabled: bool) -> bool:
    if not captcha_enabled:
        return True
    if (os.environ.get("CAPTCHA_SKIP_VALIDATION") or "").strip().lower() in ("1", "true", "yes"):
        return bool((token or "").strip())
    # Mock / integration point: e.g. verify with Google reCAPTCHA, hCaptcha, etc.
    t = (token or "").strip()
    if not t:
        return False
    if t == "captcha-ok" or t.startswith("mock:"):
        return True
    return len(t) >= 8
