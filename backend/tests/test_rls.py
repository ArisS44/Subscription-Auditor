from app.db.profiles import get_profile_by_id
from app.db.rls import rls_connection
from app.deps import verify_token


async def test_own_profile_readable_through_rls_path(db_pool, user_a):
    user_id, token = user_a
    claims = verify_token(token)

    async with rls_connection(claims) as conn:
        row = await get_profile_by_id(conn, user_id)

    assert row is not None
    assert str(row["id"]) == user_id


async def test_cross_user_read_denied_by_rls(db_pool, user_a, user_b):
    """The critical security assertion: authenticated as user A, a query
    for user B's row must come back empty — not because application code
    filtered it, but because Postgres RLS silently excludes rows that
    don't satisfy `auth.uid() = id` under the `authenticated` role. If
    `SET LOCAL`/`set_config` weren't scoped inside a real transaction,
    or the claims shape didn't match what `auth.uid()` expects, this
    would return user B's row instead of None — that's the failure this
    test exists to catch.
    """
    user_a_id, token_a = user_a
    user_b_id, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    # Positive control: B's profile must genuinely exist and be readable by B.
    # Without this, the denial assertion below would pass just as greenly if the
    # row were simply absent — proving nothing at all. Since the users are now
    # shared across the suite rather than freshly minted per test, "the row is
    # there to be hidden" is a precondition worth asserting rather than assuming.
    async with rls_connection(claims_b) as conn:
        own = await get_profile_by_id(conn, user_b_id)
    assert own is not None and str(own["id"]) == user_b_id

    async with rls_connection(claims_a) as conn:
        row = await get_profile_by_id(conn, user_b_id)

    assert row is None
