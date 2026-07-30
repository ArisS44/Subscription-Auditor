import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase, setRememberMe } from '@/lib/supabase';
import { AuthBrand } from '@/features/auth/AuthBrand';
import { PinnedLanguageToggle } from '@/components/LanguageToggle';
import { Turnstile, type TurnstileHandle } from '@/features/auth/Turnstile';
import { createLoginSchema, type LoginFormValues } from '@/features/auth/auth-schema';
import { signInErrorKey } from '@/features/auth/auth-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [rememberMe, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Turnstile token: required before submit, single-use (reset after each try).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);

  // Rebuilt on language change so validation messages follow the active language.
  const schema = useMemo(() => createLoginSchema(t), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });

  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/dashboard';

  async function onSubmit(values: LoginFormValues) {
    if (!captchaToken) return;
    setError(null);
    setRememberMe(rememberMe);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
      options: { captchaToken },
    });
    if (signInError) {
      setError(t(signInErrorKey(signInError)));
      // The token was consumed by this attempt — force a fresh challenge.
      captchaRef.current?.reset();
      setCaptchaToken(null);
      return;
    }
    navigate(from, { replace: true });
  }

  async function handleGoogleLogin() {
    setRememberMe(rememberMe);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <AuthBrand />
      <PinnedLanguageToggle />
      <h1 className="text-2xl font-semibold">{t('auth.login.title')}</h1>
      <form
        // Wrapped rather than `handleSubmit(onSubmit)` directly: onSubmit reads the
        // Turnstile ref, and building the handler during render counts as touching
        // that ref in render. Wrapping defers it to the submit event.
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        noValidate
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t('auth.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email && (
            <p id="email-error" className="text-sm text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
          {errors.password && (
            <p id="password-error" className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="remember-me">
            <Checkbox
              id="remember-me"
              checked={rememberMe}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            {t('auth.rememberMe')}
          </Label>
          <Link
            to="/forgot-password"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('auth.login.forgotPassword')}
          </Link>
        </div>
        <Turnstile
          ref={captchaRef}
          onVerify={setCaptchaToken}
          onExpire={() => setCaptchaToken(null)}
          onError={() => {
            setCaptchaToken(null);
            setError(t('auth.captcha.error'));
          }}
          language={i18n.language}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={isSubmitting || !captchaToken}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <div className="flex w-full max-w-sm items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t('auth.orDivider')}
        <div className="h-px flex-1 bg-border" />
      </div>
      <Button variant="outline" className="w-full max-w-sm" onClick={handleGoogleLogin}>
        {t('auth.login.googleCta')}
      </Button>
      <p className="text-sm text-muted-foreground">
        {t('auth.login.noAccount')}{' '}
        <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
          {t('auth.login.signupCta')}
        </Link>
      </p>
    </div>
  );
}

export default Login;
