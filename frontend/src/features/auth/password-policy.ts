/** The signup password policy, declared once so the live checklist and the Zod
 *  schema cannot drift apart — a checklist that ticks green while the schema still
 *  rejects the value is worse than no checklist at all.
 *
 *  These rules are **UX only**. Supabase Auth is the enforcement point, exactly as
 *  the backend is for the rest of the app, so this policy must be at least as
 *  strict as the project's configured Supabase policy and never looser: stricter
 *  merely refuses a password the server would have accepted, whereas looser lets
 *  the user submit something the server rejects. `weak_password` from Supabase is
 *  still mapped to a readable message as a backstop (see `auth-errors.ts`). */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRuleId = 'length' | 'letter' | 'number';

export interface PasswordRule {
  id: PasswordRuleId;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', test: (value) => value.length >= PASSWORD_MIN_LENGTH },
  // \p{L} rather than [a-zA-Z]: this app is bilingual, and a Greek-letter password
  // is a letter password.
  { id: 'letter', test: (value) => /\p{L}/u.test(value) },
  { id: 'number', test: (value) => /\p{Nd}/u.test(value) },
];

export function unmetPasswordRules(value: string): PasswordRule[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(value));
}

export function isPasswordAcceptable(value: string): boolean {
  return unmetPasswordRules(value).length === 0;
}
