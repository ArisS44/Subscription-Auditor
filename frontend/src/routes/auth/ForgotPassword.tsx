import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (resetError) {
      setError(t('auth.forgotPassword.error'));
      return;
    }
    setSentTo(email);
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <h1 className="text-2xl font-semibold">{t('auth.forgotPassword.title')}</h1>
      {sentTo ? (
        <p className="max-w-sm text-muted-foreground">
          {t('auth.forgotPassword.success', { email: sentTo })}
        </p>
      ) : (
        <>
          <p className="max-w-sm text-muted-foreground">{t('auth.forgotPassword.instructions')}</p>
          <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4 text-left">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting}>
              {t('auth.forgotPassword.submit')}
            </Button>
          </form>
        </>
      )}
      <Link to="/login" className="text-sm text-primary underline-offset-4 hover:underline">
        {t('auth.forgotPassword.backToLogin')}
      </Link>
    </div>
  );
}

export default ForgotPassword;
