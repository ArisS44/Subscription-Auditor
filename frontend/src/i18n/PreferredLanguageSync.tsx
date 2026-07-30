import { useEffect, useRef } from 'react';
import { useMe, useUpdateProfile } from '@/hooks/useMe';
import { clearLanguageChoice, readLanguageChoice } from './language-preference';

/** Carries a language chosen *before* signup into `profiles.preferred_language`,
 *  so the choice follows the user to another device instead of living only in this
 *  browser's storage.
 *
 *  This has to happen here rather than at signup: the profile row is created by a
 *  database trigger on `auth.users` (`handle_new_user`, security definer) with
 *  `preferred_language default 'auto'`, so the frontend takes no part in the
 *  initial insert and can only correct it on the first authenticated load.
 *
 *  Renders nothing — it is mounted for its effect, once a session exists, so the
 *  profile query never runs for an unauthenticated visitor. The `'auto'` guard
 *  makes it strictly a one-way promotion of an unset preference: an account that
 *  already stores 'en' or 'el' is never overwritten by whatever a shared browser
 *  happened to remember. */
export function PreferredLanguageSync({ accessToken }: { accessToken: string }) {
  const { data: profile } = useMe(accessToken);
  const updateProfile = useUpdateProfile(accessToken);
  // One attempt per mount: the effect re-runs as the mutation's own state changes,
  // and without this the success path would re-enter before the flag is cleared.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !profile) return;
    const choice = readLanguageChoice();
    if (!choice) return;
    attempted.current = true;

    if (profile.preferred_language !== 'auto') {
      // The account already carries a deliberate preference; it wins.
      clearLanguageChoice();
      return;
    }

    // Cleared only on success, so a failed PATCH is retried on the next mount.
    // `useUpdateProfile` seeds the ['me'] cache from the response before
    // invalidating — the pattern the onboarding-gate fix depends on.
    updateProfile.mutate(
      { preferred_language: choice },
      { onSuccess: () => clearLanguageChoice() },
    );
  }, [profile, updateProfile]);

  return null;
}
