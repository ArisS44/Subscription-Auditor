import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/auth/auth-context';
import { ChatView } from './ChatView';

// A completed turn lives in two places at once: the optimistic copy assembled
// from the stream, and the history refetched once the backend persisted it. If
// any single render observes both, the user sees their turn twice. These tests
// watch every DOM state across the handoff, not just the final one — the bug
// they guard against was only ever visible in between.

const REPLY = 'You spend forty two euros a month.';
const QUESTION = 'How much am I spending?';

function sse(events: Record<string, unknown>[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const historyPayload = {
  items: [
    {
      id: 'm1',
      conversation_id: 'conv-1',
      user_id: 'u1',
      role: 'user',
      content: QUESTION,
      tool_calls: null,
      tool_call_id: null,
      structured_payload: null,
      created_at: '2026-07-15T14:32:00Z',
    },
    {
      id: 'm2',
      conversation_id: 'conv-1',
      user_id: 'u1',
      role: 'assistant',
      content: REPLY,
      tool_calls: null,
      tool_call_id: null,
      structured_payload: null,
      created_at: '2026-07-15T14:32:01Z',
    },
  ],
  total: 2,
};

// Route each call the view makes during one turn.
//
// The conversation-list response is deliberately slow. The duplicate this suite
// guards against stayed on screen for exactly as long as that request took, so
// an instantly-resolving mock leaves no window to observe and the tests pass
// against the very bug they exist to catch. `holdList` takes it to the limit and
// never resolves at all — the transcript must not wait on the sidebar.
const LIST_LATENCY_MS = 50;

function mockBackend({ holdList = false }: { holdList?: boolean } = {}) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/conversations/conv-1/messages') && method === 'POST') {
      return Promise.resolve(sse([{ type: 'delta', text: REPLY }, { type: 'done' }]));
    }
    if (url.includes('/conversations/conv-1/messages')) {
      return Promise.resolve(json(historyPayload));
    }
    if (url.includes('/conversations') && method === 'POST') {
      return Promise.resolve(
        json({
          id: 'conv-1',
          user_id: 'u1',
          title: null,
          created_at: '2026-07-15T14:32:00Z',
          updated_at: '2026-07-15T14:32:00Z',
        }),
      );
    }
    if (url.includes('/conversations')) {
      if (holdList) return new Promise<Response>(() => {});
      return new Promise<Response>((resolve) =>
        setTimeout(() => resolve(json({ items: [], total: 0 })), LIST_LATENCY_MS),
      );
    }
    return Promise.resolve(json({}));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderChat() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const session = { access_token: 'token', user: { id: 'u1' } } as unknown as Session;

  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ session, loading: false }}>
        <ChatView />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

// Record how many times `text` is present in the DOM after every mutation, so a
// duplicate that exists for only one render still gets caught.
function trackMaxOccurrences(text: string): { max: () => number; stop: () => void } {
  const count = () =>
    Array.from(document.querySelectorAll('div,p,span')).filter(
      (el) => el.children.length === 0 && (el.textContent ?? '').includes(text),
    ).length;

  let max = count();
  const observer = new MutationObserver(() => {
    max = Math.max(max, count());
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  return {
    max: () => Math.max(max, count()),
    stop: () => observer.disconnect(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('completing a streamed turn', () => {
  it('never shows the reply twice while history replaces the streamed copy', async () => {
    mockBackend();
    renderChat();

    const tracker = trackMaxOccurrences(REPLY);
    await userEvent.type(screen.getByRole('textbox'), QUESTION);
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(REPLY)).toBeInTheDocument());
    // Outlast the sidebar refetch — the window the duplicate lived in.
    await new Promise((resolve) => setTimeout(resolve, LIST_LATENCY_MS * 3));
    tracker.stop();

    expect(tracker.max()).toBe(1);
  });

  it('never shows the question twice either', async () => {
    mockBackend();
    renderChat();

    const tracker = trackMaxOccurrences(QUESTION);
    await userEvent.type(screen.getByRole('textbox'), QUESTION);
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(REPLY)).toBeInTheDocument());
    // Outlast the sidebar refetch — the window the duplicate lived in.
    await new Promise((resolve) => setTimeout(resolve, LIST_LATENCY_MS * 3));
    tracker.stop();

    expect(tracker.max()).toBe(1);
  });

  it('settles the transcript without waiting on the sidebar refresh', async () => {
    // The conversation-list request never resolves here. The transcript still
    // has to reach its final single-copy state.
    mockBackend({ holdList: true });
    renderChat();

    const tracker = trackMaxOccurrences(REPLY);
    await userEvent.type(screen.getByRole('textbox'), QUESTION);
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(REPLY)).toBeInTheDocument());
    // Outlast the sidebar refetch — the window the duplicate lived in.
    await new Promise((resolve) => setTimeout(resolve, LIST_LATENCY_MS * 3));
    tracker.stop();

    expect(tracker.max()).toBe(1);
    expect(screen.getAllByText(REPLY)).toHaveLength(1);
  });
});
