from sqlalchemy.orm import Session

from modules.assets.model import Asset
from modules.assets.schema import AssetCreate, AssetUpdate
import pandas as pd

def create_asset(db: Session, payload: AssetCreate):
    asset = Asset(**payload.model_dump())

    db.add(asset)
    db.commit()
    db.refresh(asset)

    return asset

def upload_assets_excel(db: Session, file):
    df = pd.read_excel(file.file)

    assets = []

    for _, row in df.iterrows():
        asset = Asset(
            asset_name=row.get("Asset Name"),
            asset_class=row.get("Asset Class"),
            asset_type=row.get("Asset Type"),
            asset_category=row.get("Asset Category"),
            asset_code=row.get("Asset Code"),
            uhf_rfid_code=row.get("UHF Rfid Code"),
            sub_location=row.get("Sub Location"),
            cost_center=row.get("Cost Center"),
            party_details=row.get("Party Details"),
            invoice_no=row.get("Invoice No."),
            invoice_date=row.get("Invoice Date"),
            inventory_count=row.get("Inventory Count"),
            voucher_no=row.get("Voucher No"),
            voucher_date=row.get("Voucher Date"),
            grn_date=row.get("GRN Date"),
            grn_no=row.get("GRN No"),
            put_to_use=row.get("Put to Use"),
            rate_of_depreciation=row.get("Rate Of Depreciation"),
            gross_block=row.get("Gross Block"),
            life_span=row.get("Life Span"),
            plant_name=row.get("Plant Name"),
        )

        assets.append(asset)

    db.add_all(assets)
    db.commit()

    return {
        "message": f"{len(assets)} assets uploaded successfully"
    }

def get_assets(db: Session):
    return db.query(Asset).all()


def get_asset_by_id(db: Session, asset_id: int):
    return (
        db.query(Asset)
        .filter(Asset.id == asset_id)
        .first()
    )

def update_asset(
    db: Session,
    asset_id: int,
    payload: AssetUpdate
):
    asset = (
        db.query(Asset)
        .filter(Asset.id == asset_id)
        .first()
    )

    if not asset:
        return None

    update_data = payload.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(asset, key, value)

    db.commit()
    db.refresh(asset)

    return asset

def delete_asset(db: Session, asset_id: int):
    asset = (
        db.query(Asset)
        .filter(Asset.id == asset_id)
        .first()
    )

    if not asset:
        return False

    db.delete(asset)
    db.commit()

    return True
