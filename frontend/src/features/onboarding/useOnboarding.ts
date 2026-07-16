import { useCallback, useState } from 'react';
import { useUpdateProfile } from '@/hooks/useMe';
import {
  ONBOARDING_STEPS,
  clearProgress,
  readProgress,
  writeProgress,
  type OnboardingMethod,
  type OnboardingStep,
} from './onboarding-state';

const LAST_INDEX = ONBOARDING_STEPS.length - 1;

/** Drives the onboarding wizard: current step, chosen method, and navigation,
 *  persisting position so the flow resumes after a reload. Completion flips the
 *  server's `onboarding_completed` (via PATCH /me) and clears local progress —
 *  that server flag, not local state, is what suppresses the resume banner. */
export function useOnboarding(accessToken: string | undefined) {
  const updateProfile = useUpdateProfile(accessToken);
  const [progress, setProgress] = useState(() => {
    // Mark entered on first mount so the one-time first-login auto-redirect does
    // not fire again once the user has seen the flow.
    const initial = readProgress();
    if (!initial.entered) {
      const entered = { ...initial, entered: true };
      writeProgress(entered);
      return entered;
    }
    return initial;
  });

  const commit = useCallback((next: typeof progress) => {
    writeProgress(next);
    setProgress(next);
  }, []);

  const stepIndex = progress.stepIndex;
  const step: OnboardingStep = ONBOARDING_STEPS[stepIndex];

  const goNext = useCallback(() => {
    commit({ ...progress, stepIndex: Math.min(stepIndex + 1, LAST_INDEX) });
  }, [commit, progress, stepIndex]);

  const goBack = useCallback(() => {
    commit({ ...progress, stepIndex: Math.max(stepIndex - 1, 0) });
  }, [commit, progress, stepIndex]);

  const chooseMethod = useCallback(
    (method: OnboardingMethod) => {
      // Record the choice and advance to the setup step in one commit.
      commit({ ...progress, method, stepIndex: Math.min(stepIndex + 1, LAST_INDEX) });
    },
    [commit, progress, stepIndex],
  );

  /** Finish onboarding: persist completion server-side, clear local progress.
   *  Resolves once the server confirms, so the caller can navigate afterward. */
  const complete = useCallback(async () => {
    await updateProfile.mutateAsync({ onboarding_completed: true });
    clearProgress();
  }, [updateProfile]);

  return {
    step,
    stepIndex,
    stepCount: ONBOARDING_STEPS.length,
    method: progress.method,
    goNext,
    goBack,
    chooseMethod,
    complete,
    completing: updateProfile.isPending,
  };
}
