import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Pencil } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useSubscription, type Subscription } from '@/hooks/useSubscriptions';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { perPeriodPrice, statusBadgeVariant } from './display';
import { SubscriptionRowActions } from './SubscriptionRowActions';
import { SubscriptionFormDialog } from './SubscriptionFormDialog';

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

// The usage sections need browser-extension data that doesn't exist until a
// later session — render honest, understated placeholders, never fake numbers.
function UsagePlaceholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {t('subscriptions.detail.usage.placeholder')}
      </CardContent>
    </Card>
  );
}

/** Subscription detail: all fields (literal money), edit/cancel/delete actions,
 *  and explicit placeholders for the usage analytics that arrive in a later
 *  session. */
export function SubscriptionDetail() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const { data: sub, isLoading, isError } = useSubscription(accessToken, id);
  const [formOpen, setFormOpen] = useState(false);

  const backLink = (
    <Link
      to="/dashboard/subscriptions"
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {t('dashboard.detail.back')}
    </Link>
  );

  if (isLoading) {
    return (
      <section className="flex flex-col gap-4">
        {backLink}
        <Card className="py-10 text-center text-sm text-muted-foreground">
          {t('hello.loading')}
        </Card>
      </section>
    );
  }

  if (isError || !sub) {
    return (
      <section className="flex flex-col gap-4">
        {backLink}
        <Card className="py-10 text-center text-sm text-destructive">
          {t('subscriptions.detail.loadError')}
        </Card>
      </section>
    );
  }

  const detail: Subscription = sub;

  return (
    <section className="flex flex-col gap-4">
      {backLink}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold">{detail.name}</h1>
          <Badge variant={statusBadgeVariant(detail.status)}>
            {t(`subscriptions.status.${detail.status}`)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setFormOpen(true)}>
            <Pencil aria-hidden />
            {t('subscriptions.actions.edit')}
          </Button>
          <SubscriptionRowActions
            subscription={detail}
            accessToken={accessToken}
            onEdit={() => setFormOpen(true)}
            onDeleted={() => navigate('/dashboard/subscriptions')}
          />
        </div>
      </div>

      <Card>
        <CardContent>
          <dl>
            <DetailRow label={t('subscriptions.detail.price')}>
              {perPeriodPrice(detail, i18n.language, t)}
            </DetailRow>
            <DetailRow label={t('subscriptions.detail.category')}>
              {detail.category
                ? t(`subscriptions.category.${detail.category}`)
                : t('subscriptions.category.none')}
            </DetailRow>
            <DetailRow label={t('subscriptions.detail.startDate')}>
              {formatDate(detail.start_date, i18n.language)}
            </DetailRow>
            <DetailRow label={t('subscriptions.detail.nextRenewal')}>
              {detail.next_renewal_date
                ? formatDate(detail.next_renewal_date, i18n.language)
                : t('subscriptions.detail.notSet')}
            </DetailRow>
            <DetailRow label={t('subscriptions.detail.created')}>
              {formatDate(detail.created_at, i18n.language)}
            </DetailRow>
            <DetailRow label={t('subscriptions.detail.manageUrl')}>
              {detail.manage_url ? (
                <a
                  href={detail.manage_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-xs items-center gap-1 truncate text-primary underline-offset-4 hover:underline"
                >
                  <span className="truncate">{t('subscriptions.detail.manageUrlLink')}</span>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
              ) : (
                <span className="font-normal text-muted-foreground">
                  {t('subscriptions.detail.notSet')}
                </span>
              )}
            </DetailRow>
            <DetailRow label={t('subscriptions.detail.notes')}>
              {detail.notes ? (
                <span className="font-normal whitespace-pre-wrap">{detail.notes}</span>
              ) : (
                <span className="font-normal text-muted-foreground">
                  {t('subscriptions.detail.noNotes')}
                </span>
              )}
            </DetailRow>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-semibold">
          {t('subscriptions.detail.usage.title')}
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <UsagePlaceholder titleKey="subscriptions.detail.usage.chart" />
          <UsagePlaceholder titleKey="subscriptions.detail.usage.heatmap" />
          <UsagePlaceholder titleKey="subscriptions.detail.usage.costPerHour" />
        </div>
      </div>

      <SubscriptionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        subscription={detail}
        accessToken={accessToken}
      />
    </section>
  );
}
