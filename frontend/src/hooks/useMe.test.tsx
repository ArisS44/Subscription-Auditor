import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUpdateProfile, type Profile } from './useMe';

const TOKEN = 'token';

function completedProfile(): Profile {
  return {
    id: 'u1',
    email: 'a@b.c',
    display_name: null,
    preferred_language: 'en',
    onboarding_completed: true,
    renewal_lead_days: 3,
    monthly_review_enabled: false,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdateProfile cache handling', () => {
  it('writes the returned profile into the ["me"] cache so the gate reads it without a refetch', async () => {
    // The PATCH returns the completed profile; the returned value must land in the
    // cache directly, not merely trigger an invalidation (which would not refetch
    // while the dashboard — the only ['me'] observer — is unmounted).
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(completedProfile()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    // Seed the stale value the wizard would have started from.
    client.setQueryData(['me', TOKEN], { ...completedProfile(), onboarding_completed: false });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateProfile(TOKEN), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ onboarding_completed: true });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Profile>(['me', TOKEN]);
      expect(cached?.onboarding_completed).toBe(true);
    });
  });
});
