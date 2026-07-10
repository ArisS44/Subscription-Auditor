import json

import httpx
import pytest

from app.config import settings
from app.services.llm import (
    GroqAdapter,
    LLMConfigError,
    Message,
    StreamDone,
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
