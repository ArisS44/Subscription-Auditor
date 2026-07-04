from fastapi import APIRouter, Response, status

from app.models.health import HealthResponse, ReadyResponse
from app.services.health import check_database_ready

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/ready", response_model=ReadyResponse)
async def ready(response: Response) -> ReadyResponse:
    db_ok = await check_database_ready()
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadyResponse(
        status="ok" if db_ok else "unavailable",
        database="up" if db_ok else "down",
    )
