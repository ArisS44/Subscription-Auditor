import { useTranslation } from 'react-i18next';

function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
      <p className="text-muted-foreground">{t('dashboard.placeholder')}</p>
    </div>
  );
}

export default Dashboard;
