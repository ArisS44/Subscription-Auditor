import type { TFunction } from 'i18next';

// A chart/table label from the assistant often carries a raw backend enum key —
// spend-by-category data labels its slices `ai_tool`, `cloud_storage`, etc. Those
// are internal identifiers and must never reach the screen (the same rule that
// keeps tool-registry names out of the UI). Two-step humanization:
//   1. A known subscription-category key → its localized display name, reusing
//      the very namespace the dashboard charts use, so chat and Overview agree
//      (and it translates to Greek).
//   2. Any other underscore_key → spaces, so a stray machine label still reads
//      as words rather than code. A label that is already prose is unchanged.
const CATEGORY_KEYS = new Set([
  'ai_tool',
  'streaming',
  'productivity',
  'cloud_storage',
  'other',
  'none',
]);

export function humanizeLabel(label: string, t: TFunction): string {
  if (CATEGORY_KEYS.has(label)) return t(`subscriptions.category.${label}`);
  return label.replace(/_/g, ' ');
}
