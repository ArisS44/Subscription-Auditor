// Local persistence for onboarding position, so a user who leaves mid-flow
// resumes where they were instead of restarting. The source of truth for "is
// onboarding done" is the server (`profiles.onboarding_completed`); this module
// only remembers *where in the flow* an unfinished user is, plus a
// once-per-session banner dismissal. All values are strictly-necessary UI state
// (no tracking), stored under a single namespaced key.

export const ONBOARDING_STEPS = [
  'welcome',
  'method',
  'setup',
  'extension',
  'notifications',
  'done',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// How the user chose to add their first subscription(s) at the "method" step —
// it decides what the "setup" step shows. Persisted so a resume renders the
// right setup content.
export type OnboardingMethod = 'chat' | 'manual' | 'skip';

export interface OnboardingProgress {
  stepIndex: number;
  method: OnboardingMethod | null;
  // Set once the user has entered the flow at least once. Gates the first-login
  // auto-redirect so a returning mid-flow user gets the resume banner instead of
  // being force-walked back into the wizard.
  entered: boolean;
}

const KEY = 'auditor.onboarding';
const BANNER_DISMISSED_KEY = 'auditor.onboarding.bannerDismissed';

const DEFAULT: OnboardingProgress = { stepIndex: 0, method: null, entered: false };

export function readProgress(): OnboardingProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<OnboardingProgress>;
    const maxIndex = ONBOARDING_STEPS.length - 1;
    return {
      stepIndex: Math.min(Math.max(Number(parsed.stepIndex) || 0, 0), maxIndex),
      method: parsed.method ?? null,
      entered: Boolean(parsed.entered),
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function writeProgress(progress: OnboardingProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Storage unavailable (private mode / quota) — the flow still works for this
    // session; it just won't resume later. Non-fatal.
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(BANNER_DISMISSED_KEY);
  } catch {
    // ignore
  }
}

/** The resume banner is dismissible for the current session only — it returns
 *  next session until onboarding is actually completed (server-side). */
export function isBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(BANNER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissBannerForSession(): void {
  try {
    sessionStorage.setItem(BANNER_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
}
