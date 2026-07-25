import asyncpg

# Read access to service_guides. This runs on an RLS-scoped connection
# (rls_connection(claims)) like every other tool read: the table's RLS grants
# SELECT to any authenticated role, and it has no user write policy at all, so a
# read here can never mutate curated data. Seeding is done via migration, not at
# runtime — there is deliberately no write function in this module.

# Columns the guidance tool exposes. Encryption-style secrets don't exist here;
# this is public curated reference data, so the full useful column set is returned.
_COLUMNS = "service_key, display_name, category, cancel_url, signup_url, " "cancel_steps, plans"


async def get_guide(
    conn: asyncpg.Connection, *, service_key: str, display_name: str
) -> asyncpg.Record | None:
    """Look up a curated guide by exact service_key slug, or by a
    case-insensitive display_name match (so 'Netflix' or 'Disney+' resolves even
    when the model passes a name rather than the slug). Returns None when no
    curated row exists — the caller then treats the request as the unverified
    tier. Both arguments are bound parameters; the model-supplied text never
    reaches the SQL string."""
    return await conn.fetchrow(
        f"""
        SELECT {_COLUMNS} FROM service_guides
        WHERE service_key = $1 OR lower(display_name) = lower($2)
        LIMIT 1
        """,
        service_key,
        display_name,
    )
