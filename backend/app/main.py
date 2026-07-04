from fastapi import FastAPI

from app.routers import health

app = FastAPI(title="Subscription Auditor API")

app.include_router(health.router, prefix="/api/v1")
