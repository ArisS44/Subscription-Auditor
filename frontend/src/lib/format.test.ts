import { describe, expect, it } from 'vitest';

import { formatCurrency, formatNumber } from './format';

// A chat table cell carries no currency code — `render_table` has no currency
// field — so prices arrive here as bare numbers. Rounding them is a correctness
// bug, not a cosmetic one: a subscription auditor that shows 7.99 as 8 is
// misreporting what the user pays. Observed live before this was fixed.
describe('formatNumber', () => {
  it('keeps cents rather than rounding a price away', () => {
    expect(formatNumber(7.99, 'en')).toBe('7.99');
    expect(formatNumber(7.99, 'el')).toBe('7,99');
  });

  it('still renders whole numbers without padding', () => {
    // maximumFractionDigits is a ceiling, not a minimum.
    expect(formatNumber(8, 'en')).toBe('8');
    expect(formatNumber(1234, 'en')).toBe('1,234');
  });

  it('groups thousands per locale', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'el')).toBe('1.234,5');
  });

  it('keeps compact axis ticks short, where a single digit is read as scale', () => {
    expect(formatNumber(1200, 'en', true)).toBe('1.2K');
  });
});

describe('formatCurrency', () => {
  it('renders cents for both locales', () => {
    expect(formatCurrency(7.99, 'EUR', 'en')).toContain('7.99');
    expect(formatCurrency(7.99, 'EUR', 'el')).toContain('7,99');
  });

  it('accepts the Decimal-as-string shape the API returns', () => {
    expect(formatCurrency('12.50', 'EUR', 'en')).toContain('12.50');
  });
});
