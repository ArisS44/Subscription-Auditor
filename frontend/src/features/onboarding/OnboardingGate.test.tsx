import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AuthContext } from '@/features/auth/auth-context';
import { OnboardingGate } from './OnboardingGate';
import { writeProgress } from './onboarding-state';

const DASHBOARD_MARK = 'Dashboard Content';
const WIZARD_MARK = 'Onboarding Wizard';

// A profile response the /me query resolves to. Only onboarding_completed varies
// per test; the rest is filler to match the Profile shape.
function profileResponse(onboarding_completed: boolean) {
  return new Response(
    JSON.stringify({
      id: 'u1',
      email: 'a@b.c',
      display_name: null,
      preferred_language: 'en',
      onboarding_completed,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function renderGate() {
  // retry: false so the failure case surfaces immediately instead of backing off.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = { access_token: 'token', user: { id: 'u1' } } as unknown as Session;
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ session, loading: false }}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route
              path="/dashboard"
              element={
                <OnboardingGate>
                  <div>{DASHBOARD_MARK}</div>
                </OnboardingGate>
              }
            />
            <Route path="/onboarding" element={<div>{WIZARD_MARK}</div>} />
          </Routes>
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

describe('OnboardingGate', () => {
  it('redirects a brand-new user into the wizard without rendering the dashboard', async () => {
    // Fresh account: onboarding unfinished, and the flow has never been entered.
    stubFetch(() => Promise.resolve(profileResponse(false)));

    renderGate();

    expect(await screen.findByText(WIZARD_MARK)).toBeInTheDocument();
    expect(screen.queryByText(DASHBOARD_MARK)).not.toBeInTheDocument();
  });

  it('renders the dashboard once onboarding is completed', async () => {
    stubFetch(() => Promise.resolve(profileResponse(true)));

    renderGate();

    expect(await screen.findByText(DASHBOARD_MARK)).toBeInTheDocument();
    expect(screen.queryByText(WIZARD_MARK)).not.toBeInTheDocument();
  });

  it('does not force a mid-flow user back into the wizard — they resume via the dashboard', async () => {
    // Unfinished server-side, but the user has entered the flow before and left.
    writeProgress({ stepIndex: 2, method: 'manual', entered: true });
    stubFetch(() => Promise.resolve(profileResponse(false)));

    renderGate();

    expect(await screen.findByText(DASHBOARD_MARK)).toBeInTheDocument();
    expect(screen.queryByText(WIZARD_MARK)).not.toBeInTheDocument();
  });

  it('surfaces an error instead of silently stranding the user when /me fails', async () => {
    stubFetch(() => Promise.resolve(new Response('nope', { status: 500 })));

    renderGate();

    expect(await screen.findByText(i18n.t('onboarding.gate.errorTitle'))).toBeInTheDocument();
    // Neither the dashboard nor the wizard: the user is not silently left un-onboarded.
    expect(screen.queryByText(DASHBOARD_MARK)).not.toBeInTheDocument();
    expect(screen.queryByText(WIZARD_MARK)).not.toBeInTheDocument();
  });

  it('shows a loading state while the profile is in flight, gating the dashboard', () => {
    // A fetch that never resolves keeps the query pending.
    stubFetch(() => new Promise<Response>(() => {}));

    renderGate();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(DASHBOARD_MARK)).not.toBeInTheDocument();
    expect(screen.queryByText(WIZARD_MARK)).not.toBeInTheDocument();
  });
});
