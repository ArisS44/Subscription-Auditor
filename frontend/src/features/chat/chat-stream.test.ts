import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatStreamError, streamMessage } from './chat-stream';
import type { ChatStreamEvent } from './types';

// The reply must reach the user token-by-token, so what matters here is that
// events are dispatched *as the bytes arrive* — not collected and flushed at the
// end. The parser also has to survive the network splitting a frame anywhere,
// since chunk boundaries have nothing to do with frame boundaries.

// Build a Response whose body yields exactly the given chunks, in order.
function streamingResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status });
}

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function mockFetch(response: Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response)),
  );
}

async function collect(response: Response): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  mockFetch(response);
  await streamMessage('conv-1', 'hi', 'token', { onEvent: (e) => events.push(e) });
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SSE parsing', () => {
  it('emits each frame in order', async () => {
    const events = await collect(
      streamingResponse([
        frame({ type: 'delta', text: 'Hello' }),
        frame({ type: 'delta', text: ' world' }),
        frame({ type: 'done' }),
      ]),
    );

    expect(events).toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('reassembles a frame split across chunk boundaries', async () => {
    // The network can cut anywhere — mid-JSON, and even between the \n\n pair.
    const events = await collect(
      streamingResponse([
        'data: {"type":"del',
        'ta","text":"chunked"}\n',
        '\ndata: {"type":"done"}\n\n',
      ]),
    );

    expect(events).toEqual([{ type: 'delta', text: 'chunked' }, { type: 'done' }]);
  });

  it('delivers several frames arriving in a single chunk', async () => {
    const events = await collect(
      streamingResponse([
        frame({ type: 'delta', text: 'a' }) + frame({ type: 'delta', text: 'b' }),
      ]),
    );

    expect(events.map((e) => (e.type === 'delta' ? e.text : e.type))).toEqual(['a', 'b']);
  });

  it('dispatches tokens as they arrive rather than buffering to the end', async () => {
    // Hold the body open after the first token: a parser that waits for the
    // stream to close would report nothing here, and the UI would sit blank
    // until the whole reply landed.
    const encoder = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ type: 'delta', text: 'first' })));
        await gate;
        controller.enqueue(encoder.encode(frame({ type: 'done' })));
        controller.close();
      },
    });

    const events: ChatStreamEvent[] = [];
    mockFetch(new Response(body, { status: 200 }));
    const pending = streamMessage('conv-1', 'hi', 'token', { onEvent: (e) => events.push(e) });

    // Let the first chunk flush while the stream is still open.
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({ type: 'delta', text: 'first' });

    release();
    await pending;
    expect(events).toHaveLength(2);
  });

  it('carries multiple tool and structured events of one turn through in order', async () => {
    // The model may fire e.g. get_analytics then render_table in a single turn.
    const events = await collect(
      streamingResponse([
        frame({ type: 'tool', name: 'get_analytics' }),
        frame({ type: 'structured', payload: { kind: 'chart' } }),
        frame({ type: 'tool', name: 'render_table' }),
        frame({ type: 'structured', payload: { kind: 'table' } }),
        frame({ type: 'done' }),
      ]),
    );

    expect(events.map((e) => e.type)).toEqual(['tool', 'structured', 'tool', 'structured', 'done']);
  });

  it('ignores a malformed frame instead of killing the stream', async () => {
    const events = await collect(
      streamingResponse([
        'data: {not json at all}\n\n',
        frame({ type: 'delta', text: 'survived' }),
        frame({ type: 'done' }),
      ]),
    );

    expect(events).toEqual([{ type: 'delta', text: 'survived' }, { type: 'done' }]);
  });

  it('surfaces the status when the request fails before the stream opens', async () => {
    mockFetch(new Response('nope', { status: 404 }));
    await expect(
      streamMessage('conv-1', 'hi', 'token', { onEvent: () => {} }),
    ).rejects.toBeInstanceOf(ChatStreamError);
  });
});
