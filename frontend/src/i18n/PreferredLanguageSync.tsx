import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe, useUpdateProfile } from '@/hooks/useMe';
import {
  clearLanguageChoice,
  readLanguageChoice,
  type ChosenLanguage,
} from './language-preference';

/** Keeps the UI language and `profiles.preferred_language` in agreement, in both
 *  directions, for the duration of an authenticated session.
 *
 *  **Read (login → UI).** A stored 'en'/'el' is a preference the user deliberately
 *  expressed, so it wins over browser detection: signing in on a device that has
 *  never seen the account renders the app in their language without them touching
 *  the switcher. A stored 'auto' means "follow my browser" and is left alone —
 *  turning it into a hard language would silently discard that choice.
 *
 *  **Write (pre-signup choice → profile).** Unchanged from before: a language
 *  chosen before signing up is written into a profile still sitting at 'auto'. The
 *  profile row is created by a database trigger (`handle_new_user`) defaulting to
 *  'auto', so the frontend takes no part in the initial insert and can only correct
 *  it on first authenticated load. An account that already carries a deliberate
 *  preference is never overwritten by whatever a shared browser remembered.
 *
 *  **Write (in-app switch → profile).** Once the account expresses a concrete
 *  preference, the switcher keeps it up to date. Without this the read direction
 *  would actively break the switcher: switching to Greek would last only until the
 *  next login, when the stored value overrode it again. An 'auto' profile is
 *  deliberately *not* promoted by a switcher click — 'auto' keeps meaning "follow
 *  my browser", and i18next's own cache already makes that click persist locally.
 *
 *  Renders nothing; mounted for its effects once a session exists, so no profile
 *  query runs for an unauthenticated visitor. */
export function PreferredLanguageSync({ accessToken }: { accessToken: string }) {
  const { i18n } = useTranslation();
  const { data: profile } = useMe(accessToken);
  const updateProfile = useUpdateProfile(accessToken);

  // One reconciliation per mount. The effect re-runs as the mutation's own state
  // changes, and more importantly this is what stops the sync from fighting the
  // switcher: after the initial apply, the user's choice is the one that stands.
  const reconciled = useRef(false);
  // Latest value we believe the profile holds, readable from the event listener
  // without re-subscribing on every profile change.
  const storedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    storedRef.current = profile.preferred_language;
    if (reconciled.current) return;
    reconciled.current = true;

    const stored = profile.preferred_language;

    if (stored === 'en' || stored === 'el') {
      // i18n.language can be a region variant ("en-US"); compare on the base tag.
      if (i18n.language.split('-')[0] !== stored) {
        void i18n.changeLanguage(stored);
      }
      // The account's own preference wins, so a leftover pre-signup flag from this
      // browser is dropped rather than applied to someone else's account.
      clearLanguageChoice();
      return;
    }

    // stored === 'auto': browser detection stays in charge. Promote a pre-signup
    // choice if there is one — that is an explicit statement, unlike detection.
    const choice = readLanguageChoice();
    if (!choice) return;
    // Cleared only on success, so a failed PATCH is retried on the next mount.
    // `useUpdateProfile` seeds the ['me'] cache from the response before
    // invalidating — the pattern the onboarding-gate fix depends on.
    updateProfile.mutate(
      { preferred_language: choice },
      {
        onSuccess: () => {
          storedRef.current = choice;
          clearLanguageChoice();
        },
      },
    );
  }, [profile, i18n, updateProfile]);

  useEffect(() => {
    function handleLanguageChanged(language: string) {
      const base = language.split('-')[0];
      if (base !== 'en' && base !== 'el') return;
      const stored = storedRef.current;
      // Only mirror a concrete preference. 'auto' must stay 'auto', and null means
      // the profile has not loaded yet, so there is nothing to reconcile against.
      if (stored !== 'en' && stored !== 'el') return;
      if (stored === base) return;
      // Recorded immediately so the in-flight value is not written twice — the
      // Settings form also changes the language right after its own PATCH.
      storedRef.current = base;
      updateProfile.mutate({ preferred_language: base as ChosenLanguage });
    }

    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n, updateProfile]);

  return null;
}
