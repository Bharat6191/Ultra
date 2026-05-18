from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from fastapi import UploadFile, File
from db.session import get_db

from modules.assets.schema import (
    AssetCreate,
    AssetResponse,
)

from modules.assets.service import create_asset
from modules.assets.service import get_assets
from modules.assets.service import upload_assets_excel

from core.auth import get_current_user

router = APIRouter(
    prefix="/assets",
    tags=["Assets"],
)

@router.post("/", response_model=AssetResponse)
def create_asset_api(
    payload: AssetCreate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    return create_asset(db, payload)

@router.post("/upload")
def upload_assets(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return upload_assets_excel(db, file)

@router.get("/")
def get_all_assets(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    return get_assets(db)

