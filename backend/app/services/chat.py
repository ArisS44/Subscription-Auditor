"""The Apollon conversation engine: the tool-calling loop over the registry,
message/conversation persistence, auto-titling, and cap enforcement — streamed as
provider-neutral events the router serializes to SSE.

Per turn: enforce caps → persist the user message → replay a bounded history to
the model → stream text live, dispatching any tool calls through the registry
(never a handler directly) and feeding results back → loop until a text-only
answer or the iteration cap → persist the final assistant message (with any
grounded chart/table payload) → auto-title on the first message.
"""

import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.config import settings
from app.db import chat as chat_db
from app.db.rls import rls_connection
from app.services import llm, tools, usage
from app.services.prompts import build_system_prompt

logger = logging.getLogger("app.services.chat")

# Cap-breach reason -> user-facing copy (neutral, no internals leaked).
_DEGRADED_MESSAGES = {
    usage.CAP_VELOCITY: "You're sending messages too quickly — please wait a moment and try again.",
    usage.CAP_USER_DAILY: "You've reached today's message limit. Please try again tomorrow.",
    usage.CAP_GLOBAL_DAILY: "The assistant is busy right now. Please try again shortly.",
}

_RENDER_TOOLS = {"render_chart", "render_table"}


class ConversationNotFoundError(Exception):
    """The conversation does not exist or is not visible to the caller (RLS)."""


def _assistant_tool_calls(tool_calls: list[llm.ToolCall]) -> list[dict]:
    """Serialize assembled tool calls into the OpenAI-style shape the LLM adapter
    replays from history (and that persists in messages.tool_calls)."""
    return [
        {
            "id": tc.id,
            "type": "function",
            "function": {"name": tc.name, "arguments": tc.arguments},
        }
        for tc in tool_calls
    ]


async def stream_turn(
    claims: dict,
    conversation_id: str,
    user_text: str,
    *,
    onboarding: bool = False,
    client: httpx.AsyncClient | None = None,
) -> AsyncIterator[dict]:
    """Drive one assistant turn, yielding event dicts:
    {type: delta|tool|structured|title|done|error, ...}."""
    user_id = claims["sub"]

    # 1. Caps first — no LLM work, no persistence, on a breach.
    reason = await usage.enforce_caps(claims)
    if reason is not None:
        yield {"type": "error", "reason": reason, "message": _DEGRADED_MESSAGES[reason]}
        return

    # 2. Ownership + persist the user message + load the replay window + language.
    async with rls_connection(claims) as conn:
        conv = await chat_db.get_conversation(conn, conversation_id)
        if conv is None:
            raise ConversationNotFoundError()
        is_first_message = (await chat_db.count_messages(conn, conversation_id)) == 0
        language = (
            await conn.fetchval("SELECT preferred_language FROM profiles WHERE id = $1", user_id)
            or "auto"
        )
        await chat_db.insert_message(
            conn,
            conversation_id=conversation_id,
            user_id=user_id,
            role="user",
            content=user_text,
        )
        window = await chat_db.get_recent_messages(
            conn, conversation_id, limit=settings.chat_history_window
        )

    history = [
        llm.Message(
            role=m["role"],
            content=m["content"],
            tool_calls=m["tool_calls"],
            tool_call_id=m["tool_call_id"],
        )
        for m in window
    ]
    system = build_system_prompt(language, onboarding=onboarding)
    tool_defs = tools.tool_definitions(settings.llm_provider)

    analytics_called = False  # grounding: a render payload is trusted only if
    last_render_payload = None  # get_analytics was called in this same turn.
    final_text = ""
    stream_failed = False

    for _iteration in range(settings.chat_max_tool_iterations):
        round_text = ""
        round_tool_calls: list[llm.ToolCall] = []
        async for event in llm.stream_chat_turn(history, tool_defs, system=system, client=client):
            if isinstance(event, llm.TextDelta):
                round_text += event.text
                yield {"type": "delta", "text": event.text}
            elif isinstance(event, llm.ToolCall):
                round_tool_calls.append(event)
            elif isinstance(event, llm.StreamError):
                stream_failed = True
                yield {"type": "error", "reason": event.reason, "message": event.message}

        if stream_failed:
            break
        if not round_tool_calls:
            final_text = round_text
            break

        # Persist the assistant turn that requested tools, then execute each call.
        assistant_calls = _assistant_tool_calls(round_tool_calls)
        async with rls_connection(claims) as conn:
            await chat_db.insert_message(
                conn,
                conversation_id=conversation_id,
                user_id=user_id,
                role="assistant",
                content=round_text or None,
                tool_calls=assistant_calls,
            )
        history.append(
            llm.Message(role="assistant", content=round_text or None, tool_calls=assistant_calls)
        )

        # Mark grounding for the whole turn before dispatching (handles a round
        # that requests get_analytics and a render together).
        if any(tc.name == "get_analytics" for tc in round_tool_calls):
            analytics_called = True

        for tc in round_tool_calls:
            yield {"type": "tool", "name": tc.name}
            if tc.name in _RENDER_TOOLS and not analytics_called:
                # Ungrounded render: refuse and tell the model, don't store it.
                result_content = {
                    "error": f"{tc.name} requires a get_analytics call in this turn first"
                }
            else:
                result = await tools.dispatch(tc.name, tc.arguments, claims)
                result_content = result.content
                if result.ok and tc.name in _RENDER_TOOLS:
                    last_render_payload = result.content

            tool_content = json.dumps(result_content)
            async with rls_connection(claims) as conn:
                await chat_db.insert_message(
                    conn,
                    conversation_id=conversation_id,
                    user_id=user_id,
                    role="tool",
                    content=tool_content,
                    tool_call_id=tc.id,
                )
            history.append(llm.Message(role="tool", content=tool_content, tool_call_id=tc.id))
    else:
        # Iteration cap hit without a text-only answer — end gracefully.
        final_text = round_text or (
            "I couldn't complete that request within the allowed steps — please try rephrasing."
        )

    if stream_failed:
        yield {"type": "done"}
        return

    # Persist the final assistant message (+ any grounded chart/table payload).
    async with rls_connection(claims) as conn:
        await chat_db.insert_message(
            conn,
            conversation_id=conversation_id,
            user_id=user_id,
            role="assistant",
            content=final_text or None,
            structured_payload=last_render_payload,
        )
        await chat_db.touch_conversation(conn, conversation_id)
    if last_render_payload is not None:
        yield {"type": "structured", "payload": last_render_payload}

    # Auto-title on the conversation's first message.
    if is_first_message:
        title = None
        try:
            title = await llm.generate_title(user_text, client=client)
        except Exception:  # noqa: BLE001 — titling is best-effort, never fail the turn
            logger.warning("auto-title generation failed")
        if title:
            async with rls_connection(claims) as conn:
                await chat_db.update_conversation_title(conn, conversation_id, title)
            yield {"type": "title", "title": title}

    yield {"type": "done"}
