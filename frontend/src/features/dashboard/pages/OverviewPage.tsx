import { OverviewPanel } from '@/features/analytics/OverviewPanel';
import { OnboardingBanner } from '@/features/onboarding/OnboardingBanner';

/** Overview tab route. A resume-setup banner sits above the analytics panel while
 *  onboarding is unfinished; it renders nothing once onboarding is complete. */
export function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <OnboardingBanner />
      <OverviewPanel />
    </div>
  );
}
