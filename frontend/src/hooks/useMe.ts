import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  preferred_language: string;
  onboarding_completed: boolean;
}

// Partial profile update — mirrors the backend ProfileUpdate (all optional).
export interface ProfileUpdateInput {
  display_name?: string | null;
  preferred_language?: 'auto' | 'en' | 'el';
  onboarding_completed?: boolean;
}

export function useMe(accessToken: string | undefined) {
  return useQuery({
    queryKey: ['me', accessToken],
    queryFn: async (): Promise<Profile> => {
      const response = await apiFetch('/me', { accessToken });
      if (!response.ok) {
        throw new Error(`Failed to fetch profile: ${response.status}`);
      }
      return response.json() as Promise<Profile>;
    },
    enabled: Boolean(accessToken),
  });
}

/** PATCH /me. On success writes the profile the PATCH already returned straight
 *  into the ['me'] cache, then invalidates so any active observers also refetch.
 *
 *  The write is what makes onboarding completion correct: when the wizard is
 *  mounted the dashboard is unmounted, so ['me'] has no active observer and a
 *  bare invalidation marks the entry stale without refetching. On returning to
 *  the dashboard the onboarding gate would then read a stale `onboarding_completed:
 *  false` and redirect back into the wizard. Seeding the fresh value keeps the
 *  gate's read correct immediately. Same TanStack Query pattern as the
 *  subscription mutations, plus the explicit cache write. */
export function useUpdateProfile(accessToken: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileUpdateInput): Promise<Profile> => {
      const response = await apiFetch('/me', {
        accessToken,
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to update profile: ${response.status}`);
      }
      return response.json() as Promise<Profile>;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(['me', accessToken], profile);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
