import json

import httpx
import pytest

from app.config import settings
from app.services.llm import (
    GeminiAdapter,
    GroqAdapter,
    LLMConfigError,
    Message,
    StreamDone,
    StreamError,
    TextDelta,
    ToolCall,
    ToolDef,
    generate_title,
    get_adapter,
    stream_chat_turn,
)


def _adapter() -> GroqAdapter:
    return GroqAdapter(model="test-model", api_key="test-key", base_url=None)


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def _collect(agen) -> list:
    return [ev async for ev in agen]


# ---------------------------------------------------------------------------
# (a) Tool-definition envelope translation.
# ---------------------------------------------------------------------------
def test_format_tools_builds_openai_function_envelope():
    schema = {"type": "object", "properties": {"currency": {"type": "string"}}}
    tools = [ToolDef(name="get_spend", description="Total spend", parameters=schema)]

    result = _adapter().format_tools(tools)

    assert result == [
        {
            "type": "function",
            "function": {
                "name": "get_spend",
                "description": "Total spend",
                "parameters": schema,  # the inner JSON Schema is passed through untouched
            },
        }
    ]


def test_format_tools_none_when_empty():
    assert _adapter().format_tools([]) is None


# ---------------------------------------------------------------------------
# (b) Tool results re-enter history in the provider's expected shape.
# ---------------------------------------------------------------------------
def test_format_messages_translates_tool_result_and_assistant_call():
    assistant_call = {
        "id": "call_1",
        "type": "function",
        "function": {"name": "get_spend", "arguments": "{}"},
    }
    messages = [
        Message(role="system", content="sys"),
        Message(role="user", content="how much?"),
        Message(role="assistant", content=None, tool_calls=[assistant_call]),
        Message(role="tool", tool_call_id="call_1", content="42.00"),
    ]

    result = _adapter().format_messages(messages)

    assert result[0] == {"role": "system", "content": "sys"}
    assert result[1] == {"role": "user", "content": "how much?"}
    # Assistant turn carries its tool_calls through.
    assert result[2] == {"role": "assistant", "content": None, "tool_calls": [assistant_call]}
    # The tool result becomes a role="tool" message keyed by tool_call_id — the
    # OpenAI-style re-insertion shape.
    assert result[3] == {"role": "tool", "tool_call_id": "call_1", "content": "42.00"}


# ---------------------------------------------------------------------------
# (c) Streaming is normalised into the internal event stream.
# ---------------------------------------------------------------------------
async def test_stream_normalizes_text_toolcalls_and_usage():
    sse = (
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",'
        '"function":{"name":"get_spend","arguments":"{\\"cur\\":"}}]}}]}\n\n'
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
        '"function":{"arguments":"\\"USD\\"}"}}]}}]}\n\n'
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["stream"] is True
        assert body["stream_options"] == {"include_usage": True}
        return httpx.Response(200, text=sse)

    events = await _collect(
        _adapter().stream(
            [Message(role="user", content="spend?")], None, client=_mock_client(handler)
        )
    )

    texts = [e.text for e in events if isinstance(e, TextDelta)]
    assert "".join(texts) == "Hello"

    calls = [e for e in events if isinstance(e, ToolCall)]
    assert len(calls) == 1
    assert calls[0].id == "call_1"
    assert calls[0].name == "get_spend"
    # Arguments assembled across chunks into one valid JSON string.
    assert json.loads(calls[0].arguments) == {"cur": "USD"}

    done = events[-1]
    assert isinstance(done, StreamDone)
    assert done.usage is not None
    assert (done.usage.input_tokens, done.usage.output_tokens) == (11, 7)


async def test_stream_yields_error_event_on_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    events = await _collect(
        _adapter().stream([Message(role="user", content="hi")], None, client=_mock_client(handler))
    )
    assert len(events) == 1
    assert events[0].__class__.__name__ == "StreamError"
    assert events[0].reason == "llm_error"
    # No raw provider status or body leaks into the user-facing message.
    assert "500" not in events[0].message and "boom" not in events[0].message


@pytest.mark.parametrize("status", [413, 429])
async def test_stream_maps_rate_limit_status_to_reason(status: int):
    # Groq returns 413 "Request too large ... on tokens per minute (TPM)" or 429
    # when a token-budget window is exhausted; both must degrade as a retriable
    # rate-limit, never as a raw HTTP status shown to the user.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            json={"error": {"message": "Request too large ... service tier on_demand on TPM"}},
        )

    events = await _collect(
        _adapter().stream([Message(role="user", content="hi")], None, client=_mock_client(handler))
    )
    assert len(events) == 1
    err = events[0]
    assert err.__class__.__name__ == "StreamError"
    assert err.reason == "rate_limited"
    # The provider status code and body never reach the user-facing message.
    assert str(status) not in err.message
    assert "TPM" not in err.message and "on_demand" not in err.message


# ---------------------------------------------------------------------------
# One-shot completion (title generation).
# ---------------------------------------------------------------------------
async def test_generate_title_returns_stripped_text(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "llm_api_key", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["stream"] is False
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '"Netflix cost review"'}}],
                "usage": {"prompt_tokens": 4, "completion_tokens": 3},
            },
        )

    title = await generate_title("How much is Netflix costing me?", client=_mock_client(handler))
    assert title == "Netflix cost review"  # surrounding quotes stripped


# ---------------------------------------------------------------------------
# Provider/model selection comes from environment config, not adapter code.
# ---------------------------------------------------------------------------
def test_get_adapter_reads_provider_and_model_from_env(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "llm_model", "a-different-model")
    monkeypatch.setattr(settings, "llm_api_key", "test-key")

    adapter = get_adapter()
    assert isinstance(adapter, GroqAdapter)
    assert adapter.model == "a-different-model"


# ---------------------------------------------------------------------------
# Gemini adapter — the same three translations against Gemini's REST shape.
# ---------------------------------------------------------------------------
def _gemini() -> GeminiAdapter:
    return GeminiAdapter(model="gemini-2.5-flash", api_key="test-key", base_url=None)


def test_gemini_format_tools_wraps_function_declarations():
    schema = {"type": "object", "properties": {"currency": {"type": "string"}}}
    tools = [ToolDef(name="get_spend", description="Total spend", parameters=schema)]

    result = _gemini().format_tools(tools)

    assert result == [
        {
            "function_declarations": [
                {"name": "get_spend", "description": "Total spend", "parameters": schema}
            ]
        }
    ]


def test_gemini_format_tools_omits_parameters_for_no_arg_tool():
    # An empty properties object trips Gemini's schema check, so parameters is
    # dropped entirely for a no-arg tool.
    tools = [ToolDef(name="get_analytics", description="Roll-up", parameters={"type": "object"})]
    decls = _gemini().format_tools(tools)[0]["function_declarations"]
    assert "parameters" not in decls[0]


def test_gemini_format_messages_splits_system_and_maps_tool_result_by_name():
    assistant_call = {
        "id": "call_1",
        "type": "function",
        "function": {"name": "get_spend", "arguments": '{"cur":"USD"}'},
    }
    messages = [
        Message(role="system", content="You are Apollon."),
        Message(role="user", content="how much?"),
        Message(role="assistant", content=None, tool_calls=[assistant_call]),
        Message(role="tool", tool_call_id="call_1", content='{"total": 42}'),
    ]
    adapter = _gemini()

    # System is pulled out of contents into a separate instruction block.
    assert adapter._system_instruction(messages) == {"parts": [{"text": "You are Apollon."}]}
    contents = adapter.format_messages(messages)

    assert contents[0] == {"role": "user", "parts": [{"text": "how much?"}]}
    # Assistant tool call -> a model turn with a functionCall part (args as object).
    assert contents[1] == {
        "role": "model",
        "parts": [{"functionCall": {"name": "get_spend", "args": {"cur": "USD"}}}],
    }
    # Tool result -> functionResponse keyed by the call's *name* (recovered via id).
    assert contents[2] == {
        "role": "user",
        "parts": [{"functionResponse": {"name": "get_spend", "response": {"total": 42}}}],
    }


async def test_gemini_stream_captures_thought_signature_and_real_id():
    # Gemini thinking models attach a `thoughtSignature` (and a real id) to each
    # functionCall part; both must be captured so the follow-up turn can replay the
    # call — without the signature Gemini 400s the tool-result round.
    sse = (
        'data: {"candidates":[{"content":{"parts":[{"functionCall":'
        '{"name":"get_spend","args":{},"id":"abc123"},"thoughtSignature":"SIG=="}]}}]}\n\n'
    )
    events = await _collect(
        _gemini().stream(
            [Message(role="user", content="spend?")],
            None,
            client=_mock_client(lambda r: httpx.Response(200, text=sse)),
        )
    )
    call = next(e for e in events if isinstance(e, ToolCall))
    assert call.id == "abc123"  # provider's real id, not a synthesized one
    assert call.thought_signature == "SIG=="


def test_gemini_format_messages_replays_thought_signature():
    assistant_call = {
        "id": "abc123",
        "type": "function",
        "function": {"name": "get_spend", "arguments": "{}"},
        "thought_signature": "SIG==",
    }
    contents = _gemini().format_messages(
        [Message(role="assistant", content=None, tool_calls=[assistant_call])]
    )
    # The replayed model turn carries the signature back on the functionCall part.
    assert contents[0]["parts"][0] == {
        "functionCall": {"name": "get_spend", "args": {}},
        "thoughtSignature": "SIG==",
    }


def test_gemini_format_messages_skips_orphaned_tool_result():
    # When the sliding history window cuts between a functionCall and its result,
    # the leading tool result is orphaned. It must be dropped, not emitted with a
    # bogus function name — Gemini 400s a functionResponse that names no in-request
    # call, which would break the whole (long-conversation) turn.
    messages = [
        Message(role="tool", tool_call_id="truncated_call", content='{"total": 42}'),
        Message(role="user", content="and now?"),
    ]
    contents = _gemini().format_messages(messages)
    assert contents == [{"role": "user", "parts": [{"text": "and now?"}]}]


def test_groq_format_messages_strips_thought_signature():
    # The Gemini-only key must never reach Groq's OpenAI-style API.
    assistant_call = {
        "id": "call_1",
        "type": "function",
        "function": {"name": "get_spend", "arguments": "{}"},
        "thought_signature": "SIG==",
    }
    out = _adapter().format_messages(
        [Message(role="assistant", content=None, tool_calls=[assistant_call])]
    )
    assert out[0]["tool_calls"][0] == {
        "id": "call_1",
        "type": "function",
        "function": {"name": "get_spend", "arguments": "{}"},
    }
    assert "thought_signature" not in out[0]["tool_calls"][0]


async def test_gemini_stream_normalizes_text_toolcall_and_usage():
    sse = (
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hel"}]}}]}\n\n'
        'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n'
        'data: {"candidates":[{"content":{"parts":[{"functionCall":'
        '{"name":"get_spend","args":{"cur":"USD"}}}]}}]}\n\n'
        'data: {"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":7}}\n\n'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "test-key"
        assert "streamGenerateContent" in str(request.url)
        return httpx.Response(200, text=sse)

    events = await _collect(
        _gemini().stream(
            [Message(role="user", content="spend?")], None, client=_mock_client(handler)
        )
    )

    assert "".join(e.text for e in events if isinstance(e, TextDelta)) == "Hello"
    calls = [e for e in events if isinstance(e, ToolCall)]
    assert len(calls) == 1
    assert calls[0].name == "get_spend"
    assert json.loads(calls[0].arguments) == {"cur": "USD"}
    done = events[-1]
    assert isinstance(done, StreamDone)
    assert (done.usage.input_tokens, done.usage.output_tokens) == (11, 7)


@pytest.mark.parametrize("status", [429, 503])
async def test_gemini_stream_maps_rate_limit_status_to_reason(status: int, monkeypatch):
    # 503 retries a bounded number of times before degrading; drop the backoff so
    # the test doesn't actually sleep. 429 (quota) degrades immediately.
    monkeypatch.setattr("app.services.llm._GEMINI_STREAM_BACKOFF", 0)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"message": "RESOURCE_EXHAUSTED quota"}})

    events = await _collect(
        _gemini().stream([Message(role="user", content="hi")], None, client=_mock_client(handler))
    )
    assert len(events) == 1
    err = events[0]
    assert isinstance(err, StreamError)
    assert err.reason == "rate_limited"
    assert str(status) not in err.message
    assert "quota" not in err.message and "RESOURCE_EXHAUSTED" not in err.message


async def test_gemini_stream_retries_503_then_succeeds(monkeypatch):
    # A transient 503 overload should self-heal: retry and stream normally, so the
    # user never sees the blip.
    monkeypatch.setattr("app.services.llm._GEMINI_STREAM_BACKOFF", 0)
    calls = {"n": 0}
    sse = 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n'

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, json={"error": {"message": "overloaded"}})
        return httpx.Response(200, text=sse)

    events = await _collect(
        _gemini().stream([Message(role="user", content="hi")], None, client=_mock_client(handler))
    )
    assert calls["n"] == 2  # first attempt 503, retried once
    assert "".join(e.text for e in events if isinstance(e, TextDelta)) == "hi"
    assert isinstance(events[-1], StreamDone)


async def test_gemini_stream_generic_error_hides_provider_details():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "invalid schema: field boom"}})

    events = await _collect(
        _gemini().stream([Message(role="user", content="hi")], None, client=_mock_client(handler))
    )
    assert len(events) == 1
    assert isinstance(events[0], StreamError)
    assert events[0].reason == "llm_error"
    assert "boom" not in events[0].message and "400" not in events[0].message


async def test_gemini_complete_joins_text_parts(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "llm_model", "gemini-2.5-flash")
    monkeypatch.setattr(settings, "llm_api_key", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        assert "generateContent" in str(request.url)
        assert "streamGenerateContent" not in str(request.url)
        return httpx.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": "Netflix cost review"}]}}],
                "usageMetadata": {"promptTokenCount": 4, "candidatesTokenCount": 3},
            },
        )

    title = await generate_title("How much is Netflix?", client=_mock_client(handler))
    assert title == "Netflix cost review"


def test_get_adapter_selects_gemini_from_env(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "llm_model", "gemini-2.5-flash")
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    adapter = get_adapter()
    assert isinstance(adapter, GeminiAdapter)
    assert adapter.model == "gemini-2.5-flash"


def test_get_adapter_falls_back_to_groq_key(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "llm_api_key", "")
    monkeypatch.setattr(settings, "groq_api_key", "legacy-groq-key")

    adapter = get_adapter()
    assert adapter._api_key == "legacy-groq-key"


def test_get_adapter_rejects_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "acme-llm")
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    with pytest.raises(LLMConfigError):
        get_adapter()


def test_get_adapter_requires_a_key(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "llm_api_key", "")
    monkeypatch.setattr(settings, "groq_api_key", "")
    with pytest.raises(LLMConfigError):
        get_adapter()


async def test_stream_chat_turn_prepends_system_and_uses_env_model(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "llm_model", "env-model")
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, text="data: [DONE]\n\n")

    await _collect(
        stream_chat_turn(
            [Message(role="user", content="hi")],
            system="You are Apollon.",
            client=_mock_client(handler),
        )
    )

    body = captured["body"]
    assert body["model"] == "env-model"  # model comes from env, no code change
    assert body["messages"][0] == {"role": "system", "content": "You are Apollon."}
    assert body["messages"][1] == {"role": "user", "content": "hi"}
