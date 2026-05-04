"""Add initial_rate column to contractor_rates.

The savings calculation switches from ``base_rate − negotiated_rate`` (which
went negative once a contractor's final rate ended above the procurement
baseline) to ``initial_rate − negotiated_rate`` (always ≥ 0). The dashboard
keeps reporting "vs base" as a separate signed KPI so over-baseline rates are
still visible — they just no longer poison the savings figure.

Backfill rules (best-effort):

* For each existing ``contractor_rates`` row, set ``initial_rate`` to the
  highest of ``negotiated_rate`` and any round-1 ``proposed_rate`` recorded in
  ``negotiation_logs``. That captures the "first ask" for rows that already
  went through rounds.
* Rows with no rounds use ``negotiated_rate`` as the initial rate (i.e. no
  negotiation discount yet, savings_amount = 0).

Revision ID: 035
Revises: 034
Create Date: 2026-05-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "035"
down_revision: str | None = "034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {c["name"] for c in inspector.get_columns("contractor_rates")}

    if "initial_rate" not in existing_cols:
        op.add_column(
            "contractor_rates",
            sa.Column("initial_rate", sa.Numeric(12, 2), nullable=True),
        )

    # Backfill from round-1 proposals where available, else from negotiated_rate.
    op.execute(
        sa.text(
            """
            UPDATE contractor_rates AS cr
            SET initial_rate = COALESCE(
                (
                    SELECT GREATEST(MAX(nl.proposed_rate), cr.negotiated_rate)
                    FROM negotiation_logs nl
                    WHERE nl.contractor_rate_id = cr.id
                      AND nl.round_number = 1
                      AND nl.proposed_rate IS NOT NULL
                ),
                cr.negotiated_rate
            )
            WHERE cr.initial_rate IS NULL
            """
        )
    )

    # Recompute savings on existing rows so dashboards make sense post-deploy.
    op.execute(
        sa.text(
            """
            UPDATE contractor_rates
            SET
                savings_amount = GREATEST(
                    initial_rate - negotiated_rate, 0
                ),
                savings_percentage = CASE
                    WHEN initial_rate IS NULL OR initial_rate = 0 THEN 0
                    ELSE ROUND(
                        (GREATEST(initial_rate - negotiated_rate, 0) / initial_rate) * 100,
                        2
                    )
                END
            WHERE initial_rate IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {c["name"] for c in inspector.get_columns("contractor_rates")}
    if "initial_rate" in existing_cols:
        op.drop_column("contractor_rates", "initial_rate")
