import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useMe } from '@/hooks/useMe';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { data: profile, isLoading, isError } = useMe(session?.access_token);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background text-foreground">
      {isLoading && <p className="text-muted-foreground">{t('hello.loading')}</p>}
      {isError && <p className="text-destructive">{t('hello.error')}</p>}
      {profile && (
        <h1 className="text-2xl font-semibold">{t('hello.greeting', { email: profile.email })}</h1>
      )}
      <Button variant="outline" onClick={handleLogout}>
        {t('hello.logout')}
      </Button>
    </div>
  );
}

export default Dashboard;
