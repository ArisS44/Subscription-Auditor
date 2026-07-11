import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// --- Domain types -----------------------------------------------------------
// Mirror the backend response shapes (app/models/subscription.py) exactly.
// The enum unions are kept byte-for-byte identical to the backend Literals so a
// value the API can return is always assignable here. Money fields arrive as
// *strings* — Pydantic v2 serializes Decimal to a JSON string to preserve
// precision — so `price` is a string here; convert with Number(...) only at the
// point of formatting. Per-subscription values are always literal (no
// client-side math).

export type Category = 'ai_tool' | 'streaming' | 'productivity' | 'cloud_storage' | 'other';
export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type SubscriptionStatus = 'active' | 'cancelled' | 'paused';

export interface Subscription {
  id: string;
  user_id: string;
  name: string;
  category: Category | null;
  price: string;
  currency: string;
  billing_cycle: BillingCycle;
  start_date: string; // ISO date (YYYY-MM-DD)
  next_renewal_date: string | null;
  status: SubscriptionStatus;
  cancellation_date: string | null;
  notes: string | null;
  // Optional user-provided link to the provider's manage/cancel page. Display-only;
  // the backend validates it as a well-formed http(s) URL (≤2048 chars).
  manage_url: string | null;
  created_at: string; // ISO datetime
  updated_at: string;
}

export interface SubscriptionListResponse {
  items: Subscription[];
  total: number;
}

export interface SubscriptionListParams {
  status?: SubscriptionStatus;
  category?: Category;
  sort_by?: 'name' | 'price' | 'next_renewal_date' | 'created_at';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// Fields a client may supply on create. `user_id` is never sent — the backend
// takes it from the JWT. `cancellation_date` is set only via the cancel endpoint.
export interface SubscriptionCreateInput {
  name: string;
  category?: Category | null;
  // The API accepts a JSON number or a numeric string for the Decimal price.
  price: number | string;
  currency?: string;
  billing_cycle: BillingCycle;
  start_date: string;
  next_renewal_date?: string | null;
  status?: SubscriptionStatus;
  notes?: string | null;
  // Optional provider manage/cancel link. null clears it; omit to leave unchanged.
  manage_url?: string | null;
}

// Partial update: every field optional; only what changes is sent.
export type SubscriptionUpdateInput = Partial<
  SubscriptionCreateInput & { cancellation_date: string | null }
>;

// --- Query keys -------------------------------------------------------------
// All keys start with 'subscriptions' so a single prefix invalidation refreshes
// every subscription-derived query (lists, detail, and the analytics roll-up).
// The access token is folded into each key so switching accounts refetches
// rather than serving another user's cached data (same intent as useMe).
export const subscriptionKeys = {
  root: ['subscriptions'] as const,
  list: (params: SubscriptionListParams, accessToken: string | undefined) =>
    ['subscriptions', 'list', params, accessToken] as const,
  detail: (id: string | undefined, accessToken: string | undefined) =>
    ['subscriptions', 'detail', id, accessToken] as const,
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

// For endpoints that return 204 No Content (delete) — nothing to parse.
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

function buildListQuery(params: SubscriptionListParams): string {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.category) search.set('category', params.category);
  if (params.sort_by) search.set('sort_by', params.sort_by);
  if (params.order) search.set('order', params.order);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  const query = search.toString();
  return query ? `?${query}` : '';
}

// --- Queries ----------------------------------------------------------------

/** Paginated, filterable list. Re-keyed on `params` so changing a filter/sort
 *  refetches automatically. Gated on having an access token, like useMe. */
export function useSubscriptions(
  accessToken: string | undefined,
  params: SubscriptionListParams = {},
) {
  return useQuery({
    queryKey: subscriptionKeys.list(params, accessToken),
    queryFn: () =>
      requestJson<SubscriptionListResponse>(`/subscriptions${buildListQuery(params)}`, accessToken),
    enabled: Boolean(accessToken),
  });
}

/** Single subscription detail. 404 surfaces as a thrown error (isError). */
export function useSubscription(accessToken: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.detail(id, accessToken),
    queryFn: () => requestJson<Subscription>(`/subscriptions/${id}`, accessToken),
    enabled: Boolean(accessToken) && Boolean(id),
  });
}

// --- Mutations --------------------------------------------------------------
// Each mutation invalidates the whole 'subscriptions' key prefix on success, so
// the list and the analytics roll-up both refetch and the UI stays consistent
// without any manual refetch calls.

export function useCreateSubscription(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscriptionCreateInput) =>
      requestJson<Subscription>('/subscriptions', accessToken, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.root });
    },
  });
}

export function useUpdateSubscription(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SubscriptionUpdateInput }) =>
      requestJson<Subscription>(`/subscriptions/${id}`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.root });
    },
  });
}

export function useCancelSubscription(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cancellationDate }: { id: string; cancellationDate?: string }) =>
      requestJson<Subscription>(`/subscriptions/${id}/cancel`, accessToken, {
        method: 'POST',
        body: JSON.stringify(cancellationDate ? { cancellation_date: cancellationDate } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.root });
    },
  });
}

export function useDeleteSubscription(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestVoid(`/subscriptions/${id}`, accessToken, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.root });
    },
  });
}
