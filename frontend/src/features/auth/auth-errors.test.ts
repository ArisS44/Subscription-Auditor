import { describe, expect, it } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import { signInErrorKey, signUpErrorKey, updatePasswordErrorKey } from './auth-errors';

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
    expect(signInErrorKey(authError({ status: 429 }))).toBe('auth.errors.tooManyRequests');
    expect(signInErrorKey(authError({ name: 'AuthRetryableFetchError', status: 0 }))).toBe(
      'auth.errors.network',
    );
  });
});

describe('rate limits', () => {
  // The whole point of the split: these three imply waits of wildly different
  // lengths, so they must not collapse onto one message. A real beta tester hit
  // the hourly email limit and was told to wait a minute.
  it('tells the three rate limits apart', () => {
    const emailLimit = signUpErrorKey(
      authError({ code: 'over_email_send_rate_limit', status: 429 }),
    );
    const requestLimit = signUpErrorKey(
      authError({ code: 'over_request_rate_limit', status: 429 }),
    );
    const bare429 = signUpErrorKey(authError({ status: 429 }));

    expect(emailLimit).toBe('auth.errors.emailRateLimited');
    expect(requestLimit).toBe('auth.errors.rateLimited');
    expect(bare429).toBe('auth.errors.tooManyRequests');
    expect(new Set([emailLimit, requestLimit, bare429]).size).toBe(3);
  });

  // The email limit arrives with status 429 too, so a status-first check would
  // swallow the code and produce the wrong message. Order matters here.
  it('prefers the specific code over the bare status', () => {
    expect(signUpErrorKey(authError({ code: 'over_email_send_rate_limit', status: 429 }))).toBe(
      'auth.errors.emailRateLimited',
    );
  });

  it('applies the same mapping on every surface that can hit a limit', () => {
    for (const mapper of [signInErrorKey, signUpErrorKey, updatePasswordErrorKey]) {
      expect(mapper(authError({ code: 'over_email_send_rate_limit' }))).toBe(
        'auth.errors.emailRateLimited',
      );
      expect(mapper(authError({ code: 'over_request_rate_limit' }))).toBe(
        'auth.errors.rateLimited',
      );
    }
  });

  it('leaves non-rate-limit failures alone', () => {
    expect(signUpErrorKey(authError({ code: 'weak_password' }))).toBe('auth.errors.weakPassword');
    expect(updatePasswordErrorKey(authError({ code: 'same_password' }))).toBe(
      'auth.errors.samePassword',
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
