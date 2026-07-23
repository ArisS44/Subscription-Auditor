import uuid
from collections.abc import AsyncIterator, Iterator

import asyncpg
import httpx
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.config import settings
from app.db.pool import close_pool, create_pool
from app.main import app

_ADMIN_HEADERS = {
    "apikey": settings.supabase_service_role_key,
    "Authorization": f"Bearer {settings.supabase_service_role_key}",
}


# Counts real Auth Admin user creations in a run. The whole point of the shared
# fixtures is that this stays at 2 no matter how many tests exist, so it is
# reported at session end: a silent regression to per-test creation would show
# up here as a number in the dozens before it showed up as flakiness.
_users_created = 0


async def _create_user() -> tuple[str, str]:
    """Mint a pre-confirmed test user via the Auth Admin API rather than
    normal signup — Supabase's free tier rate-limits outbound
    confirmation email after ~2 signups, which would make the test suite
    flaky. `email_confirm: true` skips that entirely.
    """
    global _users_created
    _users_created += 1
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


async def _reset_user_data(user_ids: list[str]) -> None:
    """Return the shared test users to a pristine state: no rows anywhere, and
    profile fields back at their signup defaults.

    This is what preserves isolation once users are reused, so it is the load-
    bearing half of the shared-fixture design rather than mere tidying. It runs
    *before* each test rather than after: cleanup that only happens on the happy
    path is skipped by a test that fails or errors part-way, which would leave
    the next test to fail for a reason that has nothing to do with it.

    Uses its own short-lived connection rather than the app pool, because the
    `db_pool` fixture opens and closes that pool around individual tests and it
    is not reliably available here. Connecting directly also means no
    `authenticated` role is set, so RLS is bypassed — required, since cleanup
    must remove rows across both users regardless of who owns them.
    """
    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        # Children before parents. The FK cascades would cover most of this, but
        # being explicit states the intent and does not silently change meaning
        # if a cascade is ever altered.
        await conn.execute("DELETE FROM messages WHERE user_id = ANY($1::uuid[])", user_ids)
        await conn.execute("DELETE FROM conversations WHERE user_id = ANY($1::uuid[])", user_ids)
        await conn.execute(
            "DELETE FROM notification_deliveries WHERE user_id = ANY($1::uuid[])", user_ids
        )
        await conn.execute(
            "DELETE FROM push_subscriptions WHERE user_id = ANY($1::uuid[])", user_ids
        )
        await conn.execute("DELETE FROM subscriptions WHERE user_id = ANY($1::uuid[])", user_ids)
        # Daily LLM spend counters. Without this a shared user accumulates
        # request counts across the whole run, and the daily-cap tests would find
        # a budget that earlier tests had already spent.
        await conn.execute("DELETE FROM llm_usage WHERE user_id = ANY($1::uuid[])", user_ids)
        # The profile row is created by an auth trigger at signup and must
        # survive, so it is reset field-by-field to the column defaults rather
        # than deleted. PATCH /me tests mutate these.
        await conn.execute(
            "UPDATE profiles SET display_name = NULL, preferred_language = 'auto', "
            "renewal_lead_days = 3, monthly_review_enabled = true, "
            "onboarding_completed = false "
            "WHERE id = ANY($1::uuid[])",
            user_ids,
        )
    finally:
        await conn.close()


# pytest_asyncio.fixture (not pytest.fixture) is required here: only it accepts
# loop_scope, which keeps this session-scoped fixture on a session-wide event
# loop rather than a per-test one that would be closed under it.
@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _shared_users() -> AsyncIterator[tuple[tuple[str, str], tuple[str, str]]]:
    """The two real Supabase users the whole suite shares.

    Previously each test minted its own user, which meant ~74 users and ~222
    Auth Admin round-trips per full run. Supabase rate-limits that, and the
    rejections surfaced as `AuthError: Invalid authentication credentials` at
    random points — indistinguishable at a glance from a real auth regression.
    Creating them once costs 2 users / 6 round-trips no matter how many tests
    exist, so adding tables no longer degrades the suite.

    Isolation now comes from `_reset_user_data`, not from freshness. Access
    tokens are minted once and are valid for an hour, far longer than a run.
    """
    a = await _create_user()
    b = await _create_user()
    yield a, b
    await _delete_user(a[0])
    await _delete_user(b[0])


def pytest_terminal_summary(terminalreporter) -> None:
    """Report the real-user cost of the run alongside the test results."""
    if _users_created:
        terminalreporter.write_line(
            f"Supabase users created this run: {_users_created} "
            f"({_users_created * 3} Auth Admin round-trips)"
        )


@pytest.fixture
async def clean_users(_shared_users) -> AsyncIterator[tuple[tuple[str, str], tuple[str, str]]]:
    """Wipes both shared users' rows, then hands them to the test. Function-
    scoped, so a test requesting both `user_a` and `user_b` resets once rather
    than twice."""
    a, b = _shared_users
    await _reset_user_data([a[0], b[0]])
    yield a, b


@pytest.fixture
async def user_a(clean_users) -> tuple[str, str]:
    return clean_users[0]


@pytest.fixture
async def user_b(clean_users) -> tuple[str, str]:
    return clean_users[1]
