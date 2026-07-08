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
});
