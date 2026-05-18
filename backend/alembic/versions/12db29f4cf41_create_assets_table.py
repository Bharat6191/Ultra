"""create assets table

Revision ID: 12db29f4cf41
Revises: 028
Create Date: 2026-05-12 19:21:24.406559

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "12db29f4cf41"
down_revision: Union[str, Sequence[str], None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        "assets",
        sa.Column("id", sa.Integer(), nullable=False),

        # Basic Information
        sa.Column("asset_name", sa.String(), nullable=False),
        sa.Column("asset_class", sa.String(), nullable=True),
        sa.Column("asset_type", sa.String(), nullable=True),
        sa.Column("asset_category", sa.String(), nullable=True),

        sa.Column("asset_code", sa.String(), nullable=False),
        sa.Column("uhf_rfid_code", sa.String(), nullable=True),

        # Location Information
        sa.Column("sub_location", sa.String(), nullable=True),
        sa.Column("cost_center", sa.String(), nullable=True),
        sa.Column("plant_name", sa.String(), nullable=True),

        # Vendor / Purchase Information
        sa.Column("party_details", sa.String(), nullable=True),

        sa.Column("invoice_no", sa.String(), nullable=True),
        sa.Column("invoice_date", sa.Date(), nullable=True),

        sa.Column("voucher_no", sa.String(), nullable=True),
        sa.Column("voucher_date", sa.Date(), nullable=True),

        sa.Column("grn_no", sa.String(), nullable=True),
        sa.Column("grn_date", sa.Date(), nullable=True),

        # Asset Information
        sa.Column("inventory_count", sa.Integer(), nullable=True),

        sa.Column("put_to_use", sa.Date(), nullable=True),

        # Financial Information
        sa.Column("rate_of_depreciation", sa.Float(), nullable=True),
        sa.Column("gross_block", sa.Float(), nullable=True),
        sa.Column("life_span", sa.Integer(), nullable=True),

        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uhf_rfid_code"),
    )

    op.create_index(
        op.f("ix_assets_asset_code"),
        "assets",
        ["asset_code"],
        unique=True,
    )

    op.create_index(
        op.f("ix_assets_id"),
        "assets",
        ["id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index(op.f("ix_assets_id"), table_name="assets")

    op.drop_index(
        op.f("ix_assets_asset_code"),
        table_name="assets",
    )

    op.drop_table("assets")