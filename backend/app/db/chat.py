import json
from typing import Any

import asyncpg

# Conversations/messages are user-scoped: every function here runs on an
# rls_connection(claims), so RLS (auth.uid() = user_id) is what scopes rows to the
# owner — a non-owner's id returns None, which the router turns into a 404.
#
# tool_calls / structured_payload are JSONB. asyncpg's default jsonb handling is
# text-based (str in, str out), so these helpers json.dumps on write and json.loads
# on read, keeping JSON (de)serialization in one place.

_MESSAGE_COLUMNS = (
    "id, conversation_id, user_id, role, content, tool_calls, tool_call_id, "
    "structured_payload, created_at"
)
_CONVERSATION_COLUMNS = "id, user_id, title, created_at, updated_at"


def _jsonb(value: Any | None) -> str | None:
    return json.dumps(value) if value is not None else None


def message_row_to_dict(row: asyncpg.Record) -> dict:
    """Turn a message Record into a plain dict with JSONB fields parsed back into
    Python objects."""
    data = dict(row)
    for field in ("tool_calls", "structured_payload"):
        if data.get(field) is not None:
            data[field] = json.loads(data[field])
    return data


# --- Conversations ---------------------------------------------------------
async def insert_conversation(
    conn: asyncpg.Connection, user_id: str, title: str | None = None
) -> asyncpg.Record:
    return await conn.fetchrow(
        f"""
        INSERT INTO conversations (user_id, title) VALUES ($1, $2)
        RETURNING {_CONVERSATION_COLUMNS}
        """,
        user_id,
        title,
    )


async def get_conversation(conn: asyncpg.Connection, conversation_id: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"SELECT {_CONVERSATION_COLUMNS} FROM conversations WHERE id = $1", conversation_id
    )


async def list_conversations(
    conn: asyncpg.Connection, *, limit: int, offset: int
) -> list[asyncpg.Record]:
    return await conn.fetch(
        f"""
        SELECT {_CONVERSATION_COLUMNS} FROM conversations
        ORDER BY updated_at DESC, id ASC
        LIMIT $1 OFFSET $2
        """,
        limit,
        offset,
    )


async def count_conversations(conn: asyncpg.Connection) -> int:
    return await conn.fetchval("SELECT count(*) FROM conversations")


async def delete_conversation(
    conn: asyncpg.Connection, conversation_id: str
) -> asyncpg.Record | None:
    # Messages cascade via the FK; RETURNING distinguishes a real delete from
    # nothing matched under RLS (→ 404).
    return await conn.fetchrow(
        "DELETE FROM conversations WHERE id = $1 RETURNING id", conversation_id
    )


async def update_conversation_title(
    conn: asyncpg.Connection, conversation_id: str, title: str
) -> asyncpg.Record | None:
    return await conn.fetchrow(
        f"""
        UPDATE conversations SET title = $2, updated_at = now()
        WHERE id = $1 RETURNING {_CONVERSATION_COLUMNS}
        """,
        conversation_id,
        title,
    )


async def touch_conversation(conn: asyncpg.Connection, conversation_id: str) -> None:
    """Bump updated_at so a conversation with new activity sorts to the top."""
    await conn.execute("UPDATE conversations SET updated_at = now() WHERE id = $1", conversation_id)


# --- Messages --------------------------------------------------------------
async def insert_message(
    conn: asyncpg.Connection,
    *,
    conversation_id: str,
    user_id: str,
    role: str,
    content: str | None = None,
    tool_calls: list[dict] | None = None,
    tool_call_id: str | None = None,
    structured_payload: dict | None = None,
) -> asyncpg.Record:
    row = await conn.fetchrow(
        f"""
        INSERT INTO messages
          (conversation_id, user_id, role, content, tool_calls, tool_call_id, structured_payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING {_MESSAGE_COLUMNS}
        """,
        conversation_id,
        user_id,
        role,
        content,
        _jsonb(tool_calls),
        tool_call_id,
        _jsonb(structured_payload),
    )
    return row


async def get_recent_messages(
    conn: asyncpg.Connection, conversation_id: str, *, limit: int
) -> list[dict]:
    """The last `limit` messages for a conversation, returned oldest→newest so the
    slice can be replayed to the model in order. Backed by the
    (conversation_id, created_at) index."""
    rows = await conn.fetch(
        f"""
        SELECT {_MESSAGE_COLUMNS} FROM (
            SELECT {_MESSAGE_COLUMNS} FROM messages
            WHERE conversation_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2
        ) recent
        ORDER BY created_at ASC, id ASC
        """,
        conversation_id,
        limit,
    )
    return [message_row_to_dict(r) for r in rows]


async def list_messages(
    conn: asyncpg.Connection, conversation_id: str, *, limit: int, offset: int
) -> list[dict]:
    rows = await conn.fetch(
        f"""
        SELECT {_MESSAGE_COLUMNS} FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT $2 OFFSET $3
        """,
        conversation_id,
        limit,
        offset,
    )
    return [message_row_to_dict(r) for r in rows]


async def count_messages(conn: asyncpg.Connection, conversation_id: str) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM messages WHERE conversation_id = $1", conversation_id
    )


async def recent_user_message_count(conn: asyncpg.Connection, user_id: str, *, seconds: int) -> int:
    """How many user-role messages this user has sent in the last `seconds` —
    the per-user velocity window. RLS already scopes to the owner; the explicit
    user_id keeps it index-friendly and unambiguous."""
    return await conn.fetchval(
        """
        SELECT count(*) FROM messages
        WHERE user_id = $1 AND role = 'user'
          AND created_at > now() - ($2 || ' seconds')::interval
        """,
        user_id,
        str(seconds),
    )
