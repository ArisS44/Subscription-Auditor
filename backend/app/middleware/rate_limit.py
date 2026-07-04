from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from app.config import settings

# Paths that are auth-adjacent enough to warrant brute-force defense.
# Currently just the one authenticated endpoint this session ships.
RATE_LIMITED_PATHS = {"/api/v1/me"}

_storage = MemoryStorage()
_limiter = FixedWindowRateLimiter(_storage)
_rate = parse(f"{settings.auth_rate_limit_per_minute}/minute")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limiting, implemented as ASGI middleware rather than a
    FastAPI dependency so it runs before route dependency resolution —
    an endpoint dependency (like JWT verification) can reject a request
    with a 401 before ever reaching route code, which would let an
    attacker send unlimited malformed/invalid tokens without ever
    tripping a decorator-based limiter. Middleware sees every request
    regardless of what happens downstream.

    In-memory storage means limits are per-process, not shared across
    replicas — acceptable for a single-instance deployment; would need a
    shared store (e.g. Redis) once this scales horizontally.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in RATE_LIMITED_PATHS:
            client_ip = request.client.host if request.client else "unknown"
            key = f"{request.url.path}:{client_ip}"
            if not _limiter.hit(_rate, key):
                return JSONResponse(status_code=429, content={"detail": "Too many requests"})
        return await call_next(request)
