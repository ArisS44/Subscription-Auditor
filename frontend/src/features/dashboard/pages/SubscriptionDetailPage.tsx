import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Subscription detail route (/dashboard/subscriptions/:id). Placeholder this
 *  Task — the real detail view (fed by useSubscription) gets built in a later
 *  Task. It reads the :id param now so the route wiring is proven end-to-end. */
export function SubscriptionDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  return (
    <section className="flex flex-col gap-4">
      <Link
        to="/dashboard/subscriptions"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('dashboard.detail.back')}
      </Link>
      <h1 className="font-heading text-2xl font-semibold">{t('dashboard.detail.title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-sm break-all">{id}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          {t('dashboard.detail.placeholder')}
        </CardContent>
      </Card>
    </section>
  );
}
