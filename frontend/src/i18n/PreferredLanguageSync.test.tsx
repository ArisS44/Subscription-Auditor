import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/hooks/useMe';
import { PreferredLanguageSync } from './PreferredLanguageSync';
import { readLanguageChoice, rememberLanguageChoice } from './language-preference';

const TOKEN = 'token';

function profile(preferred: string): Profile {
  return {
    id: 'u1',
    email: 'a@b.c',
    display_name: null,
    preferred_language: preferred,
    onboarding_completed: false,
    renewal_lead_days: 3,
    monthly_review_enabled: false,
  };
}

/** GET /me answers with `stored`; PATCH /me echoes the body back merged, as the
 *  real endpoint does. */
function stubApi(stored: string) {
  const fetchMock = vi.fn<typeof fetch>((_input, init) => {
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    const body =
      method === 'PATCH'
        ? { ...profile(stored), ...(JSON.parse(String((init as RequestInit).body)) as object) }
        : profile(stored);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function patchCalls(fetchMock: ReturnType<typeof stubApi>) {
  return fetchMock.mock.calls.filter(
    (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
  );
}

function renderSync() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PreferredLanguageSync accessToken={TOKEN} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('PreferredLanguageSync', () => {
  it('writes a pre-signup language choice into a profile still set to auto', async () => {
    rememberLanguageChoice('el');
    const fetchMock = stubApi('auto');
    renderSync();

    await waitFor(() => expect(patchCalls(fetchMock)).toHaveLength(1));
    const [, init] = patchCalls(fetchMock)[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ preferred_language: 'el' });

    // Cleared on success so the sync does not run again on the next mount.
    await waitFor(() => expect(readLanguageChoice()).toBeNull());
  });

  it('never overwrites a preference the account already stores', async () => {
    rememberLanguageChoice('el');
    const fetchMock = stubApi('en');
    renderSync();

    // The stale browser flag is dropped rather than applied — the account's own
    // deliberate setting wins.
    await waitFor(() => expect(readLanguageChoice()).toBeNull());
    expect(patchCalls(fetchMock)).toHaveLength(0);
  });

  it('does not write anything when the visitor never chose a language', async () => {
    const fetchMock = stubApi('auto');
    renderSync();

    // A merely detected language is not a stated preference, so 'auto' must stand.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchCalls(fetchMock)).toHaveLength(0);
  });
});
