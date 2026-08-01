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
const MANAGE_URL_MAX = 2048; // matches _MANAGE_URL_MAX in the backend model
const PRICE_MAX = 99_999_999.99; // NUMERIC(10,2)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Non-negative, up to 2 decimal places, with either decimal separator. No leading
// minus ⇒ negatives rejected.
//
// The comma is not a convenience. iOS draws the `inputMode="decimal"` keypad with
// the separator key of the *device* locale, so on a European iPhone that key emits
// a comma and there is no dot key at all — a dot-only rule asks for a character
// the user cannot type, and blocks every non-whole price.
//
// Exactly one separator is allowed, deliberately. "1.234,56" and "1,234.56" are
// the same number written two ways and cannot be told apart without knowing the
// locale; guessing wrong changes a price by a factor of a thousand, so both are
// rejected rather than interpreted.
const PRICE_RE = /^\d+([.,]\d{1,2})?$/;

/** Convert a validated price to the dot form the API and the NUMERIC(10,2) column
 *  require. Safe to call before validation too: it only rewrites the separator, so
 *  malformed input stays malformed and is still rejected. */
export function normalisePrice(value: string): string {
  return value.trim().replace(',', '.');
}

// Accept only well-formed http(s) URLs — mirrors the backend's AnyHttpUrl check,
// which rejects other schemes (e.g. javascript:, ftp:). UX-only; the backend
// re-validates and is the real trust boundary.
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

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
      // Normalised before Number(): Number('7,99') is NaN, and every comparison
      // against NaN is false, so a comma price would fail the ceiling check and
      // report "price is too large" — a wrong answer with a misleading message.
      .refine((v) => Number(normalisePrice(v)) <= PRICE_MAX, e('priceTooLarge')),
    // Dropdown is curated (CURRENCIES) for UX, but validation accepts any valid
    // 3-letter uppercase code — matches the backend and keeps an existing row's
    // out-of-list currency editable.
    currency: z.string().regex(/^[A-Z]{3}$/, e('currencyInvalid')),
    billing_cycle: z.enum(BILLING_CYCLES as unknown as [BillingCycle, ...BillingCycle[]]),
    start_date: z.string().min(1, e('startDateRequired')).regex(DATE_RE, e('dateInvalid')),
    next_renewal_date: z.union([z.string().regex(DATE_RE, e('dateInvalid')), z.literal('')]),
    notes: z.string().max(NOTES_MAX, e('notesTooLong')),
    // Optional provider manage/cancel link. Empty is allowed (clears it); a
    // non-empty value must be a well-formed http(s) URL within the length cap.
    manage_url: z.union([
      z.literal(''),
      z
        .string()
        .trim()
        .max(MANAGE_URL_MAX, e('manageUrlTooLong'))
        .refine(isHttpUrl, e('manageUrlInvalid')),
    ]),
    // Reminder lead time in days. `null` is a real state: inherit the user's
    // default. A number overrides it (0–30). UX-only bounds; backend re-validates.
    reminder_lead_days: z
      .number()
      .int(e('leadTimeInvalid'))
      .min(0, e('leadTimeInvalid'))
      .max(30, e('leadTimeInvalid'))
      .nullable(),
  });
}

// The form's value shape (all strings — inputs/selects yield strings).
export type SubscriptionFormValues = z.infer<ReturnType<typeof createSubscriptionSchema>>;

/** Map validated form values to the API create/update payload: drop the empty
 *  sentinels (category '' → null, blank optional fields → omitted/null). Price
 *  stays a string — the API accepts a numeric string for the Decimal — but is
 *  normalised to a dot here, the single point every create and edit passes
 *  through, so no comma can reach the backend by either route. */
export function formValuesToPayload(values: SubscriptionFormValues): SubscriptionCreateInput {
  return {
    name: values.name.trim(),
    category: values.category === NO_CATEGORY ? null : values.category,
    price: normalisePrice(values.price),
    currency: values.currency,
    billing_cycle: values.billing_cycle,
    start_date: values.start_date,
    next_renewal_date: values.next_renewal_date ? values.next_renewal_date : null,
    notes: values.notes.trim() ? values.notes.trim() : null,
    // Empty → null so an existing link can be cleared; the backend treats null as
    // "no link".
    manage_url: values.manage_url.trim() ? values.manage_url.trim() : null,
    // Passed through as-is: null means "inherit the user default", a number
    // overrides it.
    reminder_lead_days: values.reminder_lead_days,
  };
}
