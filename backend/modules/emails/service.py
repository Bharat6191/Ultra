from __future__ import annotations

import re
import os
import smtplib
from dataclasses import dataclass
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateError
from email.mime.text import MIMEText
from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.emails.constants import EVENT_CODES
from modules.emails.model import EmailLog, EmailTemplate, EmailTemplateMapping


_VAR_RE = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")


def extract_variables(content: str) -> list[str]:
    if not content:
        return []
    return sorted({m.group(1) for m in _VAR_RE.finditer(content)})


def _missing_vars(required: list[str], payload: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for k in required:
        if k not in payload:
            missing.append(k)
    return missing


_env = Environment(autoescape=True, undefined=StrictUndefined)


def render_template(content: str, payload: dict[str, Any]) -> str:
    tmpl = _env.from_string(content)
    return tmpl.render(**(payload or {}))


def render_template_loose(content: str, payload: dict[str, Any]) -> str:
    """
    Simple, best-effort renderer.

    Replaces ``{{var}}`` with payload[var] (stringified) and uses empty string when missing.
    """

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        val = (payload or {}).get(key)
        if val is None:
            return ""
        return str(val)

    return _VAR_RE.sub(repl, content or "")


@dataclass(frozen=True)
class TriggerResult:
    status: str  # sent|failed|skipped
    missing_variables: list[str]
    error: str | None = None


class EmailSender:
    """Initial safe sender stub (console log)."""

    def send_email(self, *, to_email: str, subject: str, body: str) -> None:
        host = (os.environ.get("SMTP_HOST") or "").strip()
        if not host:
            print(f"[email-engine] to={to_email} subject={subject!r}\n{body}\n")
            return

        port = int((os.environ.get("SMTP_PORT") or "587").strip() or "587")
        user = (os.environ.get("SMTP_USERNAME") or "").strip() or None
        password = (os.environ.get("SMTP_PASSWORD") or "").strip() or None
        use_tls = (os.environ.get("SMTP_USE_TLS") or "true").strip().lower() in ("1", "true", "yes", "on")
        from_email = (os.environ.get("SMTP_FROM_EMAIL") or user or "").strip()
        from_name = (os.environ.get("SMTP_FROM_NAME") or "").strip()
        if not from_email:
            raise RuntimeError("SMTP_FROM_EMAIL (or SMTP_USERNAME) must be set when SMTP_HOST is enabled")

        msg = MIMEText(body, "html", "utf-8")
        msg["Subject"] = subject
        msg["To"] = to_email
        msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email

        with smtplib.SMTP(host, port, timeout=10) as s:
            if use_tls:
                s.starttls()
            if user and password:
                s.login(user, password)
            s.sendmail(from_email, [to_email], msg.as_string())


class EmailNotificationService:
    def __init__(self, db: Session, *, sender: EmailSender | None = None) -> None:
        self._db = db
        self._sender = sender or EmailSender()

    def trigger_event(self, *, event_code: str, payload: dict[str, Any]) -> TriggerResult:
        code = (event_code or "").strip().upper()
        if code not in EVENT_CODES:
            return self._log(code, payload, status="failed", subject="", body="", error_message="Unknown event_code")

        mapping = self._db.scalar(select(EmailTemplateMapping).where(EmailTemplateMapping.event_code == code))
        if mapping is None or not bool(mapping.is_enabled):
            return TriggerResult(status="skipped", missing_variables=[], error=None)

        template = self._db.get(EmailTemplate, int(mapping.template_id))
        if template is None or not bool(template.is_active):
            return TriggerResult(status="skipped", missing_variables=[], error=None)

        required = sorted(set(extract_variables(template.subject) + extract_variables(template.body_html)))
        missing = _missing_vars(required, payload or {})
        if missing:
            return self._log(
                code,
                payload,
                status="failed",
                subject=template.subject,
                body=template.body_html,
                error_message=f"Missing variables: {', '.join(missing)}",
                missing_variables=missing,
            )

        try:
            rendered_subject = render_template(template.subject, payload)
            rendered_body = render_template(template.body_html, payload)
        except TemplateError as exc:
            return self._log(
                code,
                payload,
                status="failed",
                subject=template.subject,
                body=template.body_html,
                error_message=f"Template render error: {exc}",
            )

        to_email = str(payload.get("email") or payload.get("to_email") or "").strip()
        if not to_email:
            return self._log(
                code,
                payload,
                status="failed",
                subject=rendered_subject,
                body=rendered_body,
                error_message="Missing recipient email (payload.email or payload.to_email)",
            )

        try:
            self._sender.send_email(to_email=to_email, subject=rendered_subject, body=rendered_body)
            return self._log(code, payload, status="sent", subject=rendered_subject, body=rendered_body, error_message=None)
        except Exception as exc:  # pragma: no cover
            return self._log(
                code,
                payload,
                status="failed",
                subject=rendered_subject,
                body=rendered_body,
                error_message=str(exc),
            )

    def trigger_event_best_effort(self, *, event_code: str, payload: dict[str, Any]) -> TriggerResult:
        """
        Best-effort send:
        - skips if mapping/template disabled
        - missing variables are rendered as empty strings (no failure)
        """
        code = (event_code or "").strip().upper()
        if code not in EVENT_CODES:
            return self._log(code, payload, status="failed", subject="", body="", error_message="Unknown event_code")

        mapping = self._db.scalar(select(EmailTemplateMapping).where(EmailTemplateMapping.event_code == code))
        if mapping is None or not bool(mapping.is_enabled):
            return TriggerResult(status="skipped", missing_variables=[], error=None)

        template = self._db.get(EmailTemplate, int(mapping.template_id))
        if template is None or not bool(template.is_active):
            return TriggerResult(status="skipped", missing_variables=[], error=None)

        rendered_subject = render_template_loose(template.subject, payload or {})
        rendered_body = render_template_loose(template.body_html, payload or {})

        to_email = str(payload.get("email") or payload.get("to_email") or "").strip()
        if not to_email:
            return self._log(
                code,
                payload,
                status="failed",
                subject=rendered_subject,
                body=rendered_body,
                error_message="Missing recipient email (payload.email or payload.to_email)",
            )
        try:
            self._sender.send_email(to_email=to_email, subject=rendered_subject, body=rendered_body)
            return self._log(code, payload, status="sent", subject=rendered_subject, body=rendered_body, error_message=None)
        except Exception as exc:  # pragma: no cover
            return self._log(
                code,
                payload,
                status="failed",
                subject=rendered_subject,
                body=rendered_body,
                error_message=str(exc),
            )

    def _log(
        self,
        event_code: str,
        payload: dict[str, Any],
        *,
        status: str,
        subject: str,
        body: str,
        error_message: str | None,
        missing_variables: list[str] | None = None,
    ) -> TriggerResult:
        to_email = str(payload.get("email") or payload.get("to_email") or "").strip() or "—"
        self._db.add(
            EmailLog(
                event_code=event_code,
                to_email=to_email,
                subject=subject or "",
                body=body or "",
                status=status,
                error_message=error_message,
            )
        )
        self._db.commit()
        return TriggerResult(status=status, missing_variables=missing_variables or [], error=error_message)

