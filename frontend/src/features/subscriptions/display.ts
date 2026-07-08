import type { TFunction } from 'i18next';
import { formatCurrency } from '@/lib/format';
import type { Subscription, SubscriptionStatus } from '@/hooks/useSubscriptions';

/** Literal per-period price, e.g. "€15.99 / month" — exactly what was entered,
 *  never normalized (that's the Overview tab's job). */
export function perPeriodPrice(sub: Subscription, locale: string, t: TFunction): string {
  return `${formatCurrency(sub.price, sub.currency, locale)} / ${t(`subscriptions.per.${sub.billing_cycle}`)}`;
}

/** Badge styling per status: active is prominent, paused muted, cancelled quiet. */
export function statusBadgeVariant(
  status: SubscriptionStatus,
): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'paused':
      return 'secondary';
    case 'cancelled':
      return 'outline';
  }
}
