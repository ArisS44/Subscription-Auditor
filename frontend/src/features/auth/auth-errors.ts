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

/** The three rate limits are told apart because the wait they imply differs by
 *  orders of magnitude. Collapsing them onto one "wait a minute" message is a lie
 *  for the email limit, which is hourly: the user retries in a minute, fails
 *  again, and concludes the app is broken. */
function rateLimitKey(error: AuthError): string | null {
  // Hourly, and counted per address rather than per attempt — retrying sooner
  // cannot succeed, so the copy must not suggest it.
  if (error.code === 'over_email_send_rate_limit') return 'auth.errors.emailRateLimited';
  // Per-minute request throttle: waiting a minute genuinely does clear it.
  if (error.code === 'over_request_rate_limit') return 'auth.errors.rateLimited';
  // A bare 429 with no code — we know a limit was hit but not which one, so the
  // message stays non-committal about how long the wait is.
  if (error.status === 429) return 'auth.errors.tooManyRequests';
  return null;
}

export function signInErrorKey(error: AuthError): string {
  if (isNetworkFailure(error)) return 'auth.errors.network';
  const limit = rateLimitKey(error);
  if (limit) return limit;
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
  const limit = rateLimitKey(error);
  if (limit) return limit;
  if (error.code === 'weak_password') return 'auth.errors.weakPassword';
  if (error.code === 'same_password') return 'auth.errors.samePassword';
  // Anything else is most likely an expired or already-used recovery link.
  return 'auth.resetPassword.error';
}

export function signUpErrorKey(error: AuthError): string {
  if (isNetworkFailure(error)) return 'auth.errors.network';
  const limit = rateLimitKey(error);
  if (limit) return limit;
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
