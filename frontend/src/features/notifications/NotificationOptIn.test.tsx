import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AuthContext } from '@/features/auth/auth-context';
import { NotificationOptIn } from './NotificationOptIn';

function renderOptIn() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = { access_token: 'token', user: { id: 'u1' } } as unknown as Session;
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ session, loading: false }}>
        <NotificationOptIn />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Make the environment look like a granted, already-subscribed device. */
function stubSubscribedDevice(endpoint: string) {
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
  Object.defineProperty(window, 'PushManager', {
    value: function PushManager() {},
    configurable: true,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: () => Promise.resolve({ endpoint }) },
      }),
      getRegistration: vi.fn(),
      register: vi.fn(),
    },
    configurable: true,
  });
}

const realUserAgent = navigator.userAgent;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  setUserAgent(realUserAgent);
  vi.unstubAllGlobals();
  // Remove any push APIs a test defined so the support-detection tests stay accurate.
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'PushManager');
});

describe('NotificationOptIn', () => {
  it('shows an unsupported notice where the push APIs are absent (jsdom default)', () => {
    // jsdom exposes no Notification/PushManager/serviceWorker, so support is false
    // and the component must render an explanatory state — never a dead button.
    renderOptIn();
    expect(screen.getByText(i18n.t('notifications.optIn.unsupported'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('notifications.optIn.enable') }),
    ).not.toBeInTheDocument();
  });

  it('tells an iOS-Safari visitor to install to the Home Screen first', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    renderOptIn();
    expect(screen.getByText(i18n.t('notifications.optIn.ios.title'))).toBeInTheDocument();
  });

  it('shows the "on" state (not the button) when this device is already registered', async () => {
    // The regression: enablement must be derived from the actual subscription +
    // backend device list, not a this-session mutation flag — so it survives a
    // reload where no mutation has run.
    const endpoint = 'https://push.example/dev';
    stubSubscribedDevice(endpoint);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          { id: 'd1', endpoint, user_agent: 'This device', created_at: '2026-07-01T00:00:00Z' },
        ]),
      ),
    );

    renderOptIn();

    expect(await screen.findByText(i18n.t('notifications.optIn.enabled'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('notifications.optIn.enable') }),
    ).not.toBeInTheDocument();
  });
});
