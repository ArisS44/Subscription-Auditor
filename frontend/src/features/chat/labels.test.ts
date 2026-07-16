import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { humanizeLabel } from './labels';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('humanizeLabel', () => {
  it('maps a known category key to its localized display name', () => {
    expect(humanizeLabel('ai_tool', i18n.t)).toBe(i18n.t('subscriptions.category.ai_tool'));
    expect(humanizeLabel('cloud_storage', i18n.t)).toBe('Cloud storage');
    // Never the raw key.
    expect(humanizeLabel('cloud_storage', i18n.t)).not.toContain('_');
  });

  it('localizes category names for the active language', async () => {
    await i18n.changeLanguage('el');
    expect(humanizeLabel('ai_tool', i18n.t)).toBe(i18n.t('subscriptions.category.ai_tool'));
    expect(humanizeLabel('ai_tool', i18n.t)).not.toBe('ai_tool');
  });

  it('replaces underscores in an unknown machine-looking label', () => {
    expect(humanizeLabel('some_future_bucket', i18n.t)).toBe('some future bucket');
  });

  it('leaves ordinary prose untouched', () => {
    expect(humanizeLabel('Netflix', i18n.t)).toBe('Netflix');
    expect(humanizeLabel('January 2026', i18n.t)).toBe('January 2026');
  });
});
