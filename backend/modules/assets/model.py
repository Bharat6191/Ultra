from sqlalchemy import Column, Integer, String, Date, Float
from db.base import Base


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)

    # Basic Information
    asset_name = Column(String, nullable=False)
    asset_class = Column(String, nullable=True)
    asset_type = Column(String, nullable=True)
    asset_category = Column(String, nullable=True)

    asset_code = Column(String, unique=True, index=True, nullable=False)

    uhf_rfid_code = Column(String, unique=True, nullable=True)

    # Location Information
    sub_location = Column(String, nullable=True)
    cost_center = Column(String, nullable=True)
    plant_name = Column(String, nullable=True)

    # Vendor / Purchase Information
    party_details = Column(String, nullable=True)

    invoice_no = Column(String, nullable=True)
    invoice_date = Column(Date, nullable=True)

    voucher_no = Column(String, nullable=True)
    voucher_date = Column(Date, nullable=True)

    grn_no = Column(String, nullable=True)
    grn_date = Column(Date, nullable=True)

    # Asset Information
    inventory_count = Column(Integer, nullable=True)

    put_to_use = Column(Date, nullable=True)

    # Financial Information
    rate_of_depreciation = Column(Float, nullable=True)

    gross_block = Column(Float, nullable=True)

    life_span = Column(Integer, nullable=True)