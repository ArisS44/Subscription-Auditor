import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  Conversation,
  ConversationListResponse,
  MessageListResponse,
} from '@/features/chat/types';

// Data layer for the chat sidebar and history. The conversation list and a
// conversation's message history are ordinary server state (TanStack Query),
// following the same conventions as useSubscriptions: keys fold in the access
// token so switching accounts refetches, and mutations invalidate a key prefix.
//
// The live SSE reply stream is deliberately NOT modelled here — it is local
// component state in the chat view. This hook only owns the persisted history
// and the list, which the stream invalidates when a turn completes.

// --- Query keys -------------------------------------------------------------
export const conversationKeys = {
  root: ['conversations'] as const,
  list: (accessToken: string | undefined) => ['conversations', 'list', accessToken] as const,
  messages: (conversationId: string | undefined, accessToken: string | undefined) =>
    ['conversations', 'messages', conversationId, accessToken] as const,
};

// --- Fetch helpers ----------------------------------------------------------
async function requestJson<T>(
  path: string,
  accessToken: string | undefined,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(path, { accessToken, ...init });
  if (!response.ok) {
    throw new Error(`Request to ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function requestVoid(
  path: string,
  accessToken: string | undefined,
  init?: RequestInit,
): Promise<void> {
  const response = await apiFetch(path, { accessToken, ...init });
  if (!response.ok) {
    throw new Error(`Request to ${path} failed: ${response.status}`);
  }
}

// --- Queries ----------------------------------------------------------------

/** The conversation-history sidebar list, newest-updated first (backend order).
 *  Gated on an access token, like useMe/useSubscriptions. */
export function useConversations(accessToken: string | undefined) {
  return useQuery({
    queryKey: conversationKeys.list(accessToken),
    queryFn: () => requestJson<ConversationListResponse>('/conversations?limit=100', accessToken),
    enabled: Boolean(accessToken),
  });
}

/** A conversation's persisted messages, loaded when it becomes the active
 *  conversation. `enabled` is false while no conversation is selected (a fresh,
 *  not-yet-created chat), so no request fires for a null id. */
export function useMessages(conversationId: string | undefined, accessToken: string | undefined) {
  return useQuery({
    queryKey: conversationKeys.messages(conversationId, accessToken),
    queryFn: () =>
      requestJson<MessageListResponse>(
        `/conversations/${conversationId}/messages?limit=200`,
        accessToken,
      ),
    enabled: Boolean(accessToken) && Boolean(conversationId),
  });
}

// --- Mutations --------------------------------------------------------------

/** Create an empty conversation. The first user message auto-titles it, so we
 *  send no title. Returns the created row (its id is needed to post the first
 *  message). Invalidates the list so the new conversation appears in the sidebar. */
export function useCreateConversation(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      requestJson<Conversation>('/conversations', accessToken, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.root });
    },
  });
}

/** Delete a conversation (cascades to its messages server-side). Invalidates the
 *  list so it drops out of the sidebar. */
export function useDeleteConversation(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestVoid(`/conversations/${id}`, accessToken, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.root });
    },
  });
}
