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

/** Whether the `setup` step has content for a given method. A null method is
 *  treated as "no", so corrupted or pre-existing stored progress pointing at
 *  `setup` resolves forward instead of rendering an empty step. */
function methodNeedsSetup(method: OnboardingMethod | null): boolean {
  return method === 'chat' || method === 'manual';
}

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

  // The setup step only has something to show for the chat and manual methods.
  // Skipping used to land on a reassurance screen that just restated what the
  // "Skip for now" option had already said — a slide with nothing on it. The step
  // is now bypassed in both directions instead.
  const setupApplies = methodNeedsSetup(progress.method);

  /** Clamp an index into range, stepping over `setup` when it has no content.
   *  `direction` is which way the user was travelling, so the bypass continues
   *  their movement rather than bouncing them back where they came from. */
  const resolveIndex = useCallback(
    (index: number, direction: 1 | -1): number => {
      const clamped = Math.min(Math.max(index, 0), LAST_INDEX);
      if (ONBOARDING_STEPS[clamped] === 'setup' && !setupApplies) {
        return Math.min(Math.max(clamped + direction, 0), LAST_INDEX);
      }
      return clamped;
    },
    [setupApplies],
  );

  // Resolved rather than raw: stored progress can point at `setup` for a user who
  // chose skip in an earlier session, and resuming must not drop them onto the
  // step we just removed from their path.
  const stepIndex = resolveIndex(progress.stepIndex, 1);
  const step: OnboardingStep = ONBOARDING_STEPS[stepIndex];

  const goNext = useCallback(() => {
    commit({ ...progress, stepIndex: resolveIndex(stepIndex + 1, 1) });
  }, [commit, progress, resolveIndex, stepIndex]);

  const goBack = useCallback(() => {
    commit({ ...progress, stepIndex: resolveIndex(stepIndex - 1, -1) });
  }, [commit, progress, resolveIndex, stepIndex]);

  const chooseMethod = useCallback(
    (method: OnboardingMethod) => {
      // Record the choice and advance in one commit. The bypass is computed from
      // the method being chosen now, not the one in state — that write has not
      // landed yet.
      const next = stepIndex + 1;
      const target =
        ONBOARDING_STEPS[next] === 'setup' && !methodNeedsSetup(method) ? next + 1 : next;
      commit({ ...progress, method, stepIndex: Math.min(target, LAST_INDEX) });
    },
    [commit, progress, stepIndex],
  );

  // The progress rail should count the steps this user will actually see, so a
  // skipping user gets five evenly-advancing dots rather than six with a jump.
  //
  // Keyed on an explicit 'skip' rather than on `setupApplies`: a null method means
  // the user has not chosen yet (they are still on welcome or method), and the
  // rail must not shrink before there is a decision behind it.
  // Annotated rather than inferred: `filter` narrows the literal union to exclude
  // 'setup', which then rejects `indexOf(step)` for the wider step type.
  const railSteps: readonly OnboardingStep[] =
    progress.method === 'skip' ? ONBOARDING_STEPS.filter((s) => s !== 'setup') : ONBOARDING_STEPS;

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
    // Rail position within the steps this user's path actually includes.
    railIndex: railSteps.indexOf(step),
    railCount: railSteps.length,
    method: progress.method,
    goNext,
    goBack,
    chooseMethod,
    complete,
    completing: updateProfile.isPending,
  };
}
