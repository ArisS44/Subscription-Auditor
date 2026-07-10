from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.pool import close_pool, create_pool
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routers import analytics, chat, fx, health, me, subscriptions


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

# Outermost of all: the browser's CORS preflight (OPTIONS) must be answered
# before it ever reaches rate limiting or route dependencies, so a legitimate
# cross-origin caller's preflight can't be rejected by IP-based limits meant
# for the real request. Credentials stay off — auth is a Bearer token in the
# Authorization header, never a cookie, so there's nothing to authorize
# cross-site.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
# Analytics before the subscriptions CRUD router so /subscriptions/analytics
# resolves to the analytics route, not the /{sub_id} detail route.
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(subscriptions.router, prefix="/api/v1")
app.include_router(fx.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
