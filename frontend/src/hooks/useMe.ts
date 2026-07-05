import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  preferred_language: string;
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
