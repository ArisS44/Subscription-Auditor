import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  createSubscriptionSchema,
  formValuesToPayload,
  normalisePrice,
} from './subscription-schema';

// Identity translator: messages come back as their keys, which is all the test
// needs (it asserts on which field failed, not on translated copy).
const t = ((key: string) => key) as unknown as TFunction;
const schema = createSubscriptionSchema(t);

const valid = {
  name: 'Netflix',
  category: '' as const,
  price: '15.99',
  currency: 'EUR' as const,
  billing_cycle: 'monthly' as const,
  start_date: '2026-07-01',
  next_renewal_date: '',
  notes: '',
  manage_url: '',
  reminder_lead_days: null,
};

describe('subscription form schema', () => {
  it('accepts a valid payload', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it('accepts a real category and a renewal date', () => {
    const result = schema.safeParse({
      ...valid,
      category: 'streaming',
      next_renewal_date: '2026-08-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = schema.safeParse({ ...valid, name: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty price', () => {
    expect(schema.safeParse({ ...valid, price: '' }).success).toBe(false);
  });

  it('rejects a negative price', () => {
    expect(schema.safeParse({ ...valid, price: '-5' }).success).toBe(false);
  });

  it('rejects a non-numeric price', () => {
    expect(schema.safeParse({ ...valid, price: 'abc' }).success).toBe(false);
  });

  it('rejects more than two decimal places', () => {
    expect(schema.safeParse({ ...valid, price: '1.999' }).success).toBe(false);
  });

  it('rejects a price above the ceiling', () => {
    expect(schema.safeParse({ ...valid, price: '100000000' }).success).toBe(false);
  });
});

// iOS draws the decimal keypad with the device locale's separator key, so a
// European iPhone offers a comma and no dot at all. A dot-only rule made every
// non-whole price unenterable on those devices.
describe('decimal separator', () => {
  const priceIssues = (price: string) => {
    const r = schema.safeParse({ ...valid, price });
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('accepts a comma as the decimal separator', () => {
    expect(schema.safeParse({ ...valid, price: '7,99' }).success).toBe(true);
  });

  it('still accepts a dot', () => {
    expect(schema.safeParse({ ...valid, price: '7.99' }).success).toBe(true);
  });

  it('normalises a comma to a dot before the value reaches the API', () => {
    expect(formValuesToPayload({ ...valid, price: '7,99' }).price).toBe('7.99');
    expect(formValuesToPayload({ ...valid, price: '7.99' }).price).toBe('7.99');
    // Both create and edit go through this one function, so the two paths cannot
    // disagree about the stored format.
    expect(formValuesToPayload({ ...valid, price: ' 7,99 ' }).price).toBe('7.99');
  });

  it('checks the ceiling against the normalised value, not the raw string', () => {
    // The trap: Number('7,99') is NaN and NaN <= MAX is false, so without
    // normalising first this would fail as "too large" — a wrong verdict with a
    // misleading message.
    expect(priceIssues('7,99')).not.toContain('subscriptions.form.errors.priceTooLarge');
    // And the ceiling must still bite when it genuinely should, comma or not.
    expect(priceIssues('100000000,00')).toContain('subscriptions.form.errors.priceTooLarge');
  });

  it('rejects two separators rather than guessing a thousands convention', () => {
    // '1.234,56' and '1,234.56' are the same number written two ways; guessing
    // wrong would change a price by a factor of a thousand.
    expect(schema.safeParse({ ...valid, price: '1.234,56' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, price: '1,234.56' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, price: '1,2,3' }).success).toBe(false);
  });

  it('keeps every other rejection intact for comma input', () => {
    expect(schema.safeParse({ ...valid, price: '1,999' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, price: '-5,00' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, price: 'ab,cd' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, price: '7,' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, price: ',99' }).success).toBe(false);
  });

  it('leaves a malformed value malformed', () => {
    // normalisePrice only rewrites the separator — it must never rescue input
    // that validation should reject.
    expect(normalisePrice('ab,cd')).toBe('ab.cd');
    expect(normalisePrice('7,99')).toBe('7.99');
    expect(normalisePrice('7.99')).toBe('7.99');
  });

  it('rejects a malformed start date', () => {
    expect(schema.safeParse({ ...valid, start_date: '2026/07/01' }).success).toBe(false);
  });

  it('rejects an invalid currency', () => {
    expect(schema.safeParse({ ...valid, currency: 'XyZ' }).success).toBe(false);
  });

  it('accepts an https manage_url', () => {
    expect(schema.safeParse({ ...valid, manage_url: 'https://example.com/billing' }).success).toBe(
      true,
    );
  });

  it('accepts an empty manage_url (cleared)', () => {
    expect(schema.safeParse({ ...valid, manage_url: '' }).success).toBe(true);
  });

  it('rejects a non-http(s) manage_url scheme', () => {
    expect(schema.safeParse({ ...valid, manage_url: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('rejects a malformed manage_url', () => {
    expect(schema.safeParse({ ...valid, manage_url: 'not a url' }).success).toBe(false);
  });

  it('accepts null reminder_lead_days (inherit the user default)', () => {
    expect(schema.safeParse({ ...valid, reminder_lead_days: null }).success).toBe(true);
  });

  it('accepts an in-range reminder_lead_days override', () => {
    expect(schema.safeParse({ ...valid, reminder_lead_days: 7 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, reminder_lead_days: 0 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, reminder_lead_days: 30 }).success).toBe(true);
  });

  it('rejects an out-of-range or non-integer reminder_lead_days', () => {
    expect(schema.safeParse({ ...valid, reminder_lead_days: 31 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, reminder_lead_days: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, reminder_lead_days: 3.5 }).success).toBe(false);
  });
});
