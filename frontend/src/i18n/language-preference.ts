/** Tracks a language the user picked *deliberately*, as opposed to one i18next
 *  detected from their browser.
 *
 *  The distinction matters because the choice is written to
 *  `profiles.preferred_language`, whose 'auto' default is meaningful server-side:
 *  the backend reads it to pick a language for reminder copy
 *  (`services/notifications_copy.py`) and for the chat system prompt. Writing a
 *  merely *detected* language would silently convert "follow my browser" into a
 *  hard preference the user never expressed, so only an explicit click is recorded.
 *
 *  i18next's own detector cache (`i18nextLng`) cannot serve this purpose: it stores
 *  whatever language was resolved, detected or chosen alike. */

export type ChosenLanguage = 'en' | 'el';

const STORAGE_KEY = 'apollon.languageChoice';

/** All access is guarded: localStorage throws on access in some privacy modes, and
 *  a language preference is never worth breaking a render over. */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberLanguageChoice(language: ChosenLanguage): void {
  try {
    safeStorage()?.setItem(STORAGE_KEY, language);
  } catch {
    // Storage full or blocked — the in-memory language change still applies.
  }
}

export function readLanguageChoice(): ChosenLanguage | null {
  try {
    const value = safeStorage()?.getItem(STORAGE_KEY);
    return value === 'en' || value === 'el' ? value : null;
  } catch {
    return null;
  }
}

export function clearLanguageChoice(): void {
  try {
    safeStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; a stale flag only risks a redundant no-op sync attempt.
  }
}
