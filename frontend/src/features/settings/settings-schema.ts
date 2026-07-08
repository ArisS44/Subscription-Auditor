import { z } from 'zod';
import type { TFunction } from 'i18next';

export const LANGUAGES = ['auto', 'en', 'el'] as const;
export type PreferredLanguage = (typeof LANGUAGES)[number];

const DISPLAY_NAME_MAX = 100; // mirrors the backend ProfileUpdate cap

/** Settings form schema with i18n-keyed messages (UX only — the backend
 *  re-validates). Same factory pattern as the subscription form. */
export function createSettingsSchema(t: TFunction) {
  return z.object({
    display_name: z.string().trim().max(DISPLAY_NAME_MAX, t('settings.errors.displayNameTooLong')),
    preferred_language: z.enum(LANGUAGES),
  });
}

export type SettingsFormValues = z.infer<ReturnType<typeof createSettingsSchema>>;
