import { afterEach, describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  clearProgress,
  dismissBannerForSession,
  isBannerDismissed,
  readProgress,
  writeProgress,
} from './onboarding-state';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('onboarding progress persistence', () => {
  it('returns a fresh default when nothing is stored', () => {
    expect(readProgress()).toEqual({ stepIndex: 0, method: null, entered: false });
  });

  it('round-trips a written progress', () => {
    writeProgress({ stepIndex: 2, method: 'manual', entered: true });
    expect(readProgress()).toEqual({ stepIndex: 2, method: 'manual', entered: true });
  });

  it('clamps an out-of-range step index to the valid range', () => {
    writeProgress({ stepIndex: 999, method: null, entered: true });
    expect(readProgress().stepIndex).toBe(ONBOARDING_STEPS.length - 1);
    writeProgress({ stepIndex: -5, method: null, entered: true });
    expect(readProgress().stepIndex).toBe(0);
  });

  it('recovers to the default on corrupt storage', () => {
    localStorage.setItem('auditor.onboarding', '{not json');
    expect(readProgress()).toEqual({ stepIndex: 0, method: null, entered: false });
  });

  it('clearProgress wipes stored progress and the banner dismissal', () => {
    writeProgress({ stepIndex: 3, method: 'chat', entered: true });
    dismissBannerForSession();
    clearProgress();
    expect(readProgress().entered).toBe(false);
    expect(isBannerDismissed()).toBe(false);
  });
});

describe('banner session dismissal', () => {
  it('is not dismissed by default and sticks once dismissed', () => {
    expect(isBannerDismissed()).toBe(false);
    dismissBannerForSession();
    expect(isBannerDismissed()).toBe(true);
  });
});
