import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';

/** Subscriptions tab. Placeholder content this Task — the real list/table
 *  (fed by useSubscriptions) gets built in a later Task this Stage. */
export function SubscriptionsPage() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">{t('dashboard.subscriptions.title')}</h1>
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {t('dashboard.subscriptions.placeholder')}
        </CardContent>
      </Card>
    </section>
  );
}
