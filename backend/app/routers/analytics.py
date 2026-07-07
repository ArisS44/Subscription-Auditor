from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import get_current_claims
from app.models.analytics import AnalyticsResponse
from app.services import analytics as svc

# Shares the /subscriptions prefix but is a distinct concern (read-only roll-ups).
# Registered before the CRUD router so GET /subscriptions/analytics resolves to
# this literal route rather than the /{sub_id} detail route.
router = APIRouter(prefix="/subscriptions", tags=["analytics"])

Claims = Annotated[dict, Depends(get_current_claims)]


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(claims: Claims) -> AnalyticsResponse:
    overview = await svc.build_overview(claims)
    return AnalyticsResponse(**overview)
