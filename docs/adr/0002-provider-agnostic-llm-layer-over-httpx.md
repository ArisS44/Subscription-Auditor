# ADR 0002: Provider-agnostic LLM layer implemented over httpx, not a vendor SDK

## Status
Accepted

## Context
The app is AI-native: a bilingual chatbot is the primary interface, and later tasks add a
tool-calling loop, streamed responses, and monthly insights. The engineering standards require that
**all** model access route through one place (`backend/app/services/llm.py`), that provider/model/key
come from environment only, and that adding a capability means registering a tool — never growing a
hardcoded switch. The near-term provider is Groq (Llama 3.3 70B), but Claude Haiku 4.5 is a named
future swap target, so the design must make switching providers a config change plus one adapter,
not a change in any caller.

The obvious implementation is to depend on the `groq` Python SDK (OpenAI-compatible). The task also
noted three concrete things that differ between providers and must be hidden from callers: (a) the
tool-definition envelope (`function.parameters` vs `input_schema`), (b) how a tool result re-enters
history (`role:"tool"` + `tool_call_id` vs a result content block), and (c) the raw streaming/SSE
shape.

## Decision
Build the wrapper over `httpx` (already a dependency) against Groq's OpenAI-compatible REST API,
behind an abstract `LLMAdapter`. The module exposes only provider-neutral types — an internal
`ToolDef`, a `Message` history shape mirroring the `messages` table, and a single event stream
(`TextDelta` / `ToolCall` / `StreamDone` / `StreamError`). `GroqAdapter` implements the three
translations explicitly (`format_tools`, `format_messages`, and stream normalization). A small
registry (`_ADAPTERS = {"groq": GroqAdapter}`) plus `get_adapter()` selects the adapter from
`settings.llm_provider`; `LLM_MODEL`, the key (`LLM_API_KEY` falling back to `GROQ_API_KEY`), and an
optional `LLM_BASE_URL` are all read at call time.

## Consequences
- The three provider differences are visible, commented, and unit-testable in our own code rather
  than hidden inside an SDK — the adapter tests assert the exact tool-def envelope, the tool-result
  message shape, and the normalized event stream, using `httpx.MockTransport` (no network).
- The internal abstraction is not coupled to any SDK's request/response types, so an
  `AnthropicAdapter` slots in as a new `LLMAdapter` subclass (different envelope, tool-result block,
  and SSE parsing) with zero changes in the chat router, tool loop, or frontend.
- We own the streaming parse (SSE `data:` lines, `[DONE]`, `stream_options.include_usage` for token
  counts) and the incremental-tool-call assembly. That is a little more code than calling an SDK
  helper, but it is the code we most need to control and test.
- Trade-off: if Groq introduces non-OpenAI-compatible behavior, we adjust `GroqAdapter` directly
  rather than waiting on an SDK update — acceptable, and arguably an advantage.
- Token usage is logged (counts only, never message content, per the privacy rule); the DB-backed
  `llm_usage` counters (per-user + app-wide daily) are wired up by a later task.
