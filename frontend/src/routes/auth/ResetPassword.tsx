import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { AuthBrand } from '@/features/auth/AuthBrand';
import { PinnedLanguageToggle } from '@/components/LanguageToggle';
import { PasswordRequirements } from '@/features/auth/PasswordRequirements';
import {
  createResetPasswordSchema,
  type ResetPasswordFormValues,
} from '@/features/auth/auth-schema';
import { updatePasswordErrorKey } from '@/features/auth/auth-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetPassword() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Rebuilt on language change so validation messages follow the active language.
  const schema = useMemo(() => createResetPasswordSchema(t), [t]);
  const {
    register,
    handleSubmit,
    control,
    formState: { isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { password: '' },
  });

  const password = useWatch({ control, name: 'password' }) ?? '';

  async function onSubmit(values: ResetPasswordFormValues) {
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({
      password: values.password,
    });
    if (updateError) {
      setError(t(updatePasswordErrorKey(updateError)));
      return;
    }
    setSuccess(true);
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <AuthBrand />
      <PinnedLanguageToggle />
      <h1 className="text-2xl font-semibold">{t('auth.resetPassword.title')}</h1>
      {success ? (
        <>
          <p className="max-w-sm text-muted-foreground">{t('auth.resetPassword.success')}</p>
          <Link to="/login" className="text-sm text-primary underline-offset-4 hover:underline">
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        </>
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex w-full max-w-sm flex-col gap-4 text-left"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t('auth.newPassword')}</Label>
            {/* No `minLength` attribute: the policy lives in one module so the
                checklist and the schema cannot drift, and a hardcoded number here
                was how this route came to accept passwords the server rejects. */}
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-describedby="password-requirements"
              {...register('password')}
            />
            {/* Same checklist as sign-up, so both surfaces state identical rules. */}
            <PasswordRequirements id="password-requirements" value={password} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isSubmitting}>
            {t('auth.resetPassword.submit')}
          </Button>
        </form>
      )}
    </div>
  );
}

export default ResetPassword;
