import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AuthContext } from '@/features/auth/auth-context';
import { OnboardingFlow } from './OnboardingFlow';

function mockFetch() {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ onboarding_completed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderFlow() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const session = { access_token: 'token', user: { id: 'u1' } } as unknown as Session;
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ session, loading: false }}>
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingFlow />} />
            <Route path="/dashboard" element={<div>Dashboard Home</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

describe('OnboardingFlow', () => {
  it('walks welcome → manual → stubs → done, then completes to the dashboard', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    renderFlow();

    expect(screen.getByText(i18n.t('onboarding.welcome.title'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.welcome.start') }));

    // Method step → choose manual.
    expect(screen.getByText(i18n.t('onboarding.method.title'))).toBeInTheDocument();
    await user.click(screen.getByText(i18n.t('onboarding.method.manual.title')));

    // Setup (manual) → continue.
    expect(screen.getByText(i18n.t('onboarding.manual.title'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.continue') }));

    // Extension stub → notifications stub.
    expect(screen.getByText(i18n.t('onboarding.extension.title'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.continue') }));
    expect(screen.getByText(i18n.t('onboarding.notifications.title'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.continue') }));

    // Done → finish completes and lands on the dashboard.
    expect(screen.getByText(i18n.t('onboarding.done.title'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.done.finish') }));

    expect(await screen.findByText('Dashboard Home')).toBeInTheDocument();
    const patched = fetchMock.mock.calls.some(
      (c) => String(c[0]).includes('/me') && (c[1] as RequestInit)?.method === 'PATCH',
    );
    expect(patched).toBe(true);
  });

  it('lets a user skip the whole method step to the reassurance screen', async () => {
    const user = userEvent.setup();
    mockFetch();
    renderFlow();

    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.welcome.start') }));
    await user.click(screen.getByText(i18n.t('onboarding.method.skip.title')));
    expect(screen.getByText(i18n.t('onboarding.skip.title'))).toBeInTheDocument();
  });

  it('reaches the reassurance screen when skipping after a method was already chosen', async () => {
    const user = userEvent.setup();
    mockFetch();
    // The state a user lands in by picking "chat with Apollon" and then going Back:
    // sitting on the method step with a method already recorded.
    localStorage.setItem(
      'auditor.onboarding',
      JSON.stringify({ stepIndex: 1, method: 'chat', entered: true }),
    );
    renderFlow();

    expect(screen.getByText(i18n.t('onboarding.method.title'))).toBeInTheDocument();
    await user.click(screen.getByText(i18n.t('onboarding.method.skip.title')));

    // Skipping must record 'skip' rather than merely advancing — otherwise the
    // stale 'chat' method renders the assistant here instead.
    expect(screen.getByText(i18n.t('onboarding.skip.title'))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('onboarding.manual.title'))).not.toBeInTheDocument();
  });

  it('exits to the dashboard without completing when the user closes it', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    renderFlow();

    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.exit') }));
    expect(await screen.findByText('Dashboard Home')).toBeInTheDocument();
    // Exiting must NOT mark onboarding complete — the banner should still return.
    const patched = fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'PATCH');
    expect(patched).toBe(false);
  });

  it('shows a progress rail with one marker per step', async () => {
    mockFetch();
    renderFlow();
    const rail = screen.getByRole('group', { name: /step 1 of 6/i });
    expect(rail).toBeInTheDocument();
  });

  it('offers no footer Skip control — only Back and Continue', async () => {
    const user = userEvent.setup();
    mockFetch();
    renderFlow();

    // Reach a step that renders the shared footer (the manual setup step).
    await user.click(screen.getByRole('button', { name: i18n.t('onboarding.welcome.start') }));
    await user.click(screen.getByText(i18n.t('onboarding.method.manual.title')));

    expect(screen.getByRole('button', { name: i18n.t('onboarding.continue') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('onboarding.back') })).toBeInTheDocument();
    // The old Skip button duplicated Continue's action; it must be gone, and its
    // translation key with it.
    expect(screen.queryByRole('button', { name: /^(Skip|Παράλειψη)$/ })).not.toBeInTheDocument();
  });
});
