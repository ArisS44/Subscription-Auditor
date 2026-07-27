import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/** A registered push device as returned by GET /push/subscriptions. The
 *  encryption keys are never returned. `user_agent` is nullable free text the
 *  browser supplied at subscribe time — a display label only, never parsed. */
export interface PushDevice {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
}

const pushDeviceKeys = {
  list: (accessToken: string | undefined) => ['push-devices', accessToken] as const,
};

/** The caller's registered devices. Keyed on the token like the other user-scoped
 *  queries so switching accounts refetches. */
export function usePushDevices(accessToken: string | undefined) {
  return useQuery({
    queryKey: pushDeviceKeys.list(accessToken),
    queryFn: async (): Promise<PushDevice[]> => {
      const response = await apiFetch('/push/subscriptions', { accessToken });
      if (!response.ok) {
        throw new Error(`Failed to load devices: ${response.status}`);
      }
      return response.json() as Promise<PushDevice[]>;
    },
    enabled: Boolean(accessToken),
  });
}

/** Revoke a device by its endpoint. The endpoint is a URL, so it is URL-encoded
 *  into the path. On success the list is invalidated and refetched — revocation
 *  must be confirmed server-side, never merely hidden locally. */
export function useRevokePushDevice(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (endpoint: string): Promise<void> => {
      const response = await apiFetch(`/push/subscribe/${encodeURIComponent(endpoint)}`, {
        accessToken,
        method: 'DELETE',
      });
      // 204 on success; 404 means it was already gone — treat as success so the
      // list simply reconciles.
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to revoke device: ${response.status}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pushDeviceKeys.list(accessToken) });
    },
  });
}
