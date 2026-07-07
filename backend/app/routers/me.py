from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import get_current_claims
from app.models.profile import ProfileResponse, ProfileUpdate
from app.services.profile import ProfileNotFoundError, get_my_profile, update_my_profile

router = APIRouter(tags=["profile"])


@router.get("/me", response_model=ProfileResponse)
async def read_me(claims: dict = Depends(get_current_claims)) -> ProfileResponse:  # noqa: B008
    try:
        profile = await get_my_profile(claims)
    except ProfileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found"
        ) from err
    return ProfileResponse(**profile)


@router.patch("/me", response_model=ProfileResponse)
async def update_me(
    payload: ProfileUpdate,
    claims: dict = Depends(get_current_claims),  # noqa: B008
) -> ProfileResponse:
    try:
        profile = await update_my_profile(claims, payload)
    except ProfileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found"
        ) from err
    return ProfileResponse(**profile)
