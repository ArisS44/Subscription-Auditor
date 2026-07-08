import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { BillingCycle } from '@/hooks/useSubscriptions';

// Mirrors app/models/analytics.py. Every money figure is a monthly-equivalent
// roll-up, grouped by currency and never FX-converted; only active
// subscriptions contribute. An empty portfolio yields empty dicts/lists.
// Money values arrive as *strings* (Pydantic serializes Decimal to a JSON
// string); convert with Number(...) only when formatting for display.

export interface TopExpense {
  id: string;
  name: string;
  currency: string;
  monthly_equivalent: string;
}

export interface UpcomingRenewal {
  id: string;
  name: string;
  price: string;
  currency: string;
  billing_cycle: BillingCycle;
  next_renewal_date: string; // ISO date
}

export interface CategorySpend {
  currency: string;
  category: string;
  monthly_equivalent: string;
}

export interface Analytics {
  monthly_burn_by_currency: Record<string, string>;
  annual_projection_by_currency: Record<string, string>;
  top_expenses: TopExpense[];
  upcoming_renewals: UpcomingRenewal[];
  spend_by_category: CategorySpend[];
}

// Shares the 'subscriptions' key prefix so subscription mutations invalidate the
// overview roll-up alongside the lists.
export const analyticsKeys = {
  overview: (accessToken: string | undefined) =>
    ['subscriptions', 'analytics', accessToken] as const,
};

/** The Overview roll-up payload. Gated on having an access token, like useMe. */
export function useAnalytics(accessToken: string | undefined) {
  return useQuery({
    queryKey: analyticsKeys.overview(accessToken),
    queryFn: async (): Promise<Analytics> => {
      const response = await apiFetch('/subscriptions/analytics', { accessToken });
      if (!response.ok) {
        throw new Error(`Failed to fetch analytics: ${response.status}`);
      }
      return response.json() as Promise<Analytics>;
    },
    enabled: Boolean(accessToken),
  });
}
