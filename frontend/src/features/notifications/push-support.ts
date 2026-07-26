// Environment probes for Web Push. These read `navigator`/`window` directly so
// they must only run in the browser (all callers are components/effects).

/** The APIs Web Push needs are all present. On iOS these exist only once the app
 *  is installed to the Home Screen, so a false here on iOS means "needs install",
 *  handled separately via {@link isIOS} / {@link isStandalone}. */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iOS/iPadOS detection. iPadOS 13+ reports a Mac user-agent, so it is caught by
 *  the touch-points check rather than the UA string. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
  return iOSDevice || iPadOS;
}

/** True when running as an installed / Home-Screen app rather than a browser tab.
 *  iOS Safari exposes the legacy `navigator.standalone`; everyone else uses the
 *  `display-mode: standalone` media query from the manifest. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosLegacy = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mql || iosLegacy;
}

/** Current Notification permission, or 'unsupported' where the API is absent. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** VAPID keys are base64url; `pushManager.subscribe` wants a Uint8Array backed by
 *  a plain ArrayBuffer (its `applicationServerKey` type excludes SharedArrayBuffer). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
