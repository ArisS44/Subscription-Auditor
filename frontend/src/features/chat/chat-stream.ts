import { apiFetch } from '@/lib/api';
import type { ChatStreamEvent } from './types';

// Consume the assistant reply as a Server-Sent Events stream.
//
// We deliberately use `fetch` + a ReadableStream reader rather than the native
// `EventSource`: EventSource can neither send the `Authorization: Bearer` header
// nor POST a request body, and this endpoint needs both. `apiFetch` injects the
// bearer token; we then read the response body as a byte stream and parse the
// `data: {json}\n\n` frames ourselves.

export interface StreamHandlers {
  onEvent: (event: ChatStreamEvent) => void;
}

export class ChatStreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChatStreamError';
    this.status = status;
  }
}

/**
 * POST a user message and stream the reply. Resolves when the stream ends
 * (a `done` frame or the body closing). Rejects with a `ChatStreamError` on a
 * non-2xx response (e.g. 404 for a foreign/missing conversation, checked
 * server-side before the stream opens) or `AbortError` if `signal` fires.
 */
export async function streamMessage(
  conversationId: string,
  content: string,
  accessToken: string | undefined,
  { onEvent }: StreamHandlers,
  signal?: AbortSignal,
  // Onboarding mode selects the backend's guiding system-prompt variant. It
  // changes only the assistant's framing — same endpoint, tools, and events.
  onboarding = false,
): Promise<void> {
  const response = await apiFetch(`/conversations/${conversationId}/messages`, {
    accessToken,
    method: 'POST',
    // Body must be JSON per ChatMessageRequest; Accept nudges any proxy toward
    // the event-stream content type.
    headers: { Accept: 'text/event-stream' },
    body: JSON.stringify({ content, onboarding }),
    signal,
  });

  if (!response.ok || !response.body) {
    // Ownership/validation failures arrive as a normal HTTP error before the
    // stream opens — surface the status so the caller can message it.
    throw new ChatStreamError(response.status, `Chat request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line (\n\n). Emit every complete
      // frame currently in the buffer; keep the trailing partial for next read.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        dispatchFrame(rawFrame, onEvent);
        boundary = buffer.indexOf('\n\n');
      }
    }
    // Flush any final frame that wasn't newline-terminated.
    if (buffer.trim()) dispatchFrame(buffer, onEvent);
  } finally {
    // Ensure the underlying connection is released even on early return/throw.
    reader.releaseLock();
  }
}

// Parse a single SSE frame's `data:` payload and hand the decoded event to the
// caller. A frame may in theory carry multiple `data:` lines; the backend emits
// exactly one, but we concatenate defensively per the SSE spec. Malformed JSON
// is ignored rather than aborting the whole stream.
function dispatchFrame(rawFrame: string, onEvent: (event: ChatStreamEvent) => void): void {
  const dataLines = rawFrame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart());

  if (dataLines.length === 0) return;
  const payload = dataLines.join('\n');

  let event: ChatStreamEvent;
  try {
    event = JSON.parse(payload) as ChatStreamEvent;
  } catch {
    return;
  }
  onEvent(event);
}
