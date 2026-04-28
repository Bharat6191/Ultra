from __future__ import annotations

from typing import Literal


EventCode = Literal[
    "USER_CREATED",
    "FORGOT_PASSWORD",
    "PASSWORD_RESET",
    "TASK_ASSIGNED",
    "TASK_APPROVED",
    "TASK_REJECTED",
    "MFA_SETUP_REQUIRED",
    "MFA_SETUP_REMINDER",
    "MFA_ENABLED",
    "TASK_REWORK_REQUIRED",
    "TASK_RESUBMITTED",
]


EVENT_CODES: tuple[str, ...] = (
    "USER_CREATED",
    "FORGOT_PASSWORD",
    "PASSWORD_RESET",
    "TASK_ASSIGNED",
    "TASK_APPROVED",
    "TASK_REJECTED",
    "MFA_SETUP_REQUIRED",
    "MFA_SETUP_REMINDER",
    "MFA_ENABLED",
    "TASK_REWORK_REQUIRED",
    "TASK_RESUBMITTED",
)

