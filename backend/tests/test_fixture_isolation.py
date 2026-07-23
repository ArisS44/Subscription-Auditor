from app.db.rls import rls_connection
from app.deps import verify_token

# The shared-user fixtures trade freshly-minted users for a per-test reset, so
# the isolation they provide is a property of the cleanup rather than of the
# user being new. That property is load-bearing — without it a test could pass
# or fail because of rows an earlier test left behind — so it is demonstrated
# here rather than assumed.
#
# These two tests run in order within this file and deliberately share user_a:
# the first leaves rows behind on purpose, the second asserts it cannot see
# them. If the reset ever stops running, the second test fails, which is exactly
# the alarm that should sound.


async def test_leaves_rows_behind_for_the_next_test(db_pool, user_a):
    a_id, token_a = user_a
    claims_a = verify_token(token_a)

    async with rls_connection(claims_a) as conn:
        await conn.execute(
            "INSERT INTO subscriptions (user_id, name, price, billing_cycle, start_date) "
            "VALUES ($1, 'Leftover Service', 42.00, 'monthly', CURRENT_DATE)",
            a_id,
        )
        await conn.execute(
            "INSERT INTO conversations (user_id, title) VALUES ($1, 'Leftover thread')",
            a_id,
        )
        # Sanity: the rows really are written, so the next test's assertion is
        # about cleanup working rather than about nothing having been created.
        assert (
            await conn.fetchval("SELECT count(*) FROM subscriptions WHERE user_id = $1", a_id) == 1
        )


async def test_does_not_see_previous_tests_rows(db_pool, user_a):
    """Same underlying Supabase user as the test above — the reset between them
    is the only reason this passes."""
    a_id, token_a = user_a
    claims_a = verify_token(token_a)

    async with rls_connection(claims_a) as conn:
        assert (
            await conn.fetchval("SELECT count(*) FROM subscriptions WHERE user_id = $1", a_id) == 0
        )
        assert (
            await conn.fetchval("SELECT count(*) FROM conversations WHERE user_id = $1", a_id) == 0
        )
        # The profile survives the reset (an auth trigger creates it at signup)
        # but its mutable fields are returned to their defaults, so a test that
        # PATCHes them cannot influence a later one.
        profile = await conn.fetchrow(
            "SELECT display_name, preferred_language, renewal_lead_days, "
            "onboarding_completed FROM profiles WHERE id = $1",
            a_id,
        )
    assert profile is not None
    assert profile["display_name"] is None
    assert profile["preferred_language"] == "auto"
    assert profile["renewal_lead_days"] == 3
    assert profile["onboarding_completed"] is False


async def test_shared_users_are_reused_not_recreated(db_pool, user_a, user_b):
    """The point of the rework: these ids are stable for the whole run, so the
    suite creates two Supabase users rather than one per test. A regression to
    per-test creation would show up as the flakiness this replaced."""
    a_id, _ = user_a
    b_id, _ = user_b
    assert a_id != b_id
    # Recorded so the reuse is visible in the test output, not just implied.
    print(f"\nshared user_a={a_id} user_b={b_id}")
