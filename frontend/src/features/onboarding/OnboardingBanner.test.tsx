import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AuthContext } from '@/features/auth/auth-context';
import { OnboardingBanner } from './OnboardingBanner';
import { dismissBannerForSession } from './onboarding-state';

function mockProfile(onboarding_completed: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'u1',
            email: 'a@b.c',
            display_name: null,
            preferred_language: 'en',
            onboarding_completed,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ),
  );
}

function renderBanner() {
  const client = new QueryClient();
  const session = { access_token: 'token', user: { id: 'u1' } } as unknown as Session;
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ session, loading: false }}>
        <MemoryRouter>
          <OnboardingBanner />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('OnboardingBanner', () => {
  it('shows while onboarding is unfinished', async () => {
    mockProfile(false);
    renderBanner();
    expect(await screen.findByText(i18n.t('onboarding.banner.text'))).toBeInTheDocument();
  });

  it('renders nothing once onboarding is completed', async () => {
    mockProfile(true);
    const { container } = renderBanner();
    // Give the profile query a tick; the banner must stay absent.
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden when dismissed this session', async () => {
    dismissBannerForSession();
    mockProfile(false);
    const { container } = renderBanner();
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });
});
