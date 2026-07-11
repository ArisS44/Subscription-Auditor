import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import {
  conversationKeys,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useMessages,
} from '@/hooks/useConversations';
import { ConversationSidebar } from './ConversationSidebar';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { streamMessage } from './chat-stream';
import type { ChatStreamEvent, PendingTurn } from './types';

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
  const { t } = useTranslation();
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
          return { ...prev, toolName: event.name };
        case 'structured':
          return { ...prev, structured: [...prev.structured, event.payload] };
        case 'error':
          // Graceful in-stream error (includes rate/cost-cap breaches): show its
          // message as the assistant's turn, not as a network failure.
          return { ...prev, errorMessage: event.message, streaming: false };
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
          toolName: null,
          errorMessage: t('chat.error.network'),
          streaming: false,
        });
        return;
      }
    }

    setPending({
      userContent: text,
      assistantContent: '',
      structured: [],
      toolName: null,
      errorMessage: null,
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
      setPending((prev) =>
        prev ? { ...prev, streaming: false, errorMessage: t('chat.error.network') } : prev,
      );
      return;
    } finally {
      abortRef.current = null;
    }

    // Clean completion: the reply is persisted server-side. Refetch the history
    // (and the list, for updated_at ordering + a brand-new conversation's title)
    // BEFORE clearing the optimistic pending turn, so there's no flicker or
    // duplicate. On an in-stream error we keep `pending` visible (its message is
    // the assistant's turn) and only refresh the list.
    if (sawError) {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.list(accessToken) });
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: conversationKeys.messages(conversationId, accessToken),
    });
    await queryClient.invalidateQueries({ queryKey: conversationKeys.list(accessToken) });
    setPending(null);
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
        <ChatMessages messages={messages} pending={pending} loading={historyLoading} />
        <ChatComposer onSend={handleSend} disabled={pending?.streaming ?? false} />
      </div>
    </div>
  );
}
