import uuid
from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db.pool import close_pool, create_pool
from app.main import app

_ADMIN_HEADERS = {
    "apikey": settings.supabase_service_role_key,
    "Authorization": f"Bearer {settings.supabase_service_role_key}",
}


async def _create_user() -> tuple[str, str]:
    """Mint a pre-confirmed test user via the Auth Admin API rather than
    normal signup — Supabase's free tier rate-limits outbound
    confirmation email after ~2 signups, which would make the test suite
    flaky. `email_confirm: true` skips that entirely.
    """
    email = f"test-{uuid.uuid4().hex[:16]}@example.com"
    password = "Test-Password-123!"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=_ADMIN_HEADERS,
            json={"email": email, "password": password, "email_confirm": True},
        )
        r.raise_for_status()
        user_id = r.json()["id"]

        r2 = await client.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_anon_key},
            json={"email": email, "password": password},
        )
        r2.raise_for_status()
        access_token = r2.json()["access_token"]
    return user_id, access_token


async def _delete_user(user_id: str) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        await client.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=_ADMIN_HEADERS,
        )


@pytest.fixture
def test_client() -> Iterator[TestClient]:
    """TestClient as a context manager triggers the app's lifespan, so the
    asyncpg pool is created/closed around each test using it. Only valid
    for tests that go through HTTP — the pool it creates lives on
    Starlette's portal-thread event loop, not pytest-asyncio's, so async
    tests calling the db layer directly must use `db_pool` instead."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
async def db_pool() -> AsyncIterator[None]:
    """Creates the asyncpg pool directly on the running test's event loop,
    for async tests that call `app.db` helpers without going through
    HTTP/TestClient."""
    await create_pool()
    yield
    await close_pool()


@pytest.fixture
async def user_a() -> AsyncIterator[tuple[str, str]]:
    user_id, token = await _create_user()
    yield user_id, token
    await _delete_user(user_id)


@pytest.fixture
async def user_b() -> AsyncIterator[tuple[str, str]]:
    user_id, token = await _create_user()
    yield user_id, token
    await _delete_user(user_id)
