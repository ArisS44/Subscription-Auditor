import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LANGUAGES = ['en', 'el'] as const;

/** Small EN/ΕΛ switch for the sidebar footer. Language is a strictly-necessary
 *  preference (persisted by i18next's language detector), so no consent is
 *  required to store it. */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  // i18n.language can be a region variant (e.g. "en-US"); match on the base tag.
  const active = i18n.language.split('-')[0];

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={t('dashboard.language.label')}
    >
      <Globe className="size-4 text-muted-foreground" aria-hidden />
      {LANGUAGES.map((lng) => (
        <Button
          key={lng}
          size="xs"
          variant={active === lng ? 'secondary' : 'ghost'}
          aria-pressed={active === lng}
          onClick={() => void i18n.changeLanguage(lng)}
        >
          {t(`dashboard.language.${lng}`)}
        </Button>
      ))}
    </div>
  );
}
