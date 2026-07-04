from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.pool import close_pool, create_pool
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routers import health, me


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await create_pool()
    yield
    await close_pool()


app = FastAPI(title="Subscription Auditor API", lifespan=lifespan)

# Added last so it wraps outermost: every response — including early
# 429s from the rate limiter below — still gets security headers.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(health.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
