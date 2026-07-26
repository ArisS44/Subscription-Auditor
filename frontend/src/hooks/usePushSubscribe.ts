import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { urlBase64ToUint8Array } from '@/features/notifications/push-support';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/** Backend echo of a stored subscription — never the crypto keys. */
export interface PushSubscribeResult {
  endpoint: string;
  user_agent: string | null;
}

/** Register the worker once and reuse it. `getRegistration()` returns an existing
 *  one across reloads, so we don't re-register on every opt-in. */
async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register('/sw.js');
}

/** Enables push for this device: registers the service worker, subscribes with
 *  the VAPID public key, and stores the subscription on the backend. The caller
 *  must have already obtained `Notification` permission via a user gesture — this
 *  runs only on grant. Re-running is safe: an existing browser subscription is
 *  reused, and the backend upserts on `(user_id, endpoint)`. */
export function usePushSubscribe(accessToken: string | undefined) {
  return useMutation<PushSubscribeResult, Error, void>({
    mutationFn: async () => {
      if (!VAPID_PUBLIC_KEY) {
        throw new Error('Missing VITE_VAPID_PUBLIC_KEY');
      }

      const registration = await ensureRegistration();
      await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      // `.toJSON()` yields exactly { endpoint, expirationTime, keys }. The backend
      // wants the endpoint, the keys, and an optional device label.
      const json = subscription.toJSON();
      const body = {
        endpoint: json.endpoint,
        keys: json.keys,
        user_agent: navigator.userAgent,
      };

      const response = await apiFetch('/push/subscribe', {
        accessToken,
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Failed to register for notifications: ${response.status}`);
      }
      return response.json() as Promise<PushSubscribeResult>;
    },
  });
}
