// Formatting helpers built on the Intl API, keyed to the active i18n language.
// Never hand-roll number/date/currency formatting — Intl handles locale rules
// (decimal separators, currency symbol placement, month names) for both en and
// el. Money values from the API arrive as strings (Decimal-as-string), so these
// accept string | number and convert once, here.

/** Currency formatting, e.g. `$15.99` / `15,99 €` depending on locale + code. */
export function formatCurrency(amount: number | string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
}

/** Medium date, e.g. `Aug 1, 2026` / `1 Αυγ 2026`. Accepts an ISO date string. */
export function formatDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(isoDate));
}
