from app.db.rls import rls_connection
from app.deps import verify_token

# Real-DB cross-user RLS denial for the chat tables (second security wall),
# mirroring test_rls.py / test_subscriptions.py. Authenticated as user A we write
# a conversation and a message; authenticated as user B, RLS must make A's rows
# invisible AND unmodifiable — not because application code filtered them, but
# because Postgres excludes rows failing `auth.uid() = user_id` under the
# `authenticated` role. Inline SQL (not a db-layer helper) keeps this test from
# pre-empting the chat db module a later task will own; the security structure is
# what matters here.


async def test_cross_user_conversation_denied_by_rls(db_pool, user_a, user_b):
    a_id, token_a = user_a
    _, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    async with rls_connection(claims_a) as conn:
        row = await conn.fetchrow(
            "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id",
            a_id,
            "A private thread",
        )
    conv_id = row["id"]

    # Owner can read it.
    async with rls_connection(claims_a) as conn:
        assert (
            await conn.fetchrow("SELECT id FROM conversations WHERE id = $1", conv_id) is not None
        )

    # Non-owner cannot read it, and cannot modify or delete it (both match zero
    # rows under RLS, so RETURNING comes back empty).
    async with rls_connection(claims_b) as conn:
        assert await conn.fetchrow("SELECT id FROM conversations WHERE id = $1", conv_id) is None
        assert (
            await conn.fetchrow(
                "UPDATE conversations SET title = 'hacked' WHERE id = $1 RETURNING id", conv_id
            )
            is None
        )
        assert (
            await conn.fetchrow("DELETE FROM conversations WHERE id = $1 RETURNING id", conv_id)
            is None
        )

    # A's row is untouched by B's attempts.
    async with rls_connection(claims_a) as conn:
        still = await conn.fetchrow("SELECT title FROM conversations WHERE id = $1", conv_id)
    assert still is not None and still["title"] == "A private thread"


async def test_cross_user_message_denied_by_rls(db_pool, user_a, user_b):
    a_id, token_a = user_a
    _, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    async with rls_connection(claims_a) as conn:
        conv = await conn.fetchrow(
            "INSERT INTO conversations (user_id) VALUES ($1) RETURNING id", a_id
        )
        msg = await conn.fetchrow(
            "INSERT INTO messages (conversation_id, user_id, role, content) "
            "VALUES ($1, $2, 'user', $3) RETURNING id",
            conv["id"],
            a_id,
            "A secret message",
        )
    msg_id = msg["id"]

    # Owner can read it.
    async with rls_connection(claims_a) as conn:
        assert await conn.fetchrow("SELECT id FROM messages WHERE id = $1", msg_id) is not None

    # Non-owner cannot read, modify, or delete it.
    async with rls_connection(claims_b) as conn:
        assert await conn.fetchrow("SELECT id FROM messages WHERE id = $1", msg_id) is None
        assert (
            await conn.fetchrow(
                "UPDATE messages SET content = 'tampered' WHERE id = $1 RETURNING id", msg_id
            )
            is None
        )
        assert (
            await conn.fetchrow("DELETE FROM messages WHERE id = $1 RETURNING id", msg_id) is None
        )
