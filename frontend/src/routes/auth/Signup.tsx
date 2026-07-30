import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { AuthBrand } from '@/features/auth/AuthBrand';
import { PinnedLanguageToggle } from '@/components/LanguageToggle';
import { Turnstile, type TurnstileHandle } from '@/features/auth/Turnstile';
import { PasswordRequirements } from '@/features/auth/PasswordRequirements';
import { createSignupSchema, type SignupFormValues } from '@/features/auth/auth-schema';
import { signUpErrorKey } from '@/features/auth/auth-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Signup() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  // Turnstile token: required before submit, single-use (reset after each try).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);

  // Rebuilt on language change so validation messages follow the active language.
  const schema = useMemo(() => createSignupSchema(t), [t]);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(schema),
    // Validate as the user types so the checklist and the field agree; until the
    // first submit this stays quiet, which is what onTouched buys us.
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });

  // useWatch rather than watch(): it subscribes to this one field, so typing the
  // password re-renders the checklist without re-rendering the whole form.
  const password = useWatch({ control, name: 'password' }) ?? '';

  async function onSubmit(values: SignupFormValues) {
    if (!captchaToken) return;
    setError(null);
    const { error: signUpError } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { captchaToken },
    });
    if (signUpError) {
      setError(t(signUpErrorKey(signUpError)));
      // The token was consumed by this attempt — force a fresh challenge.
      captchaRef.current?.reset();
      setCaptchaToken(null);
      return;
    }
    setConfirmationSentTo(values.email);
  }

  if (confirmationSentTo) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2 bg-background px-4 text-center text-foreground">
        <AuthBrand />
        <PinnedLanguageToggle />
        <h1 className="text-2xl font-semibold">{t('auth.signup.checkEmailTitle')}</h1>
        <p className="max-w-sm text-muted-foreground">
          {t('auth.signup.checkEmailBody', { email: confirmationSentTo })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <AuthBrand />
      <PinnedLanguageToggle />
      <h1 className="text-2xl font-semibold">{t('auth.signup.title')}</h1>
      <form
        // See Login: onSubmit reads the Turnstile ref, so the handler is built at
        // submit time rather than during render.
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
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby="password-requirements"
            {...register('password')}
          />
          {/* The checklist is the diagnostic: it already names every unmet rule, so
              repeating them as a field error underneath would just duplicate it. */}
          <PasswordRequirements id="password-requirements" value={password} />
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
