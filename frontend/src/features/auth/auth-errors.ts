import type { AuthError } from '@supabase/supabase-js';

/** Maps a Supabase auth failure to an i18n key.
 *
 *  Sign-in deliberately does NOT distinguish "no account with that email" from
 *  "wrong password". Answering that precisely turns the login form into an
 *  account-enumeration oracle: anyone could test addresses and learn which ones
 *  are registered. Failures that leak nothing — an unconfirmed email, a rate
 *  limit, a dead network — are reported precisely, because vagueness there just
 *  leaves the user stuck with no idea what to do. */

/** Supabase surfaces a failed fetch as a retryable error with no HTTP status. */
function isNetworkFailure(error: AuthError): boolean {
  return error.name === 'AuthRetryableFetchError' || !error.status;
}

function isRateLimit(error: AuthError): boolean {
  return (
    error.status === 429 ||
    error.code === 'over_request_rate_limit' ||
    error.code === 'over_email_send_rate_limit'
  );
}

export function signInErrorKey(error: AuthError): string {
  if (isNetworkFailure(error)) return 'auth.errors.network';
  if (isRateLimit(error)) return 'auth.errors.rateLimited';
  if (error.code === 'email_not_confirmed') return 'auth.errors.emailNotConfirmed';
  // Everything else, including invalid_credentials and an unknown email, collapses
  // into one generic message on purpose.
  return 'auth.login.error';
}

/** Setting a new password from a reset link. Supabase remains the enforcement
 *  point — the client policy is UX — so its own rejection is surfaced rather than
 *  hidden behind the generic "link may have expired" message, which would send the
 *  user off requesting another link when the real problem was the password. */
export function updatePasswordErrorKey(error: AuthError): string {
  if (isNetworkFailure(error)) return 'auth.errors.network';
  if (isRateLimit(error)) return 'auth.errors.rateLimited';
  if (error.code === 'weak_password') return 'auth.errors.weakPassword';
  if (error.code === 'same_password') return 'auth.errors.samePassword';
  // Anything else is most likely an expired or already-used recovery link.
  return 'auth.resetPassword.error';
}

export function signUpErrorKey(error: AuthError): string {
  if (isNetworkFailure(error)) return 'auth.errors.network';
  if (isRateLimit(error)) return 'auth.errors.rateLimited';
  // The server's own policy rejected it — the client policy is out of step, so say
  // what the server said rather than pretending the form was fine.
  if (error.code === 'weak_password') return 'auth.errors.weakPassword';
  // Phrased so it does not confirm the address is registered (Supabase itself
  // obscures this when email confirmation is on): it points at signing in or
  // resetting without asserting an account exists.
  if (error.code === 'user_already_exists' || error.code === 'email_exists') {
    return 'auth.errors.maybeExistingAccount';
  }
  return 'auth.signup.error';
}
