// Shapes for the chat surface. The SSE event union mirrors the frames emitted by
// the backend chat engine (backend/app/routers/chat.py::_sse +
// services/chat.py) — kept in lockstep with that source. Each `data: {json}\n\n`
// frame decodes to one of these, discriminated by `type`.

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'structured'; payload: Record<string, unknown> }
  | { type: 'title'; title: string }
  | { type: 'error'; reason: string; message: string }
  | { type: 'done' };

// The `reason` tags the backend can attach to an `error` frame. Three come from
// the usage caps (services/usage.py), two from the provider stream
// (services/llm.py), one from the router's ownership check (routers/chat.py).
// `reason` stays a plain `string` on the wire: an unrecognized tag from a newer
// backend must degrade to generic copy, never crash the turn.
export const CHAT_ERROR_REASONS = [
  'rate', // sending too quickly — retriable
  'user_daily', // today's per-user message cap
  'global_daily', // app-wide daily cap — transient
  'rate_limited', // provider capacity/rate limit — transient, retriable
  'llm_error', // provider request failed outright
  'not_found', // conversation missing/not visible
] as const;

export type ChatErrorReason = (typeof CHAT_ERROR_REASONS)[number];

// A locally-generated reason for faults that never reach the SSE layer (the
// request itself failed). Kept in the same space so the UI has one error path.
export type ChatFailureReason = ChatErrorReason | 'network';

export function isChatErrorReason(value: string): value is ChatErrorReason {
  return (CHAT_ERROR_REASONS as readonly string[]).includes(value);
}

// A persisted message as returned by GET /conversations/{id}/messages, mirroring
// backend MessageResponse. Only the roles/fields the UI renders are typed
// loosely here; tool/system rows exist in history but are not shown as bubbles.
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface StoredMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string | null;
  tool_calls: Record<string, unknown>[] | null;
  tool_call_id: string | null;
  structured_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface MessageListResponse {
  items: StoredMessage[];
  total: number;
}

// A conversation row, mirroring backend ConversationResponse.
export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationListResponse {
  items: Conversation[];
  total: number;
}

// The live, in-flight turn held as local component state (never in the query
// cache — the stream is not a TanStack Query concern). It captures the user's
// just-sent text and the assistant reply being assembled from `delta` frames,
// plus any `structured` payloads and the active tool indicator. Task 2.2 renders
// the collected `structured` payloads through typed components; this task only
// captures and attaches them.
export interface PendingTurn {
  userContent: string;
  assistantContent: string;
  structured: Record<string, unknown>[];
  // Every tool the model invoked this turn, in arrival order. A turn may fire
  // several (e.g. get_analytics then render_table), so this is a list, not a
  // single slot — the last entry is the one currently running.
  toolNames: string[];
  // A graceful failure for this turn, held as the backend's machine tag rather
  // than a display string: the copy is looked up at render time so it follows
  // the active language (and so an unknown tag can fall back cleanly). When set,
  // it is shown as the assistant's response — not treated as a crash.
  errorReason: ChatFailureReason | null;
  streaming: boolean;
}
