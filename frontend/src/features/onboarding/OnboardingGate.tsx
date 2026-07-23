import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useMe } from '@/hooks/useMe';
import { Button } from '@/components/ui/button';
import { readProgress } from './onboarding-state';

/** Resolves the onboarding decision *before* the dashboard renders.
 *
 *  The dashboard and its data queries must not mount for a user who should be in
 *  onboarding, so this gate wraps the shell and decides during render rather than
 *  in a post-fetch effect inside the shell. A brand-new user (onboarding
 *  unfinished server-side, and who has never entered the flow) is redirected into
 *  the wizard; everyone else — including a user who exited mid-flow, whose
 *  `entered` flag suppresses the redirect so they resume via the Overview banner
 *  — falls through to the dashboard.
 *
 *  Because the decision needs the profile, the gate owns the loading and error
 *  states: while `/me` is in flight nothing downstream mounts, and if it fails we
 *  surface an explicit error with a retry instead of silently leaving the user
 *  un-onboarded (which is what the old effect-based guard did — its condition
 *  required truthy data, so a failed fetch simply never redirected). */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const meQuery = useMe(session?.access_token);

  if (meQuery.isPending) {
    return (
      <div
        className="flex h-svh items-center justify-center bg-background text-muted-foreground"
        role="status"
        aria-label={t('onboarding.gate.loading')}
      >
        <Loader2 className="size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  if (meQuery.isError) {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <AlertTriangle className="size-8 text-destructive" aria-hidden />
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-lg font-semibold">{t('onboarding.gate.errorTitle')}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{t('onboarding.gate.errorBody')}</p>
        </div>
        <Button onClick={() => void meQuery.refetch()} disabled={meQuery.isFetching}>
          {t('onboarding.gate.retry')}
        </Button>
      </div>
    );
  }

  // Profile in hand. Redirect a brand-new user into onboarding exactly once; the
  // `entered` flag (set on first wizard mount, persisted locally) means a user who
  // left mid-flow is not force-walked back in.
  if (!meQuery.data.onboarding_completed && !readProgress().entered) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
