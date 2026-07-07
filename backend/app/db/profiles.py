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


# Columns a profile owner may update. id / email are not client-mutable here.
_UPDATABLE_COLUMNS = frozenset({"display_name", "preferred_language"})


async def update_profile(
    conn: asyncpg.Connection, user_id: str, fields: dict
) -> asyncpg.Record | None:
    """Apply a partial update to the caller's own profile, scoped by RLS. Column
    names come only from the `_UPDATABLE_COLUMNS` allowlist; values are bound
    parameters. Returns the updated row, or None if RLS/id matched nothing. With
    no updatable fields, returns the current row unchanged.
    """
    items = [(col, val) for col, val in fields.items() if col in _UPDATABLE_COLUMNS]
    if not items:
        return await get_profile_by_id(conn, user_id)

    set_clauses = []
    values: list = []
    for idx, (col, val) in enumerate(items, start=1):
        set_clauses.append(f"{col} = ${idx}")
        values.append(val)
    set_sql = ", ".join(set_clauses) + ", updated_at = now()"
    id_param = len(values) + 1
    values.append(user_id)

    return await conn.fetchrow(
        f"UPDATE profiles SET {set_sql} WHERE id = ${id_param} "
        "RETURNING id, email, display_name, preferred_language",
        *values,
    )
