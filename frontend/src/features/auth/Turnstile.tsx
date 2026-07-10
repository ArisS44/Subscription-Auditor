import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Cloudflare's public *test* site key — always passes, no real challenge. Used
// as the dev default so local auth works with zero configuration; production
// supplies a real key via VITE_TURNSTILE_SITE_KEY.
const TEST_SITE_KEY = '1x00000000000000000000AA';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

function turnstileSiteKey(): string {
  return import.meta.env.VITE_TURNSTILE_SITE_KEY || TEST_SITE_KEY;
}

// Minimal shape of the global the Cloudflare script installs. Declared locally
// rather than pulling in a types package — we only touch these four methods.
interface TurnstileApi {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      theme?: 'auto' | 'light' | 'dark';
      language?: string;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Load the Cloudflare script exactly once across the app, even if several forms
// mount a widget. The promise is cached module-side so concurrent callers share
// one network request and resolve when `window.turnstile` is ready.
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a later retry
      reject(new Error('Failed to load Turnstile script'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  /** Reset the widget so the user can solve a fresh challenge (e.g. after a
   *  failed submit or an expired token). */
  reset: () => void;
}

interface TurnstileProps {
  /** Fires with the challenge token once solved. */
  onVerify: (token: string) => void;
  /** Fires when a solved token expires (normal, ~5 min TTL) — clear the held
   *  token; the widget re-challenges on its own. */
  onExpire?: () => void;
  /** Fires on a hard failure (script/challenge error) — clear the token and
   *  surface a message, since the widget may not recover on its own. */
  onError?: () => void;
  /** BCP-47 language for the widget UI (e.g. 'en', 'el'). */
  language?: string;
  className?: string;
}

/** Renders a Cloudflare Turnstile widget. Consumes the auth forms' need for a
 *  CAPTCHA token: the widget solves a challenge and hands the token to
 *  `onVerify`; the parent blocks submission until it has one and passes it as
 *  the `captchaToken` option on the Supabase Auth call. */
export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { onVerify, onExpire, onError, language, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep the latest callbacks in refs so the render effect can stay mount-only
  // (rendering the widget twice would stack duplicate challenges).
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);
  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;
  onErrorRef.current = onError;

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
  }));

  useEffect(() => {
    let cancelled = false;

    void loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      // Guard against a double-mount (React 18/19 StrictMode) rendering twice.
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: turnstileSiteKey(),
        theme: 'auto',
        language,
        callback: (token) => onVerifyRef.current(token),
        'expired-callback': () => onExpireRef.current?.(),
        'error-callback': () => onErrorRef.current?.(),
      });
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
    // Mount-only: the widget is rendered imperatively and cleaned up on unmount.
    // `language` intentionally excluded — locale is fixed for a form's lifetime
    // and re-rendering the widget mid-challenge would be worse than a stale label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className={className} />;
});
