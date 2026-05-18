from pydantic import BaseModel
from typing import Optional
from datetime import date

class AssetCreate(BaseModel):
    asset_name: str
    asset_code: str

    asset_class: Optional[str] = None
    asset_type: Optional[str] = None
    asset_category: Optional[str] = None

    uhf_rfid_code: Optional[str] = None

    sub_location: Optional[str] = None
    cost_center: Optional[str] = None
    plant_name: Optional[str] = None

    party_details: Optional[str] = None

    invoice_no: Optional[str] = None
    invoice_date: Optional[date] = None

    voucher_no: Optional[str] = None
    voucher_date: Optional[date] = None

    grn_no: Optional[str] = None
    grn_date: Optional[date] = None

    inventory_count: Optional[int] = None

    put_to_use: Optional[date] = None

    rate_of_depreciation: Optional[float] = None

    gross_block: Optional[float] = None

    life_span: Optional[int] = None


class AssetUpdate(BaseModel):
    asset_name: Optional[str] = None
    asset_class: Optional[str] = None
    asset_type: Optional[str] = None
    asset_category: Optional[str] = None

    uhf_rfid_code: Optional[str] = None

    sub_location: Optional[str] = None
    cost_center: Optional[str] = None
    plant_name: Optional[str] = None

    party_details: Optional[str] = None

class AssetResponse(BaseModel):
    id: int

    asset_name: str
    asset_code: str

    asset_class: Optional[str]
    asset_type: Optional[str]
    asset_category: Optional[str]

    uhf_rfid_code: Optional[str]

    class Config:
        from_attributes = True



