import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** Shared placeholder for tabs that are visible but not yet built (Reports,
 *  Chat). Reads clearly as "coming soon" without dressing it up: the tab's own
 *  icon, muted, alongside a short note. `titleKey`/`bodyKey` are i18n keys so
 *  both locales are covered. */
export function ComingSoonPage({
  icon: Icon,
  titleKey,
  bodyKey,
}: {
  icon: LucideIcon;
  titleKey: string;
  bodyKey: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-2xl font-semibold">{t(titleKey)}</h1>
        <Badge variant="outline">{t('dashboard.comingSoon.badge')}</Badge>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-5">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="max-w-prose text-sm text-muted-foreground">{t(bodyKey)}</p>
      </div>
    </section>
  );
}
