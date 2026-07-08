import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { AuthBrand } from '@/features/auth/AuthBrand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetPassword() {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(t('auth.resetPassword.error'));
      return;
    }
    setSuccess(true);
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <AuthBrand />
      <h1 className="text-2xl font-semibold">{t('auth.resetPassword.title')}</h1>
      {success ? (
        <>
          <p className="max-w-sm text-muted-foreground">{t('auth.resetPassword.success')}</p>
          <Link to="/login" className="text-sm text-primary underline-offset-4 hover:underline">
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4 text-left">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t('auth.newPassword')}</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {t('auth.resetPassword.submit')}
          </Button>
        </form>
      )}
    </div>
  );
}

export default ResetPassword;
