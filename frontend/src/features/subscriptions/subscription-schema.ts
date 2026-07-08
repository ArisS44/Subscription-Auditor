import { z } from 'zod';
import type { TFunction } from 'i18next';
import type { BillingCycle, Category, SubscriptionCreateInput } from '@/hooks/useSubscriptions';

// Enum value sets, kept identical to the backend Pydantic Literals
// (app/models/subscription.py) so the client offers exactly what the API accepts.
export const CATEGORIES: readonly Category[] = [
  'ai_tool',
  'streaming',
  'productivity',
  'cloud_storage',
  'other',
];
export const BILLING_CYCLES: readonly BillingCycle[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

// Curated ISO-4217 list rather than free text — the backend accepts any 3-letter
// uppercase code, but constraining the UI to common currencies is better UX.
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'] as const;

// Length/precision caps mirror the backend model exactly.
const NAME_MAX = 200;
const NOTES_MAX = 2000;
const PRICE_MAX = 99_999_999.99; // NUMERIC(10,2)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Non-negative, up to 2 decimal places. No leading minus ⇒ negatives rejected.
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

// Empty string is the "no category" sentinel in the form (the <select> can't hold
// null cleanly); it is mapped back to null when building the API payload.
export const NO_CATEGORY = '' as const;

/** Build the form schema with translated messages. A factory (not a module-level
 *  const) so error strings are i18n-keyed to the active language; pass an
 *  identity `t` in tests. Zod is UX-only here — the backend re-validates. */
export function createSubscriptionSchema(t: TFunction) {
  const e = (key: string) => t(`subscriptions.form.errors.${key}`);
  return z.object({
    name: z.string().trim().min(1, e('nameRequired')).max(NAME_MAX, e('nameTooLong')),
    category: z.union([
      z.enum(CATEGORIES as unknown as [Category, ...Category[]]),
      z.literal(NO_CATEGORY),
    ]),
    price: z
      .string()
      .trim()
      .min(1, e('priceRequired'))
      .regex(PRICE_RE, e('priceInvalid'))
      .refine((v) => Number(v) <= PRICE_MAX, e('priceTooLarge')),
    // Dropdown is curated (CURRENCIES) for UX, but validation accepts any valid
    // 3-letter uppercase code — matches the backend and keeps an existing row's
    // out-of-list currency editable.
    currency: z.string().regex(/^[A-Z]{3}$/, e('currencyInvalid')),
    billing_cycle: z.enum(BILLING_CYCLES as unknown as [BillingCycle, ...BillingCycle[]]),
    start_date: z.string().min(1, e('startDateRequired')).regex(DATE_RE, e('dateInvalid')),
    next_renewal_date: z.union([z.string().regex(DATE_RE, e('dateInvalid')), z.literal('')]),
    notes: z.string().max(NOTES_MAX, e('notesTooLong')),
  });
}

// The form's value shape (all strings — inputs/selects yield strings).
export type SubscriptionFormValues = z.infer<ReturnType<typeof createSubscriptionSchema>>;

/** Map validated form values to the API create/update payload: drop the empty
 *  sentinels (category '' → null, blank optional fields → omitted/null). Price
 *  stays a string — the API accepts a numeric string for the Decimal. */
export function formValuesToPayload(values: SubscriptionFormValues): SubscriptionCreateInput {
  return {
    name: values.name.trim(),
    category: values.category === NO_CATEGORY ? null : values.category,
    price: values.price.trim(),
    currency: values.currency,
    billing_cycle: values.billing_cycle,
    start_date: values.start_date,
    next_renewal_date: values.next_renewal_date ? values.next_renewal_date : null,
    notes: values.notes.trim() ? values.notes.trim() : null,
  };
}
