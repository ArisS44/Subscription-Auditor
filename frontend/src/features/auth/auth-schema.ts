import { z } from 'zod';
import type { TFunction } from 'i18next';
import { PASSWORD_RULES } from './password-policy';

/** Auth form schemas with i18n-keyed messages. Same factory pattern as the
 *  settings and subscription forms. Validation here is UX only — Supabase Auth
 *  re-validates everything that matters. */

function emailField(t: TFunction) {
  return z
    .string()
    .trim()
    .min(1, t('auth.errors.emailRequired'))
    .refine(
      // Deliberately permissive: the goal is catching a typo like a missing "@",
      // not adjudicating RFC 5322. Supabase decides what it actually accepts, and
      // an over-strict client regex rejecting a valid address is the worse failure.
      (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      t('auth.errors.emailInvalid'),
    );
}

/** The policy-checked password field. Shared by sign-up and password reset so the
 *  two surfaces cannot disagree about what a valid password is — they did once,
 *  with reset accepting passwords sign-up would have refused. */
function passwordField(t: TFunction) {
  return z.string().superRefine((value, ctx) => {
    // One issue per unmet rule, so the form can report exactly what is missing
    // instead of a single catch-all "invalid password".
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(value)) {
        ctx.addIssue({ code: 'custom', message: t(`auth.passwordPolicy.${rule.id}`) });
      }
    }
  });
}

export function createSignupSchema(t: TFunction) {
  return z.object({
    email: emailField(t),
    password: passwordField(t),
  });
}

/** Choosing a new password after a reset link — same policy as sign-up, since it
 *  sets exactly the same credential. */
export function createResetPasswordSchema(t: TFunction) {
  return z.object({
    password: passwordField(t),
  });
}

export function createLoginSchema(t: TFunction) {
  return z.object({
    email: emailField(t),
    // No policy check on sign-in: the rules may have changed since the account was
    // created, and the server is what decides whether the password is right.
    password: z.string().min(1, t('auth.errors.passwordRequired')),
  });
}

export type SignupFormValues = z.infer<ReturnType<typeof createSignupSchema>>;
export type LoginFormValues = z.infer<ReturnType<typeof createLoginSchema>>;
export type ResetPasswordFormValues = z.infer<ReturnType<typeof createResetPasswordSchema>>;
