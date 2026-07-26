import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { AuthContext } from '@/features/auth/auth-context';
import { NotificationOptIn } from './NotificationOptIn';

function renderOptIn() {
  const client = new QueryClient();
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

const realUserAgent = navigator.userAgent;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  setUserAgent(realUserAgent);
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
});
