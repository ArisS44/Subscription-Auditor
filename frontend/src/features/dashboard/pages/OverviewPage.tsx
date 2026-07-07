import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';

/** Overview tab. Placeholder content this Task — the real analytics summary
 *  (fed by useAnalytics) gets built in a later Task this Stage. */
export function OverviewPage() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">{t('dashboard.overview.title')}</h1>
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {t('dashboard.overview.placeholder')}
        </CardContent>
      </Card>
    </section>
  );
}
