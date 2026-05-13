"""User email parsing accepts internal domains that strict EmailStr rejects."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from modules.users.schema import UserUpdate


def test_user_update_accepts_special_use_style_domains() -> None:
    u = UserUpdate(email="admin@machine.local")
    assert u.email == "admin@machine.local"

    u2 = UserUpdate(email="User@HOST.LOCAL")
    assert u2.email == "user@host.local"


def test_user_update_rejects_garbage() -> None:
    with pytest.raises(ValidationError):
        UserUpdate(email="not-an-email")
