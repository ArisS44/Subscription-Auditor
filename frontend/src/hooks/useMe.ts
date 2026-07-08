import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  preferred_language: string;
}

// Partial profile update — mirrors the backend ProfileUpdate (both optional).
export interface ProfileUpdateInput {
  display_name?: string | null;
  preferred_language?: 'auto' | 'en' | 'el';
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

/** PATCH /me. On success invalidates the ['me'] query so the profile refetches
 *  and the new values are reflected everywhere (sidebar, Settings) — and persist
 *  across a reload. Same TanStack Query pattern as the subscription mutations. */
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
