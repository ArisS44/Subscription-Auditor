import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, BellRing, Check, Loader2, Share } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { usePushSubscribe } from '@/hooks/usePushSubscribe';
import { usePushDevices } from '@/hooks/usePushDevices';
import { isIOS, isPushSupported, isStandalone, notificationPermission } from './push-support';

/** A single explanatory status row — an icon, a title, and a hint line. Used for
 *  every non-actionable state (blocked, unsupported, enabled) so they read
 *  consistently and never as a dead/broken control. */
function StatusRow({
  icon: Icon,
  title,
  hint,
  tone = 'muted',
}: {
  icon: typeof Bell;
  title: string;
  hint: string;
  tone?: 'muted' | 'positive';
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
      <Icon
        className={
          tone === 'positive'
            ? 'mt-0.5 size-5 shrink-0 text-primary'
            : 'mt-0.5 size-5 shrink-0 text-muted-foreground'
        }
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/** iOS grants Web Push only to a site installed to the Home Screen, and offers no
 *  install button — so on an iOS browser tab we can only instruct. Two explicit
 *  numbered steps, since installing is a two-action gesture (Share → Add). */
function IOSInstallHint() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium text-foreground">{t('notifications.optIn.ios.title')}</p>
      <ol className="flex flex-col gap-2">
        <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <StepNumber>1</StepNumber>
          <span className="flex items-center gap-1.5">
            {t('notifications.optIn.ios.step1')}
            <Share className="size-4 text-foreground" aria-hidden />
          </span>
        </li>
        <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <StepNumber>2</StepNumber>
          <span>{t('notifications.optIn.ios.step2')}</span>
        </li>
      </ol>
    </div>
  );
}

function StepNumber({ children }: { children: ReactNode }) {
  return (
    <span
      className="grid size-5 shrink-0 place-content-center rounded-full bg-muted text-xs font-medium text-foreground"
      aria-hidden
    >
      {children}
    </span>
  );
}

/** The notification opt-in. Renders whichever state applies: an install hint on
 *  an iOS tab, an unsupported/blocked notice, an enabled confirmation, or the
 *  actionable "enable" button. Permission is requested on click (a user gesture),
 *  and only on grant do we register + subscribe via {@link usePushSubscribe}.
 *
 *  `bare` strips the framing from the *actionable* state only — no card border and
 *  no description line — for surfaces that already introduce the feature in their
 *  own heading and body, where repeating it reads as duplicated copy. The
 *  informational states keep their bordered row in both variants: unlike the
 *  button, they carry information that needs the frame to read as a notice. */
export function NotificationOptIn({ bare = false }: { bare?: boolean } = {}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const subscribe = usePushSubscribe(accessToken);
  const devicesQuery = usePushDevices(accessToken);
  const [permission, setPermission] = useState(() => notificationPermission());
  // This browser's current push-subscription endpoint: undefined while unknown,
  // null when there is none. Compared against the backend device list so the
  // "on" state survives a reload (it no longer depends on a this-session mutation)
  // and flips back off after the device is revoked.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!isPushSupported()) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) setEndpoint(subscription?.endpoint ?? null);
      })
      .catch(() => {
        if (!cancelled) setEndpoint(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // iOS in a browser tab: must be installed to the Home Screen first.
  if (isIOS() && !isStandalone()) {
    return <IOSInstallHint />;
  }

  if (!isPushSupported() || permission === 'unsupported') {
    return (
      <StatusRow
        icon={BellOff}
        title={t('notifications.optIn.unsupported')}
        hint={t('notifications.optIn.unsupportedHint')}
      />
    );
  }

  if (permission === 'denied') {
    return (
      <StatusRow
        icon={BellOff}
        title={t('notifications.optIn.blocked')}
        hint={t('notifications.optIn.blockedHint')}
      />
    );
  }

  // Registered = this browser's endpoint is one the backend currently stores.
  const registered =
    endpoint != null &&
    (devicesQuery.data?.some((device) => device.endpoint === endpoint) ?? false);
  const enabled = permission === 'granted' && (subscribe.isSuccess || registered);

  if (enabled) {
    return (
      <StatusRow
        icon={Check}
        tone="positive"
        title={t('notifications.optIn.enabled')}
        hint={t('notifications.optIn.enabledHint')}
      />
    );
  }

  // While permission is granted, hold off on the button until we know whether this
  // device is already registered — otherwise it flashes on a reload of an
  // already-enabled device.
  const checking =
    permission === 'granted' &&
    !subscribe.isSuccess &&
    (endpoint === undefined || devicesQuery.isPending);
  if (checking) {
    return (
      <div
        className={
          bare
            ? 'flex items-center justify-center py-2 text-muted-foreground'
            : 'flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-muted-foreground'
        }
        role="status"
        aria-label={t('notifications.optIn.checkingDevice')}
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
      </div>
    );
  }

  async function enable() {
    let result: NotificationPermission = permission === 'granted' ? 'granted' : 'default';
    if (permission !== 'granted') {
      result = await Notification.requestPermission();
      setPermission(result);
    }
    if (result === 'granted') {
      subscribe.mutate();
    }
  }

  const enableButton = (
    <Button onClick={enable} disabled={subscribe.isPending}>
      <Bell aria-hidden />
      {subscribe.isPending ? t('notifications.optIn.enabling') : t('notifications.optIn.enable')}
    </Button>
  );
  const errorLine = subscribe.isError && (
    <p className="text-sm text-destructive">{t('notifications.optIn.error')}</p>
  );

  if (bare) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        {enableButton}
        {errorLine}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('notifications.optIn.description')}</p>
      </div>
      {enableButton}
      {errorLine}
    </div>
  );
}
