import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useMe, useUpdateProfile } from '@/hooks/useMe';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NotificationsCard } from './NotificationsCard';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LANGUAGES,
  createSettingsSchema,
  type PreferredLanguage,
  type SettingsFormValues,
} from './settings-schema';

const languageLabelKey: Record<PreferredLanguage, string> = {
  auto: 'settings.languageAuto',
  en: 'settings.languageEn',
  el: 'settings.languageEl',
};

function toFormValues(
  displayName: string | null | undefined,
  preferred: string | undefined,
): SettingsFormValues {
  return {
    display_name: displayName ?? '',
    preferred_language: (LANGUAGES as readonly string[]).includes(preferred ?? '')
      ? (preferred as PreferredLanguage)
      : 'auto',
  };
}

export function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const { data: profile } = useMe(accessToken);
  const update = useUpdateProfile(accessToken);

  const schema = useMemo(() => createSettingsSchema(t), [t]);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(profile?.display_name, profile?.preferred_language),
  });

  // Populate once the profile loads (useMe is async).
  useEffect(() => {
    if (profile) {
      reset(toFormValues(profile.display_name, profile.preferred_language));
    }
  }, [profile, reset]);

  async function onSubmit(values: SettingsFormValues) {
    try {
      const saved = await update.mutateAsync({
        display_name: values.display_name.trim() ? values.display_name.trim() : null,
        preferred_language: values.preferred_language,
      });
      // Apply the chosen language live (auto leaves the current/detected one).
      if (values.preferred_language !== 'auto') {
        void i18n.changeLanguage(values.preferred_language);
      }
      // Reset dirty state against the saved values so "Saved" can show.
      reset(toFormValues(saved.display_name, saved.preferred_language));
    } catch {
      setError('root', { message: t('settings.saveError') });
    }
  }

  const showSaved = update.isSuccess && !isDirty;

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">{t('dashboard.settings.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.profileTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('settings.profileDescription')}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel>{t('settings.email')}</FieldLabel>
                {/* Disabled + readOnly already conveys that this is not editable;
                    a hint saying so as well is redundant. */}
                <Input value={profile?.email ?? ''} disabled readOnly />
              </Field>

              <Field>
                <FieldLabel htmlFor="display-name">{t('settings.displayName')}</FieldLabel>
                <Input
                  id="display-name"
                  autoComplete="name"
                  placeholder={t('settings.displayNamePlaceholder')}
                  {...register('display_name')}
                />
                <FieldError errors={[errors.display_name]} />
              </Field>

              <Controller
                control={control}
                name="preferred_language"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>{t('settings.language')}</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(v: string) => t(languageLabelKey[v as PreferredLanguage])}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((lng) => (
                          <SelectItem key={lng} value={lng}>
                            {t(languageLabelKey[lng])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              {errors.root && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.root.message}
                </p>
              )}

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={update.isPending || !isDirty}>
                  {t('settings.save')}
                </Button>
                {showSaved && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Check className="size-4" aria-hidden />
                    {t('settings.saved')}
                  </span>
                )}
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <NotificationsCard />

      {/* Attribution required by the CC BY 3.0 licence of the Apollon mark. */}
      <p className="text-xs text-muted-foreground">
        {t('settings.credits.apollon')}{' '}
        <a
          href="https://thenounproject.com/browse/icons/term/apollo/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {t('settings.credits.nounProject')}
        </a>{' '}
        ({t('settings.credits.license')})
      </p>
    </section>
  );
}
