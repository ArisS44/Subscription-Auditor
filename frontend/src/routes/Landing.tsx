import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';

function Landing() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <h1 className="text-3xl font-semibold">{t('landing.title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('landing.subtitle')}</p>
      <Link to="/dashboard" className={buttonVariants()}>
        {t('landing.cta')}
      </Link>
    </div>
  );
}

export default Landing;
