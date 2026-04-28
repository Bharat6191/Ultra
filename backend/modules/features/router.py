from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.permissions import require_permission
from db.session import get_db
from modules.errors import ConflictError, NotFoundError
from modules.features.model import Feature
from modules.features.schema import FeatureCreate, FeaturePublic, FeatureUpdate
from modules.features.service import FeatureService

router = APIRouter(prefix="/features", tags=["admin", "features"])


def get_feature_service(db: Session = Depends(get_db)) -> FeatureService:
    return FeatureService(db)


@router.post("", response_model=FeaturePublic, status_code=status.HTTP_201_CREATED)
def create_feature(
    payload: FeatureCreate,
    svc: Annotated[FeatureService, Depends(get_feature_service)],
    _: Annotated[object, Depends(require_permission("features.create"))],
) -> Feature:
    try:
        return svc.create_feature(payload)
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("", response_model=list[FeaturePublic])
def list_features(
    svc: Annotated[FeatureService, Depends(get_feature_service)],
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> list[Feature]:
    return svc.list_features(offset=skip, limit=limit)


@router.get("/{feature_id}", response_model=FeaturePublic)
def get_feature(
    feature_id: int,
    svc: Annotated[FeatureService, Depends(get_feature_service)],
) -> Feature:
    try:
        return svc.get_feature(feature_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{feature_id}", response_model=FeaturePublic)
def update_feature(
    feature_id: int,
    payload: FeatureUpdate,
    svc: Annotated[FeatureService, Depends(get_feature_service)],
) -> Feature:
    try:
        return svc.update_feature(feature_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feature(
    feature_id: int,
    svc: Annotated[FeatureService, Depends(get_feature_service)],
) -> None:
    try:
        svc.delete_feature(feature_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
