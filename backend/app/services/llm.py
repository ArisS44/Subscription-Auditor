"""Provider-agnostic LLM layer — the single place any model provider is touched.

Everything else in the backend (the chat router, the tool loop, title
generation) talks to this module through provider-neutral types and never sees a
provider SDK, a model id, or a provider-specific SSE shape. Swapping Groq for
another provider (e.g. Claude Haiku 4.5) is a config change plus one new adapter
class, not a change anywhere in the callers.

The adapter isolates exactly the three things that differ between providers:
  (a) the tool-definition envelope (OpenAI wraps a JSON Schema in
      `function.parameters`; others use `input_schema`) — see `format_tools`;
  (b) how a tool result re-enters history (OpenAI uses a `role:"tool"` message
      keyed by `tool_call_id`; others use a result block) — see `format_messages`;
  (c) normalising the provider's raw stream into one internal event stream —
      see `stream`.
"""

import json
import logging
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger("app.services.llm")


# ---------------------------------------------------------------------------
# Provider-neutral interface types. Callers build these; adapters translate them
# into whatever the configured provider expects.
# ---------------------------------------------------------------------------
@dataclass
class ToolDef:
    """A tool the model may call, in the internal format. `parameters` is a plain
    JSON Schema object; the adapter wraps it in the provider's envelope."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class Message:
    """One turn of history in the internal format — mirrors the columns of the
    `messages` table. `tool_calls` is set on an assistant turn that requested
    tools; `tool_call_id` is set on a `role="tool"` result turn."""

    role: str  # user | assistant | tool | system
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None


# --- The single internal event stream a chat turn yields -------------------
@dataclass
class TextDelta:
    """An incremental chunk of assistant text, emitted live for SSE relay."""

    text: str


@dataclass
class ToolCall:
    """A fully-assembled tool call the model wants executed. `arguments` is the
    raw JSON string as produced by the model — the caller validates it against
    the tool's Pydantic schema before executing anything."""

    id: str
    name: str
    arguments: str


@dataclass
class Usage:
    input_tokens: int
    output_tokens: int


@dataclass
class StreamDone:
    """Terminal success event; carries token usage when the provider reports it."""

    usage: Usage | None = None


@dataclass
class StreamError:
    """Terminal error event — the stream yields this and stops rather than
    raising mid-iteration, so callers handle provider failures uniformly.

    `reason` is a stable, provider-neutral machine tag (e.g. "rate_limited")
    the chat layer maps to user-facing copy; `message` is a safe fallback that
    never leaks provider internals or request/response content."""

    message: str
    reason: str = "llm_error"


LLMEvent = TextDelta | ToolCall | StreamDone | StreamError


class LLMConfigError(RuntimeError):
    """Raised when the configured provider is unknown or no API key is set."""


# ---------------------------------------------------------------------------
# Adapter interface + Groq (OpenAI-style) implementation.
# ---------------------------------------------------------------------------
class LLMAdapter(ABC):
    def __init__(self, *, model: str, api_key: str, base_url: str | None) -> None:
        self.model = model
        self._api_key = api_key
        self._base_url = (base_url or self.default_base_url).rstrip("/")

    #: Provider's standard API base; overridable via LLM_BASE_URL config.
    default_base_url: str = ""

    @abstractmethod
    def format_tools(self, tools: Sequence[ToolDef]) -> list[dict[str, Any]] | None:
        """(a) Translate internal tool defs into the provider's envelope."""

    @abstractmethod
    def format_messages(self, messages: Sequence[Message]) -> list[dict[str, Any]]:
        """(b) Translate internal history — including tool results — into the
        provider's message shape."""

    @abstractmethod
    async def stream(
        self,
        messages: Sequence[Message],
        tools: Sequence[ToolDef] | None,
        *,
        client: httpx.AsyncClient,
        max_tokens: int | None = None,
    ) -> AsyncIterator[LLMEvent]:
        """(c) Stream one chat turn, yielding the normalised internal events."""

    @abstractmethod
    async def complete(
        self,
        messages: Sequence[Message],
        *,
        client: httpx.AsyncClient,
        max_tokens: int | None = None,
    ) -> tuple[str, Usage | None]:
        """One-shot, non-streaming completion → (text, usage)."""


class GroqAdapter(LLMAdapter):
    """Groq via its OpenAI-compatible Chat Completions API. Implemented over
    httpx (not the provider SDK) so the three translations above stay explicit
    and testable, and so the internal abstraction isn't coupled to any SDK's
    types."""

    default_base_url = "https://api.groq.com/openai/v1"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def format_tools(self, tools: Sequence[ToolDef]) -> list[dict[str, Any]] | None:
        # OpenAI-style envelope: the JSON Schema goes under function.parameters.
        # (An Anthropic adapter would instead emit {"name", "description",
        # "input_schema": parameters}.)
        if not tools:
            return None
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in tools
        ]

    def format_messages(self, messages: Sequence[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "tool":
                # A tool result re-enters as a role="tool" message keyed by the
                # id of the call it answers. (An Anthropic adapter would nest a
                # tool_result content block under a user turn instead.)
                out.append(
                    {"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content or ""}
                )
                continue
            msg: dict[str, Any] = {"role": m.role, "content": m.content}
            if m.tool_calls:
                msg["tool_calls"] = m.tool_calls
            out.append(msg)
        return out

    def _payload(
        self,
        messages: Sequence[Message],
        tools: Sequence[ToolDef] | None,
        *,
        stream: bool,
        max_tokens: int | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": self.format_messages(messages),
            "stream": stream,
        }
        formatted = self.format_tools(tools) if tools else None
        if formatted:
            payload["tools"] = formatted
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if stream:
            # Ask the provider to include token usage in the final stream chunk.
            payload["stream_options"] = {"include_usage": True}
        return payload

    async def stream(
        self,
        messages: Sequence[Message],
        tools: Sequence[ToolDef] | None,
        *,
        client: httpx.AsyncClient,
        max_tokens: int | None = None,
    ) -> AsyncIterator[LLMEvent]:
        url = f"{self._base_url}/chat/completions"
        payload = self._payload(messages, tools, stream=True, max_tokens=max_tokens)
        # Accumulate streamed tool-call fragments by index; the provider sends the
        # id/name first and the JSON arguments across subsequent chunks.
        pending: dict[int, dict[str, str]] = {}
        usage: Usage | None = None
        try:
            async with client.stream("POST", url, headers=self._headers(), json=payload) as resp:
                if resp.status_code != 200:
                    # Drain the body so the connection can be reused; never log or
                    # surface it (it can echo request content). Groq maps a
                    # token-rate-limit breach (per-minute/per-day budget) to 413
                    # "Request too large" and 429 — distinct from a genuine
                    # oversize payload, but both mean "back off and retry later",
                    # so the caller degrades gracefully instead of showing a raw
                    # HTTP status.
                    await resp.aread()
                    if resp.status_code in (429, 413):
                        yield StreamError(
                            "The assistant is busy right now. Please try again in a moment.",
                            reason="rate_limited",
                        )
                    else:
                        yield StreamError("The assistant is temporarily unavailable.")
                    logger.warning(
                        "llm stream non-200 provider=%s model=%s status=%d",
                        settings.llm_provider,
                        self.model,
                        resp.status_code,
                    )
                    return
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    if chunk.get("usage"):
                        usage = _parse_usage(chunk["usage"])
                    for choice in chunk.get("choices", []):
                        delta = choice.get("delta") or {}
                        text = delta.get("content")
                        if text:
                            yield TextDelta(text)
                        for tc in delta.get("tool_calls") or []:
                            _accumulate_tool_call(pending, tc)
        except httpx.HTTPError as exc:
            # Never log the request/response bodies (they carry message content);
            # the exception type/string is safe.
            logger.warning(
                "llm stream transport error provider=%s: %s", self.model, type(exc).__name__
            )
            yield StreamError("LLM provider request failed")
            return

        for tc in pending.values():
            yield ToolCall(id=tc["id"], name=tc["name"], arguments=tc["arguments"])
        _log_usage("stream", self.model, usage)
        yield StreamDone(usage=usage)

    async def complete(
        self,
        messages: Sequence[Message],
        *,
        client: httpx.AsyncClient,
        max_tokens: int | None = None,
    ) -> tuple[str, Usage | None]:
        url = f"{self._base_url}/chat/completions"
        payload = self._payload(messages, None, stream=False, max_tokens=max_tokens)
        resp = await client.post(url, headers=self._headers(), json=payload)
        resp.raise_for_status()
        body = resp.json()
        text = (body.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        usage = _parse_usage(body.get("usage")) if body.get("usage") else None
        _log_usage("complete", self.model, usage)
        return text, usage


class GeminiAdapter(LLMAdapter):
    """Google Gemini via the Generative Language REST API (over httpx, like Groq,
    so the three translations stay explicit and SDK-free).

    Gemini differs from the OpenAI shape in ways this adapter absorbs so no caller
    changes: there is no `system` role (the system prompt goes in a top-level
    `system_instruction`); the assistant role is `model`; a tool result re-enters
    as a `functionResponse` part inside a `user` turn (matched to its call by
    *name*, since Gemini function calls carry no id); and the stream delivers each
    tool call whole in one `functionCall` part rather than as fragments. The
    provider-strict tool schema is produced upstream by `tools.tool_definitions`
    ("gemini") — this adapter only wraps it in the `function_declarations`
    envelope."""

    default_base_url = "https://generativelanguage.googleapis.com/v1beta"

    def _headers(self) -> dict[str, str]:
        # API key travels as a header, never in the URL/query — so it can't land
        # in access logs or error traces the way a `?key=` param would.
        return {"x-goog-api-key": self._api_key, "Content-Type": "application/json"}

    def format_tools(self, tools: Sequence[ToolDef]) -> list[dict[str, Any]] | None:
        if not tools:
            return None
        decls: list[dict[str, Any]] = []
        for t in tools:
            decl: dict[str, Any] = {"name": t.name, "description": t.description}
            # Omit `parameters` entirely for a no-arg tool: an empty properties
            # object trips some Gemini schema validations.
            if t.parameters.get("properties"):
                decl["parameters"] = t.parameters
            decls.append(decl)
        return [{"function_declarations": decls}]

    @staticmethod
    def _system_instruction(messages: Sequence[Message]) -> dict[str, Any] | None:
        texts = [m.content for m in messages if m.role == "system" and m.content]
        if not texts:
            return None
        return {"parts": [{"text": "\n\n".join(texts)}]}

    def format_messages(self, messages: Sequence[Message]) -> list[dict[str, Any]]:
        # Walk in order, mapping each assistant tool-call id -> its tool name, so a
        # later role="tool" result (which carries only the id) can be re-emitted as
        # a Gemini functionResponse keyed by name.
        id_to_name: dict[str, str] = {}
        contents: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "system":
                continue
            if m.role == "tool":
                name = id_to_name.get(m.tool_call_id or "", "tool")
                contents.append(
                    {
                        "role": "user",
                        "parts": [
                            {"functionResponse": {"name": name, "response": _as_object(m.content)}}
                        ],
                    }
                )
                continue
            if m.role == "assistant":
                parts: list[dict[str, Any]] = []
                if m.content:
                    parts.append({"text": m.content})
                for tc in m.tool_calls or []:
                    fn = tc.get("function", {})
                    fn_name = fn.get("name", "")
                    if tc.get("id"):
                        id_to_name[tc["id"]] = fn_name
                    parts.append(
                        {
                            "functionCall": {
                                "name": fn_name,
                                "args": _loads_or_empty(fn.get("arguments")),
                            }
                        }
                    )
                contents.append({"role": "model", "parts": parts or [{"text": ""}]})
                continue
            # user
            contents.append({"role": "user", "parts": [{"text": m.content or ""}]})
        return contents

    def _payload(
        self,
        messages: Sequence[Message],
        tools: Sequence[ToolDef] | None,
        *,
        max_tokens: int | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"contents": self.format_messages(messages)}
        system = self._system_instruction(messages)
        if system is not None:
            payload["system_instruction"] = system
        formatted = self.format_tools(tools) if tools else None
        if formatted:
            payload["tools"] = formatted
        if max_tokens is not None:
            payload["generationConfig"] = {"maxOutputTokens": max_tokens}
        return payload

    async def stream(
        self,
        messages: Sequence[Message],
        tools: Sequence[ToolDef] | None,
        *,
        client: httpx.AsyncClient,
        max_tokens: int | None = None,
    ) -> AsyncIterator[LLMEvent]:
        url = f"{self._base_url}/models/{self.model}:streamGenerateContent?alt=sse"
        payload = self._payload(messages, tools, max_tokens=max_tokens)
        tool_calls: list[ToolCall] = []
        usage: Usage | None = None
        try:
            async with client.stream("POST", url, headers=self._headers(), json=payload) as resp:
                if resp.status_code != 200:
                    # Drain (connection reuse) and never surface the body — it can
                    # echo request content. RESOURCE_EXHAUSTED (429) and transient
                    # 503 both mean "back off", so degrade as retriable rather than
                    # showing a raw status.
                    await resp.aread()
                    if resp.status_code in (429, 503):
                        yield StreamError(
                            "The assistant is busy right now. Please try again in a moment.",
                            reason="rate_limited",
                        )
                    else:
                        yield StreamError("The assistant is temporarily unavailable.")
                    logger.warning(
                        "llm stream non-200 provider=%s model=%s status=%d",
                        settings.llm_provider,
                        self.model,
                        resp.status_code,
                    )
                    return
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if not data:
                        continue
                    chunk = json.loads(data)
                    if chunk.get("usageMetadata"):
                        usage = _parse_gemini_usage(chunk["usageMetadata"])
                    for cand in chunk.get("candidates", []):
                        for part in (cand.get("content") or {}).get("parts", []):
                            text = part.get("text")
                            if text:
                                yield TextDelta(text)
                            fc = part.get("functionCall")
                            if fc:
                                tool_calls.append(
                                    ToolCall(
                                        id=f"call_{len(tool_calls)}",
                                        name=fc.get("name", ""),
                                        arguments=json.dumps(fc.get("args") or {}),
                                    )
                                )
        except httpx.HTTPError as exc:
            logger.warning(
                "llm stream transport error provider=%s: %s", self.model, type(exc).__name__
            )
            yield StreamError("LLM provider request failed")
            return

        for tc in tool_calls:
            yield tc
        _log_usage("stream", self.model, usage)
        yield StreamDone(usage=usage)

    async def complete(
        self,
        messages: Sequence[Message],
        *,
        client: httpx.AsyncClient,
        max_tokens: int | None = None,
    ) -> tuple[str, Usage | None]:
        url = f"{self._base_url}/models/{self.model}:generateContent"
        payload = self._payload(messages, None, max_tokens=max_tokens)
        resp = await client.post(url, headers=self._headers(), json=payload)
        resp.raise_for_status()
        body = resp.json()
        candidates = body.get("candidates") or [{}]
        parts = (candidates[0].get("content") or {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts)
        usage = _parse_gemini_usage(body["usageMetadata"]) if body.get("usageMetadata") else None
        _log_usage("complete", self.model, usage)
        return text, usage


def _as_object(content: str | None) -> dict[str, Any]:
    """A Gemini functionResponse.response must be a JSON object. Our tool results
    are JSON strings of a dict; parse, wrapping any non-object in `{"result": ...}`."""
    if not content:
        return {}
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return {"result": content}
    return parsed if isinstance(parsed, dict) else {"result": parsed}


def _loads_or_empty(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_gemini_usage(raw: dict[str, Any]) -> Usage:
    return Usage(
        input_tokens=int(raw.get("promptTokenCount", 0)),
        output_tokens=int(raw.get("candidatesTokenCount", 0)),
    )


def _accumulate_tool_call(pending: dict[int, dict[str, str]], tc: dict[str, Any]) -> None:
    """Merge one streamed tool-call fragment into the accumulator keyed by index."""
    idx = tc.get("index", 0)
    slot = pending.setdefault(idx, {"id": "", "name": "", "arguments": ""})
    if tc.get("id"):
        slot["id"] = tc["id"]
    fn = tc.get("function") or {}
    if fn.get("name"):
        slot["name"] = fn["name"]
    if fn.get("arguments"):
        slot["arguments"] += fn["arguments"]


def _parse_usage(raw: dict[str, Any]) -> Usage:
    return Usage(
        input_tokens=int(raw.get("prompt_tokens", 0)),
        output_tokens=int(raw.get("completion_tokens", 0)),
    )


def _log_usage(kind: str, model: str, usage: Usage | None) -> None:
    """Observability only: token counts, provider, model. Never message content."""
    if usage is None:
        return
    logger.info(
        "llm_usage kind=%s provider=%s model=%s input_tokens=%d output_tokens=%d",
        kind,
        settings.llm_provider,
        model,
        usage.input_tokens,
        usage.output_tokens,
    )


# ---------------------------------------------------------------------------
# Registry + public API. Callers use only these; the adapter/provider is chosen
# from config at call time, so changing LLM_PROVIDER/LLM_MODEL needs no code edit.
# ---------------------------------------------------------------------------
_ADAPTERS: dict[str, type[LLMAdapter]] = {"groq": GroqAdapter, "gemini": GeminiAdapter}

# Prompt for the one-shot title completion. Short, neutral, language-agnostic.
_TITLE_SYSTEM_PROMPT = (
    "Generate a very short title (3-6 words, no quotes, no trailing punctuation) "
    "summarising the user's message. Reply with the title only, in the same "
    "language as the message."
)
_TITLE_MAX_TOKENS = 20

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Lazily create a shared async client (connection reuse). Tests inject their
    own client, so this is only hit in real runs."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def get_adapter() -> LLMAdapter:
    """Build the adapter for the currently-configured provider. Reads settings at
    call time so provider/model/key are entirely environment-driven."""
    provider = settings.llm_provider.lower()
    adapter_cls = _ADAPTERS.get(provider)
    if adapter_cls is None:
        raise LLMConfigError(f"Unsupported LLM_PROVIDER: {settings.llm_provider!r}")
    if not settings.effective_llm_api_key:
        raise LLMConfigError("No LLM API key configured")
    return adapter_cls(
        model=settings.llm_model,
        api_key=settings.effective_llm_api_key,
        base_url=settings.llm_base_url or None,
    )


async def stream_chat_turn(
    messages: Sequence[Message],
    tools: Sequence[ToolDef] | None = None,
    *,
    system: str | None = None,
    max_tokens: int | None = None,
    client: httpx.AsyncClient | None = None,
) -> AsyncIterator[LLMEvent]:
    """Stream one assistant turn over `messages`, optionally with `tools` and a
    `system` prompt, yielding the normalised internal event stream."""
    adapter = get_adapter()
    history = list(messages)
    if system is not None:
        history = [Message(role="system", content=system), *history]
    conn = client or _get_client()
    async for event in adapter.stream(history, tools, client=conn, max_tokens=max_tokens):
        yield event


async def generate_title(
    first_user_message: str, *, client: httpx.AsyncClient | None = None
) -> str:
    """One-shot: derive a short conversation title from the first user message."""
    adapter = get_adapter()
    messages = [
        Message(role="system", content=_TITLE_SYSTEM_PROMPT),
        Message(role="user", content=first_user_message),
    ]
    conn = client or _get_client()
    text, _usage = await adapter.complete(messages, client=conn, max_tokens=_TITLE_MAX_TOKENS)
    return text.strip().strip('"').strip()
