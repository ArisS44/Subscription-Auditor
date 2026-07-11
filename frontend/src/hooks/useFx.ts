import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// Mirrors app/models/fx.py. Rates map a base currency to a set of quote codes.
// `rates` values arrive as *strings* (Pydantic serializes Decimal to JSON as a
// string to preserve precision) — convert with Number(...) only at the point of
// computation/formatting. Every FX figure is an estimate, labeled at the UI.

export interface FxRates {
  base: string;
  rates: Record<string, string>;
  as_of: string; // ISO datetime
}

export const fxKeys = {
  // FX data is user-independent (public rates), but we still fold the token into
  // the key since the endpoint is auth-gated and the request carries it.
  rates: (base: string, symbols: string[], accessToken: string | undefined) =>
    ['fx', 'rates', base, [...symbols].sort().join(','), accessToken] as const,
};

/** Rates for `base` → each of `symbols`. Enabled only when a token, a base, and
 *  at least one symbol are present. A 503 (FX source down with no usable cache)
 *  surfaces as a thrown error so callers can show a "temporarily unavailable"
 *  state rather than a crash. Rates are cached ~12h server-side, so we keep them
 *  fresh for a few minutes client-side to avoid refetching on every toggle. */
export function useFxRates(
  accessToken: string | undefined,
  base: string,
  symbols: string[],
  enabled = true,
) {
  return useQuery({
    queryKey: fxKeys.rates(base, symbols, accessToken),
    queryFn: async (): Promise<FxRates> => {
      const query = new URLSearchParams({ base });
      if (symbols.length > 0) query.set('symbols', symbols.join(','));
      const response = await apiFetch(`/fx/rates?${query.toString()}`, { accessToken });
      if (!response.ok) {
        throw new Error(`Failed to fetch FX rates: ${response.status}`);
      }
      return response.json() as Promise<FxRates>;
    },
    enabled: Boolean(accessToken) && Boolean(base) && symbols.length > 0 && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
