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
    // Centred in the content area rather than sitting in the top-left corner: with
    // nothing else on the page, left-aligned copy reads as a page that failed to
    // load. `min-h-full` + `justify-center` keeps it optically centred without
    // inflating it into a hero.
    <section className="flex min-h-full flex-col items-center justify-center gap-4 py-10">
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-2xl font-semibold">{t(titleKey)}</h1>
        <Badge variant="outline">{t('dashboard.comingSoon.badge')}</Badge>
      </div>
      {/* Contents centred within the card too, so the icon and copy sit as one
          block instead of hugging the left edge with dead space beside them. */}
      <div className="flex max-w-prose flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-5 text-center">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t(bodyKey)}</p>
      </div>
    </section>
  );
}
