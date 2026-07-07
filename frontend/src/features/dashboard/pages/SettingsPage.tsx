import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';

/** Settings tab. Functional shell this Task — real account settings (display
 *  name via PATCH /me, etc.) get wired in a later Task this Stage. */
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">{t('dashboard.settings.title')}</h1>
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {t('dashboard.settings.placeholder')}
        </CardContent>
      </Card>
    </section>
  );
}
