"""Bridge revision (missing in repo).

This repository historically had a revision `039` already stamped in some DBs.
The original file is missing; this no-op bridge restores Alembic continuity so
future migrations can run.
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "039"
down_revision: str | None = "038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # no-op
    return


def downgrade() -> None:
    # no-op
    return

