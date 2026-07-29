// Formatting helpers built on the Intl API, keyed to the active i18n language.
// Never hand-roll number/date/currency formatting — Intl handles locale rules
// (decimal separators, currency symbol placement, month names) for both en and
// el. Money values from the API arrive as strings (Decimal-as-string), so these
// accept string | number and convert once, here.

/** Currency formatting, e.g. `$15.99` / `15,99 €` depending on locale + code. */
export function formatCurrency(amount: number | string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
}

/** Plain number, locale-grouped (e.g. `1,234.56` / `1.234,56`). Used for cells
 *  and values that carry no currency code of their own.
 *
 *  Keeps two fraction digits, because a chat table cell is very often money
 *  without a currency field to prove it — `render_table` has no currency, so a
 *  price lands here as a bare number. At one digit this rounded 7.99 to "8" and
 *  silently misreported a subscription price, which is the one thing this app
 *  must not do. `maximumFractionDigits` is a ceiling, not padding, so whole
 *  numbers still render as `1,234` rather than `1,234.00`.
 *
 *  Compact axis ticks keep a single digit: they are deliberately approximate
 *  (`1.2K`) and are read as scale, never as an amount. */
export function formatNumber(value: number, locale: string, compact = false): string {
  return new Intl.NumberFormat(locale, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

/** Medium date, e.g. `Aug 1, 2026` / `1 Αυγ 2026`. Accepts an ISO date string. */
export function formatDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(isoDate));
}

/** Compact day + time, e.g. `Jul 15, 2:32 PM` / `15 Ιουλ, 14:32`. Deliberately
 *  omits the year: it labels recent items in tight spaces (the chat sidebar),
 *  where the year is noise and the width is scarce. Locale decides 12h vs 24h. */
export function formatShortDateTime(isoTimestamp: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoTimestamp));
}
