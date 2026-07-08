import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';

/** Brand lockup for the auth pages so a visitor knows what site they're on.
 *  Pinned to the top-left of the page (out of the form's flow) and sized as a
 *  site logo, so it reads as the brand rather than part of the auth form. Links
 *  back to the landing page. */
export function AuthBrand() {
  const { t } = useTranslation();
  return (
    <Link
      to="/"
      aria-label={t('landing.title')}
      className="fixed top-6 left-6 z-10 flex items-center gap-2.5"
    >
      <span className="grid size-10 shrink-0 place-content-center rounded-xl bg-primary/15 text-primary">
        <Wallet className="size-6" aria-hidden />
      </span>
      <span className="font-heading text-2xl font-semibold tracking-tight">
        {t('landing.title')}
      </span>
    </Link>
  );
}
