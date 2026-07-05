import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Signup() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    setSubmitting(false);
    if (signUpError) {
      setError(t('auth.signup.error'));
      return;
    }
    setConfirmationSentTo(email);
  }

  if (confirmationSentTo) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2 bg-background px-4 text-center text-foreground">
        <h1 className="text-2xl font-semibold">{t('auth.signup.checkEmailTitle')}</h1>
        <p className="max-w-sm text-muted-foreground">
          {t('auth.signup.checkEmailBody', { email: confirmationSentTo })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <h1 className="text-2xl font-semibold">{t('auth.signup.title')}</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t('auth.password')}</Label>
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
          {t('auth.signup.submit')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t('auth.signup.hasAccount')}{' '}
        <Link to="/login" className="text-primary underline-offset-4 hover:underline">
          {t('auth.signup.loginCta')}
        </Link>
      </p>
    </div>
  );
}

export default Signup;
