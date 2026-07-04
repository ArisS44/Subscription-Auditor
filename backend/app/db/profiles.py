import asyncpg


async def get_profile_by_id(conn: asyncpg.Connection, user_id: str) -> asyncpg.Record | None:
    """Fetch a profile row by id, scoped by whatever RLS context the given
    connection carries (see `app.db.rls.rls_connection`). Takes an
    arbitrary id rather than assuming "caller's own row" so RLS — not
    application logic — is what enforces the access boundary: passing
    another user's id here returns no row instead of raising, because
    Postgres filters it out before this function ever sees it.
    """
    return await conn.fetchrow(
        "SELECT id, email, display_name, preferred_language FROM profiles WHERE id = $1",
        user_id,
    )
