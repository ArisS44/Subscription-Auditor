import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { rememberLanguageChoice } from '@/i18n/language-preference';

const LANGUAGES = ['en', 'el'] as const;

/** Small EN/ΕΛ switch. Shared rather than dashboard-scoped: it is mounted in the
 *  authenticated sidebar AND on every pre-auth surface, so a visitor whose browser
 *  locale disagrees with their preference can switch before they have an account.
 *
 *  Language is a strictly-necessary preference (persisted by i18next's language
 *  detector, whose default caches are localStorage + cookie), so no consent is
 *  required to store it. A click is also recorded as an *explicit* choice, which
 *  is what later gets written to the profile — see `i18n/language-preference.ts`. */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  // i18n.language can be a region variant (e.g. "en-US"); match on the base tag.
  const active = i18n.language.split('-')[0];

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      role="group"
      aria-label={t('language.label')}
    >
      <Globe className="size-4 text-muted-foreground" aria-hidden />
      {LANGUAGES.map((lng) => (
        <Button
          key={lng}
          size="xs"
          variant={active === lng ? 'secondary' : 'ghost'}
          aria-pressed={active === lng}
          onClick={() => {
            rememberLanguageChoice(lng);
            void i18n.changeLanguage(lng);
          }}
        >
          {t(`language.${lng}`)}
        </Button>
      ))}
    </div>
  );
}

/** The pre-auth placement: pinned to the top-right corner, mirroring the
 *  `AuthBrand` lockup pinned top-left, so it sits outside the centred form's flow
 *  on the landing page and the four auth routes. */
export function PinnedLanguageToggle() {
  return <LanguageToggle className="fixed top-6 right-6 z-10" />;
}
