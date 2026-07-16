import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import {
  conversationKeys,
  fetchMessages,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useMessages,
} from '@/hooks/useConversations';
import { ConversationSidebar } from './ConversationSidebar';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ChatStreamError, streamMessage } from './chat-stream';
import {
  isChatErrorReason,
  type ChatFailureReason,
  type ChatStreamEvent,
  type PendingTurn,
} from './types';

// The Chat tab. Orchestrates three pieces of state:
//  - `activeId`: the selected conversation, or null for a fresh chat that has
//    not been created yet (created lazily on first send).
//  - server state (conversation list + the active conversation's history) via
//    TanStack Query.
//  - `pending`: the in-flight turn (the just-sent user message + the assistant
//    reply assembled from the SSE stream). This is intentionally LOCAL state, not
//    a query — the stream is not a cache concern; it only invalidates the queries
//    when a turn completes.
export function ChatView() {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const queryClient = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);

  const conversationsQuery = useConversations(accessToken);
  const messagesQuery = useMessages(activeId ?? undefined, accessToken);
  const createConversation = useCreateConversation(accessToken);
  const deleteConversation = useDeleteConversation(accessToken);

  // Lets us cancel an in-flight stream when the user switches/creates/deletes a
  // conversation or unmounts the view.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  function selectConversation(id: string) {
    if (id === activeId) return;
    abortStream();
    setPending(null);
    setActiveId(id);
  }

  function newConversation() {
    abortStream();
    setPending(null);
    setActiveId(null);
  }

  async function handleDelete(id: string) {
    // If we're deleting the open conversation, abort its stream and reset to a
    // fresh chat so we don't keep querying a row that's about to 404.
    if (id === activeId) {
      abortStream();
      setPending(null);
      setActiveId(null);
    }
    await deleteConversation.mutateAsync(id);
  }

  // Fold one SSE frame into the pending turn.
  const applyEvent = useCallback((event: ChatStreamEvent) => {
    setPending((prev) => {
      if (!prev) return prev;
      switch (event.type) {
        case 'delta':
          return { ...prev, assistantContent: prev.assistantContent + event.text };
        case 'tool':
          // Append rather than replace: one turn may invoke several tools.
          return { ...prev, toolNames: [...prev.toolNames, event.name] };
        case 'structured':
          return { ...prev, structured: [...prev.structured, event.payload] };
        case 'error':
          // Graceful in-stream error (cap breaches and provider faults alike):
          // shown as the assistant's turn, not as a crash. We keep the backend's
          // `reason` tag and ignore its `message` — that text is English-only and
          // occasionally phrased in internal terms, so the UI supplies its own
          // localized copy. An unrecognized tag degrades to the generic case.
          return {
            ...prev,
            errorReason: isChatErrorReason(event.reason) ? event.reason : 'llm_error',
            streaming: false,
          };
        case 'done':
          return { ...prev, streaming: false };
        // `title` is handled outside pending state (it updates the sidebar).
        default:
          return prev;
      }
    });
  }, []);

  async function handleSend(text: string) {
    if (!accessToken) return;

    // Lazily create the conversation on the first message so the sidebar only
    // gets rows that actually contain a turn.
    let conversationId = activeId;
    if (conversationId === null) {
      try {
        const conv = await createConversation.mutateAsync();
        conversationId = conv.id;
        setActiveId(conv.id);
      } catch {
        setPending({
          userContent: text,
          assistantContent: '',
          structured: [],
          toolNames: [],
          errorReason: 'network',
          streaming: false,
        });
        return;
      }
    }

    setPending({
      userContent: text,
      assistantContent: '',
      structured: [],
      toolNames: [],
      errorReason: null,
      streaming: true,
    });

    const controller = new AbortController();
    abortRef.current = controller;

    let sawError = false;
    try {
      await streamMessage(
        conversationId,
        text,
        accessToken,
        {
          onEvent: (event) => {
            if (event.type === 'title') {
              // Reflect the auto-title in the sidebar immediately, without a full
              // refetch, by patching the list cache.
              queryClient.setQueryData(
                conversationKeys.list(accessToken),
                (
                  old: { items: { id: string; title: string | null }[]; total: number } | undefined,
                ) => {
                  if (!old) return old;
                  return {
                    ...old,
                    items: old.items.map((c) =>
                      c.id === conversationId ? { ...c, title: event.title } : c,
                    ),
                  };
                },
              );
            } else {
              if (event.type === 'error') sawError = true;
              applyEvent(event);
            }
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // user navigated away
      // The request failed before the stream opened, so there is no `error`
      // frame to read a reason from — derive one from the HTTP status. A 404 is
      // the conversation being gone (deleted in another tab); anything else is
      // treated as a transport fault.
      const reason: ChatFailureReason =
        err instanceof ChatStreamError && err.status === 404 ? 'not_found' : 'network';
      setPending((prev) => (prev ? { ...prev, streaming: false, errorReason: reason } : prev));
      return;
    } finally {
      abortRef.current = null;
    }

    // Clean completion: the reply is now persisted server-side, so the streamed
    // copy in `pending` has to give way to the real history. Both must land in a
    // SINGLE render — the turn exists in `pending` and in the refetched history
    // at once, so any render observing both draws it twice.
    //
    // Hence the fetch-then-commit shape rather than `invalidateQueries`:
    // invalidation writes the history into the cache itself, which renders the
    // duplicate before we ever get control back to clear `pending`. Fetching
    // outside the cache keeps that write in our hands, so the swap below is one
    // batched update and the turn never doubles.
    //
    // On an in-stream error we keep `pending` visible (its message is the
    // assistant's turn) and only refresh the list.
    if (sawError) {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.list(accessToken) });
      return;
    }

    try {
      const history = await fetchMessages(conversationId, accessToken);
      queryClient.setQueryData(conversationKeys.messages(conversationId, accessToken), history);
      setPending(null);
    } catch {
      // The reply is safely persisted; only our re-read of it failed. Fall back
      // to an invalidation and let the query layer retry, keeping `pending` on
      // screen meanwhile so the turn is never lost from view.
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.messages(conversationId, accessToken),
      });
      setPending(null);
    }

    // The sidebar only needs updated_at ordering and a new conversation's title,
    // so it refreshes in the background — the transcript must not wait on it.
    void queryClient.invalidateQueries({ queryKey: conversationKeys.list(accessToken) });
  }

  const messages = messagesQuery.data?.items ?? [];
  // History is "loading" only when we have an active conversation and no cached
  // data yet — never for a fresh chat (activeId null) or while a turn streams.
  const historyLoading = activeId !== null && messagesQuery.isLoading;

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-border">
      <ConversationSidebar
        conversations={conversationsQuery.data?.items ?? []}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={newConversation}
        onDelete={handleDelete}
        loading={conversationsQuery.isLoading}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <ChatMessages
          messages={messages}
          pending={pending}
          loading={historyLoading}
          // An example prompt from the empty state sends exactly as if typed.
          onExampleSelect={handleSend}
        />
        <ChatComposer onSend={handleSend} disabled={pending?.streaming ?? false} />
      </div>
    </div>
  );
}
