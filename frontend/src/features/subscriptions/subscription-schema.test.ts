import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { createSubscriptionSchema } from './subscription-schema';

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
