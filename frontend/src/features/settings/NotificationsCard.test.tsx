import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AuthContext } from '@/features/auth/auth-context';
import { NotificationsCard } from './NotificationsCard';

interface Call {
  url: string;
  method: string;
  body?: string;
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ENDPOINT = 'https://push.example/abc';

// A router-style fetch mock over /me, /push/subscriptions, and the DELETE, with
// mutable state so a PATCH updates the profile and a revoke empties the list.
function makeFetch() {
  const calls: Call[] = [];
  let devices = [
    {
      id: 'd1',
      endpoint: ENDPOINT,
      user_agent: 'Chrome on Mac',
      created_at: '2026-07-01T10:00:00Z',
    },
  ];
  const profile = {
    id: 'u1',
    email: 'a@b.c',
    display_name: null,
    preferred_language: 'en',
    onboarding_completed: true,
    renewal_lead_days: 3,
    monthly_review_enabled: false,
  };
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url: u, method, body: init?.body as string | undefined });
    if (u.includes('/push/subscriptions') && method === 'GET') return jsonResponse(devices);
    // Matches the query-param form (`/push/subscribe?endpoint=…`); the endpoint
    // must not be nested in the path — see useRevokePushDevice for why.
    if (u.includes('/push/subscribe?endpoint=') && method === 'DELETE') {
      devices = [];
      return new Response(null, { status: 204 });
    }
    if (u.includes('/me') && method === 'PATCH') {
      Object.assign(profile, JSON.parse(init!.body as string));
      return jsonResponse(profile);
    }
    if (u.includes('/me')) return jsonResponse(profile);
    return jsonResponse({});
  });
  return { fetchMock: fetchMock as unknown as typeof fetch, calls };
}

function renderCard(fetchMock: typeof fetch) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const session = { access_token: 'token', user: { id: 'u1' } } as unknown as Session;
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ session, loading: false }}>
        <NotificationsCard />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationsCard', () => {
  it('persists the per-user lead time via PATCH /me', async () => {
    const { fetchMock, calls } = makeFetch();
    renderCard(fetchMock);

    // Profile loaded: the stored value (3) is the active chip.
    const three = await screen.findByRole('button', { name: '3' });
    expect(three).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '7' }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes('/me') && c.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(patch!.body as string).renewal_lead_days).toBe(7);
    });
  });

  it('revokes a device server-side and re-fetches so it disappears', async () => {
    const { fetchMock, calls } = makeFetch();
    renderCard(fetchMock);

    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.notifications.deviceRevoke') }),
    );

    await waitFor(() => {
      const del = calls.find((c) => c.method === 'DELETE');
      expect(del).toBeTruthy();
      // The endpoint URL is URL-encoded into the path.
      expect(del!.url).toContain(encodeURIComponent(ENDPOINT));
    });

    // Re-fetched (a second GET) and the row is gone — deleted server-side, not hidden.
    await waitFor(() => {
      expect(screen.queryByText('Chrome on Mac')).not.toBeInTheDocument();
    });
    const listGets = calls.filter(
      (c) => c.url.includes('/push/subscriptions') && c.method === 'GET',
    );
    expect(listGets.length).toBeGreaterThanOrEqual(2);
  });
});
