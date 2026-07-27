import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useMe, useUpdateProfile } from '@/hooks/useMe';
import { usePushDevices, useRevokePushDevice, type PushDevice } from '@/hooks/usePushDevices';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { NotificationOptIn } from '@/features/notifications/NotificationOptIn';
import { LeadTimeChips } from '@/features/notifications/LeadTimeChips';

/** The Settings notifications surface. There is no standalone "reminders on/off"
 *  flag in the model — enablement *is* having a registered device — so this is
 *  built from the opt-in, the per-user lead time, and the device list, plus the
 *  monthly-review control left disabled (read-only, feature ships later). */
export function NotificationsCard() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const { data: profile } = useMe(accessToken);
  const update = useUpdateProfile(accessToken);

  function onLeadChange(value: number | null) {
    // The per-user default is always a concrete number; inherit/null is only a
    // per-subscription concept, so a null here is ignored defensively.
    if (value === null) return;
    update.mutate({ renewal_lead_days: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.notifications.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('settings.notifications.description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Opt-in: registering this device is what turns reminders on. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('settings.notifications.deviceTitle')}</h3>
          <NotificationOptIn />
        </section>

        {/* Per-user default lead time. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('settings.notifications.leadTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('settings.notifications.leadHint')}</p>
          {profile && (
            <LeadTimeChips
              value={profile.renewal_lead_days}
              onChange={onLeadChange}
              label={t('settings.notifications.leadTitle')}
              idPrefix="user-lead"
            />
          )}
        </section>

        {/* Registered devices with per-device revocation. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('settings.notifications.devicesTitle')}</h3>
          <DeviceList accessToken={accessToken} language={i18n.language} />
        </section>

        {/* Not-yet-built controls stay visibly disabled so they read as
            "not active", never broken. monthly_review_enabled is read-only. */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t('settings.notifications.comingSoonTitle')}
            </h3>
            <Badge variant="outline">{t('dashboard.comingSoon.badge')}</Badge>
          </div>
          <DisabledPref
            label={t('settings.notifications.weeklySummary')}
            hint={t('settings.notifications.weeklySummaryHint')}
            checked={false}
          />
          <DisabledPref
            label={t('settings.notifications.monthlyInsights')}
            hint={t('settings.notifications.monthlyInsightsHint')}
            checked={profile?.monthly_review_enabled ?? false}
          />
        </section>
      </CardContent>
    </Card>
  );
}

function DisabledPref({ label, hint, checked }: { label: string; hint: string; checked: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
      <Switch disabled checked={checked} aria-label={label} />
    </div>
  );
}

function DeviceList({
  accessToken,
  language,
}: {
  accessToken: string | undefined;
  language: string;
}) {
  const { t } = useTranslation();
  const devicesQuery = usePushDevices(accessToken);
  const revoke = useRevokePushDevice(accessToken);

  if (devicesQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground">{t('settings.notifications.devicesLoading')}</p>
    );
  }
  if (devicesQuery.isError) {
    return <p className="text-sm text-destructive">{t('settings.notifications.devicesError')}</p>;
  }
  if (devicesQuery.data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('settings.notifications.devicesEmpty')}</p>
    );
  }

  const dateFmt = new Intl.DateTimeFormat(language, { dateStyle: 'medium' });

  return (
    <ul className="flex flex-col gap-2">
      {devicesQuery.data.map((device: PushDevice) => (
        <li
          key={device.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">
              {device.user_agent || t('settings.notifications.deviceUnknown')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('settings.notifications.deviceAdded', {
                date: dateFmt.format(new Date(device.created_at)),
              })}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('settings.notifications.deviceRevoke')}
            title={t('settings.notifications.deviceRevoke')}
            disabled={revoke.isPending && revoke.variables === device.endpoint}
            onClick={() => revoke.mutate(device.endpoint)}
          >
            <Trash2 aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
