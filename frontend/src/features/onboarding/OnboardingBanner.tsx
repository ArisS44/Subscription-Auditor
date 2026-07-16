import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings2, X } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useMe } from '@/hooks/useMe';
import { Button } from '@/components/ui/button';
import { dismissBannerForSession, isBannerDismissed } from './onboarding-state';

// The slim "continue setup" prompt on the Overview. Shows only while the server
// says onboarding is unfinished (`onboarding_completed === false`) and the user
// hasn't dismissed it this session. Dismiss is session-only — it returns next
// session until onboarding is actually completed, which is the single source of
// truth here (no separate "dismissed forever" flag).
export function OnboardingBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const meQuery = useMe(accessToken);
  const [dismissed, setDismissed] = useState(() => isBannerDismissed());

  // Nothing to show until the profile is loaded; never flash on an unknown state.
  if (!meQuery.data || meQuery.data.onboarding_completed || dismissed) return null;

  function dismiss() {
    dismissBannerForSession();
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
      <Settings2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="flex-1 text-sm text-foreground">{t('onboarding.banner.text')}</p>
      <Button size="sm" onClick={() => navigate('/onboarding')}>
        {t('onboarding.banner.continue')}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label={t('onboarding.banner.dismiss')}
        title={t('onboarding.banner.dismiss')}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
