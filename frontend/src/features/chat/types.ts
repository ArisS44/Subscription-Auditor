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
  toolName: string | null;
  // A graceful in-stream error (rate/cost caps included). When set, it is shown
  // as the assistant's response for this turn — not treated as a network fault.
  errorMessage: string | null;
  streaming: boolean;
}
