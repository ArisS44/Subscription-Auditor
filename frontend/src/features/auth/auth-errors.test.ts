import { describe, expect, it } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import { signInErrorKey, signUpErrorKey } from './auth-errors';

function authError(partial: Partial<AuthError>): AuthError {
  return { name: 'AuthApiError', message: 'x', status: 400, ...partial } as AuthError;
}

describe('signInErrorKey', () => {
  it('gives the same generic message for a wrong password and an unknown email', () => {
    // The security property: sign-in must not reveal whether an address is
    // registered, so these two cases are indistinguishable to the caller.
    const wrongPassword = signInErrorKey(authError({ code: 'invalid_credentials' }));
    const unknownEmail = signInErrorKey(authError({ code: 'user_not_found', status: 400 }));
    expect(wrongPassword).toBe('auth.login.error');
    expect(unknownEmail).toBe(wrongPassword);
  });

  it('names the failures that leak nothing', () => {
    expect(signInErrorKey(authError({ code: 'email_not_confirmed' }))).toBe(
      'auth.errors.emailNotConfirmed',
    );
    expect(signInErrorKey(authError({ status: 429 }))).toBe('auth.errors.rateLimited');
    expect(signInErrorKey(authError({ name: 'AuthRetryableFetchError', status: 0 }))).toBe(
      'auth.errors.network',
    );
  });
});

describe('signUpErrorKey', () => {
  it("surfaces the server's own password rejection rather than claiming the form was fine", () => {
    expect(signUpErrorKey(authError({ code: 'weak_password' }))).toBe('auth.errors.weakPassword');
  });

  it('does not confirm that an address is already registered', () => {
    const key = signUpErrorKey(authError({ code: 'user_already_exists' }));
    expect(key).toBe('auth.errors.maybeExistingAccount');
    expect(signUpErrorKey(authError({ code: 'email_exists' }))).toBe(key);
  });

  it('falls back to the generic signup failure', () => {
    expect(signUpErrorKey(authError({ code: 'unexpected_failure' }))).toBe('auth.signup.error');
  });
});
