import json
import uuid

import pytest

from app.config import settings
from app.db import chat as chat_db
from app.db.pool import get_pool
from app.db.rls import rls_connection
from app.deps import verify_token
from app.services import chat as chat_svc
from app.services import llm


# --------------------------------------------------------------------------
# Helpers: a scripted stub LLM so the loop is driven deterministically with no
# live model call (per the task's guidance).
# --------------------------------------------------------------------------
class _ScriptedLLM:
    """Each call to stream_chat_turn returns the next scripted event list and
    records the history it was given (so tests can assert the replay window)."""

    def __init__(self, scripts: list[list]) -> None:
        self.scripts = list(scripts)
        self.calls: list[list] = []

    async def __call__(self, history, tools=None, *, system=None, client=None, **kw):
        self.calls.append(list(history))
        for event in self.scripts.pop(0):
            yield event


async def _fake_title(text, *, client=None):
    return "Test Title"


async def _collect(agen) -> list:
    return [e async for e in agen]


async def _new_conversation(claims: dict, user_id: str) -> str:
    async with rls_connection(claims) as conn:
        row = await chat_db.insert_conversation(conn, user_id, None)
    return str(row["id"])


async def _messages(claims: dict, conversation_id: str) -> list[dict]:
    async with rls_connection(claims) as conn:
        return await chat_db.list_messages(conn, conversation_id, limit=200, offset=0)


def _patch_llm(monkeypatch, scripted: _ScriptedLLM) -> None:
    monkeypatch.setattr(llm, "stream_chat_turn", scripted)
    monkeypatch.setattr(llm, "generate_title", _fake_title)


async def _cleanup_usage(user_id: str) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM llm_usage WHERE user_id = $1", user_id)


# --------------------------------------------------------------------------
# Core: a user message drives a tool call, streams a final response, and every
# row persists with the right shapes; the first message auto-titles.
# --------------------------------------------------------------------------
async def test_turn_drives_tool_call_streams_and_persists(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    scripted = _ScriptedLLM(
        [
            [
                llm.TextDelta("Checking. "),
                llm.ToolCall("c1", "get_analytics", "{}"),
                llm.StreamDone(),
            ],
            [llm.TextDelta("You have no subscriptions yet."), llm.StreamDone()],
        ]
    )
    _patch_llm(monkeypatch, scripted)

    events = await _collect(chat_svc.stream_turn(claims, conv, "How am I doing?"))
    types = [e["type"] for e in events]
    assert "delta" in types and types[-1] == "done"
    assert any(e["type"] == "title" and e["title"] == "Test Title" for e in events)

    msgs = await _messages(claims, conv)
    assert [m["role"] for m in msgs] == ["user", "assistant", "tool", "assistant"]
    assert msgs[0]["content"] == "How am I doing?"
    assert msgs[1]["tool_calls"][0]["function"]["name"] == "get_analytics"  # assistant tool call
    assert msgs[2]["tool_call_id"] == "c1"  # tool result keyed to the call
    assert json.loads(msgs[2]["content"])["monthly_burn_by_currency"] == {}  # real analytics result
    assert msgs[3]["content"] == "You have no subscriptions yet."  # final assistant text

    async with rls_connection(claims) as conn:
        conv_row = await chat_db.get_conversation(conn, conv)
    assert conv_row["title"] == "Test Title"
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# The ~20-message window bounds what gets replayed.
# --------------------------------------------------------------------------
async def test_history_window_bounds_replay(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    async with rls_connection(claims) as conn:
        for i in range(25):
            await chat_db.insert_message(
                conn,
                conversation_id=conv,
                user_id=uid,
                role="user" if i % 2 == 0 else "assistant",
                content=f"m{i}",
            )
    scripted = _ScriptedLLM([[llm.TextDelta("ok"), llm.StreamDone()]])
    _patch_llm(monkeypatch, scripted)

    await _collect(chat_svc.stream_turn(claims, conv, "newest"))
    # Exactly one LLM call, and its replayed history is capped to the window.
    assert len(scripted.calls) == 1
    assert len(scripted.calls[0]) == settings.chat_history_window
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# The loop caps tool iterations and ends gracefully (no hang).
# --------------------------------------------------------------------------
async def test_tool_iteration_cap_terminates(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    monkeypatch.setattr(settings, "chat_max_tool_iterations", 3)
    # Always ask for another tool call — the loop must stop at the cap.
    scripted = _ScriptedLLM(
        [[llm.ToolCall(f"c{i}", "get_analytics", "{}"), llm.StreamDone()] for i in range(5)]
    )
    _patch_llm(monkeypatch, scripted)

    events = await _collect(chat_svc.stream_turn(claims, conv, "loop please"))
    assert events[-1]["type"] == "done"
    assert len(scripted.calls) == 3  # capped at chat_max_tool_iterations

    msgs = await _messages(claims, conv)
    assistant_tool_msgs = [m for m in msgs if m["role"] == "assistant" and m["tool_calls"]]
    assert len(assistant_tool_msgs) == 3
    assert msgs[-1]["role"] == "assistant"  # graceful final message persisted
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# Inline-visual grounding: a render payload is only trusted with get_analytics.
# --------------------------------------------------------------------------
_CHART = {"chart_type": "bar", "points": [{"label": "Netflix", "value": 15.99}]}


async def test_ungrounded_render_is_rejected(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    scripted = _ScriptedLLM(
        [
            [llm.ToolCall("r1", "render_chart", json.dumps(_CHART)), llm.StreamDone()],
            [llm.TextDelta("done"), llm.StreamDone()],
        ]
    )
    _patch_llm(monkeypatch, scripted)

    await _collect(chat_svc.stream_turn(claims, conv, "chart it"))
    msgs = await _messages(claims, conv)
    tool_msg = next(m for m in msgs if m["role"] == "tool")
    assert "get_analytics" in json.loads(tool_msg["content"])["error"]  # refused
    assert msgs[-1]["structured_payload"] is None  # nothing stored
    await _cleanup_usage(uid)


async def test_grounded_render_is_stored(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    scripted = _ScriptedLLM(
        [
            [llm.ToolCall("a1", "get_analytics", "{}"), llm.StreamDone()],
            [llm.ToolCall("r1", "render_chart", json.dumps(_CHART)), llm.StreamDone()],
            [llm.TextDelta("here it is"), llm.StreamDone()],
        ]
    )
    _patch_llm(monkeypatch, scripted)

    events = await _collect(chat_svc.stream_turn(claims, conv, "analyze and chart"))
    assert any(e["type"] == "structured" for e in events)
    msgs = await _messages(claims, conv)
    assert msgs[-1]["structured_payload"]["chart_type"] == "bar"  # grounded payload stored
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# Cap breach degrades gracefully and never engages the model.
# --------------------------------------------------------------------------
async def test_cap_breach_degrades_without_calling_llm(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    monkeypatch.setattr(settings, "chat_user_daily_cap", 0)  # any message trips the daily cap
    called = {"n": 0}

    async def _must_not_run(*a, **k):
        called["n"] += 1
        yield llm.TextDelta("should not happen")

    monkeypatch.setattr(llm, "stream_chat_turn", _must_not_run)

    events = await _collect(chat_svc.stream_turn(claims, conv, "hi"))
    assert called["n"] == 0
    assert events[0]["type"] == "error" and events[0]["reason"] == "user_daily"
    # No assistant/tool messages were persisted (only the earlier none).
    msgs = await _messages(claims, conv)
    assert all(m["role"] != "assistant" for m in msgs)
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# RLS scoping: a tool/message turn cannot touch another user's conversation.
# --------------------------------------------------------------------------
async def test_cross_user_conversation_denied(db_pool, user_a, user_b, monkeypatch):
    a_id, token_a = user_a
    b_id, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)
    conv = await _new_conversation(claims_a, a_id)
    _patch_llm(monkeypatch, _ScriptedLLM([[llm.TextDelta("x"), llm.StreamDone()]]))

    with pytest.raises(chat_svc.ConversationNotFoundError):
        await _collect(chat_svc.stream_turn(claims_b, conv, "peek"))
    await _cleanup_usage(b_id)


# --------------------------------------------------------------------------
# Destructive-action confirmation is the prompt's job: the loop only executes a
# tool the model actually emits. A text-only turn (e.g. "are you sure?") runs no
# tool at all — so a destructive action never fires without the model choosing to.
# --------------------------------------------------------------------------
async def test_text_only_turn_executes_no_tools(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    # The model asks for confirmation instead of calling delete_subscription.
    scripted = _ScriptedLLM(
        [[llm.TextDelta("Are you sure you want to delete Netflix? (yes/no)"), llm.StreamDone()]]
    )
    _patch_llm(monkeypatch, scripted)

    await _collect(chat_svc.stream_turn(claims, conv, "delete my netflix"))
    msgs = await _messages(claims, conv)
    assert [m["role"] for m in msgs] == ["user", "assistant"]  # no tool executed
    assert not any(m["role"] == "tool" for m in msgs)
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# Grounding (symptom 1): a write request missing required details must produce a
# clarifying question, never a fabricated success. The loop only ever runs a tool
# the model actually emits — so when a prompt-compliant model asks for the missing
# name/price/billing details instead of calling add_subscription, no subscription
# is created and no success is persisted.
# --------------------------------------------------------------------------
async def test_missing_details_add_asks_and_creates_nothing(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    scripted = _ScriptedLLM(
        [[llm.TextDelta("Sure — what's the name, price, and billing cycle?"), llm.StreamDone()]]
    )
    _patch_llm(monkeypatch, scripted)

    await _collect(chat_svc.stream_turn(claims, conv, "I want to add a subscription"))
    msgs = await _messages(claims, conv)
    # Clarifying question only: user + assistant, no tool ran, so nothing was added.
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert not any(m["role"] == "tool" for m in msgs)
    async with rls_connection(claims) as conn:
        sub_count = await conn.fetchval(
            "SELECT count(*) FROM subscriptions WHERE user_id = $1", uid
        )
    assert sub_count == 0  # no fabricated subscription persisted
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# Symptom 3: a provider rate-limit (413/429 → StreamError reason="rate_limited")
# degrades to a clean, retriable error event — never a raw HTTP status — and ends
# the turn cleanly.
# --------------------------------------------------------------------------
async def test_rate_limited_stream_degrades_cleanly(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    scripted = _ScriptedLLM(
        [
            [
                llm.StreamError(
                    "The assistant is busy right now. Please try again in a moment.",
                    reason="rate_limited",
                ),
                llm.StreamDone(),
            ]
        ]
    )
    _patch_llm(monkeypatch, scripted)

    events = await _collect(chat_svc.stream_turn(claims, conv, "how am I doing?"))
    err = next(e for e in events if e["type"] == "error")
    assert err["reason"] == "rate_limited"
    assert "413" not in err["message"] and "429" not in err["message"]
    assert events[-1]["type"] == "done"
    # Only the user message persisted; no assistant/tool rows from a failed turn.
    msgs = await _messages(claims, conv)
    assert all(m["role"] == "user" for m in msgs)
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# Symptom 3 (bloat check): three real turns in one conversation each complete and
# the replayed outbound history stays bounded by the window — so the request never
# grows unboundedly across turns (the shape that would eventually trip a 413).
# --------------------------------------------------------------------------
async def test_three_turns_replay_history_stays_bounded(db_pool, user_a, monkeypatch):
    uid, token = user_a
    claims = verify_token(token)
    conv = await _new_conversation(claims, uid)
    scripted = _ScriptedLLM([[llm.TextDelta(f"reply {i}"), llm.StreamDone()] for i in range(3)])
    _patch_llm(monkeypatch, scripted)

    for i in range(3):
        events = await _collect(chat_svc.stream_turn(claims, conv, f"turn {i}"))
        assert events[-1]["type"] == "done"

    assert len(scripted.calls) == 3  # one LLM call per turn, no runaway loop
    # Every replayed window is capped — history does not grow without bound.
    for call in scripted.calls:
        assert len(call) <= settings.chat_history_window
    await _cleanup_usage(uid)


# --------------------------------------------------------------------------
# HTTP: auth, 404, and incremental SSE with the no-buffering headers.
# --------------------------------------------------------------------------
def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_post_message_requires_auth(test_client):
    r = test_client.post(f"/api/v1/conversations/{uuid.uuid4()}/messages", json={"content": "hi"})
    assert r.status_code == 401


def test_post_to_missing_conversation_returns_404(test_client, user_a):
    _, token = user_a
    r = test_client.post(
        f"/api/v1/conversations/{uuid.uuid4()}/messages",
        headers=_auth(token),
        json={"content": "hi"},
    )
    assert r.status_code == 404


def test_sse_streams_incrementally(test_client, user_a, monkeypatch):
    _, token = user_a
    conv = test_client.post("/api/v1/conversations", headers=_auth(token), json={}).json()

    async def _fake(history, tools=None, *, system=None, client=None, **k):
        yield llm.TextDelta("Hel")
        yield llm.TextDelta("lo")
        yield llm.StreamDone()

    monkeypatch.setattr(llm, "stream_chat_turn", _fake)
    monkeypatch.setattr(llm, "generate_title", _fake_title)

    with test_client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/messages",
        headers=_auth(token),
        json={"content": "hi"},
    ) as r:
        assert r.status_code == 200
        assert r.headers["cache-control"] == "no-cache"
        assert r.headers["x-accel-buffering"] == "no"
        assert r.headers["content-type"].startswith("text/event-stream")
        frames = [ln for ln in r.iter_lines() if ln.startswith("data:")]

    events = [json.loads(f[len("data:") :].strip()) for f in frames]
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert "".join(deltas) == "Hello"  # arrived as two separate frames
    assert len(deltas) == 2
    assert events[-1]["type"] == "done"
