import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
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
  let current = stored;
  const fetchMock = vi.fn<typeof fetch>((_input, init) => {
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    if (method === 'PATCH') {
      const patch = JSON.parse(String((init as RequestInit).body)) as {
        preferred_language?: string;
      };
      if (patch.preferred_language) current = patch.preferred_language;
    }
    return Promise.resolve(
      new Response(JSON.stringify(profile(current)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function patchBodies(fetchMock: ReturnType<typeof stubApi>) {
  return fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
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

afterEach(async () => {
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

describe('PreferredLanguageSync — reading a stored preference', () => {
  it('renders the app in Greek when the account stores el, without the user acting', async () => {
    // The cross-device case: this browser has never seen the account and i18next
    // detected English, but the account says Greek.
    await i18n.changeLanguage('en');
    stubApi('el');
    renderSync();

    await waitFor(() => expect(i18n.language).toBe('el'));
  });

  it('leaves browser detection in charge when the account stores auto', async () => {
    await i18n.changeLanguage('el');
    const fetchMock = stubApi('auto');
    renderSync();

    // 'auto' means "follow my browser" — it must not be forced to English.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(i18n.language).toBe('el');
    expect(patchBodies(fetchMock)).toHaveLength(0);
  });

  it('drops a stale browser choice rather than applying it to this account', async () => {
    rememberLanguageChoice('el');
    const fetchMock = stubApi('en');
    renderSync();

    await waitFor(() => expect(readLanguageChoice()).toBeNull());
    expect(patchBodies(fetchMock)).toHaveLength(0);
    expect(i18n.language).toBe('en');
  });
});

describe('PreferredLanguageSync — writing a pre-signup choice', () => {
  it('writes the choice into a profile still set to auto', async () => {
    rememberLanguageChoice('el');
    const fetchMock = stubApi('auto');
    renderSync();

    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1));
    expect(patchBodies(fetchMock)[0]).toEqual({ preferred_language: 'el' });
    await waitFor(() => expect(readLanguageChoice()).toBeNull());
  });

  it('does not write anything when the visitor never chose a language', async () => {
    const fetchMock = stubApi('auto');
    renderSync();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchBodies(fetchMock)).toHaveLength(0);
  });
});

describe('PreferredLanguageSync — the in-app switcher', () => {
  it('does not revert a language the user switches to while logged in', async () => {
    await i18n.changeLanguage('en');
    stubApi('el');
    renderSync();
    await waitFor(() => expect(i18n.language).toBe('el'));

    // The user now switches back to English from the sidebar switcher.
    await i18n.changeLanguage('en');

    // The sync reconciles once per mount, so it must not drag them back to Greek.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(i18n.language).toBe('en');
  });

  it('still does not revert when the mirroring write fails', async () => {
    // The case that isolates the once-per-mount guard. When the PATCH succeeds the
    // stored value is updated to match, so nothing would revert even without the
    // guard; with the write failing, the profile keeps saying 'el' and a sync that
    // reconciled on every render would drag the user back to Greek.
    await i18n.changeLanguage('en');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((_input, init) => {
        const method = (init as RequestInit | undefined)?.method ?? 'GET';
        if (method === 'PATCH') {
          return Promise.resolve(new Response('nope', { status: 500 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify(profile('el')), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    renderSync();
    await waitFor(() => expect(i18n.language).toBe('el'));

    await i18n.changeLanguage('en');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(i18n.language).toBe('en');
  });

  it('mirrors the switch into the profile so it survives the next login', async () => {
    await i18n.changeLanguage('en');
    const fetchMock = stubApi('el');
    renderSync();
    await waitFor(() => expect(i18n.language).toBe('el'));
    // The initial apply must not write anything back — it changed the UI to match
    // the profile, so there is nothing to record.
    expect(patchBodies(fetchMock)).toHaveLength(0);

    await i18n.changeLanguage('en');

    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1));
    expect(patchBodies(fetchMock)[0]).toEqual({ preferred_language: 'en' });
  });

  it('keeps an auto profile on auto when the user uses the switcher', async () => {
    await i18n.changeLanguage('en');
    const fetchMock = stubApi('auto');
    renderSync();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await i18n.changeLanguage('el');

    // 'auto' is a real choice — "follow my browser" — and a switcher click must not
    // silently convert it into a hard language. i18next's own cache already makes
    // the click persist on this browser.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patchBodies(fetchMock)).toHaveLength(0);
    expect(i18n.language).toBe('el');
  });
});
