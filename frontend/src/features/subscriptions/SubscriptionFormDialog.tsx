import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useCreateSubscription,
  useUpdateSubscription,
  type Subscription,
} from '@/hooks/useSubscriptions';
import {
  BILLING_CYCLES,
  CATEGORIES,
  CURRENCIES,
  NO_CATEGORY,
  createSubscriptionSchema,
  formValuesToPayload,
  type SubscriptionFormValues,
} from './subscription-schema';
import { DatePicker } from './DatePicker';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toFormValues(subscription?: Subscription): SubscriptionFormValues {
  if (!subscription) {
    return {
      name: '',
      category: NO_CATEGORY,
      price: '',
      currency: 'USD',
      billing_cycle: 'monthly',
      start_date: todayIso(),
      next_renewal_date: '',
      notes: '',
    };
  }
  return {
    name: subscription.name,
    category: subscription.category ?? NO_CATEGORY,
    price: subscription.price,
    currency: subscription.currency,
    billing_cycle: subscription.billing_cycle,
    start_date: subscription.start_date,
    next_renewal_date: subscription.next_renewal_date ?? '',
    notes: subscription.notes ?? '',
  };
}

/** Add/edit modal. One instance serves both: pass `subscription` to edit
 *  (pre-filled, PATCH) or omit it to create (blank, POST). Validation is
 *  react-hook-form + Zod (UX only — the backend re-validates). */
export function SubscriptionFormDialog({
  open,
  onOpenChange,
  subscription,
  accessToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: Subscription;
  accessToken: string | undefined;
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(subscription);
  const create = useCreateSubscription(accessToken);
  const update = useUpdateSubscription(accessToken);
  const pending = create.isPending || update.isPending;

  const schema = useMemo(() => createSubscriptionSchema(t), [t]);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<SubscriptionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(subscription),
  });

  // Repopulate when the dialog opens (or targets a different row), so an edit
  // shows that row's values and a fresh add starts blank.
  useEffect(() => {
    if (open) {
      reset(toFormValues(subscription));
    }
  }, [open, subscription, reset]);

  // Keep an out-of-list currency (the backend allows any code) selectable.
  const currencyOptions = useMemo(() => {
    const code = subscription?.currency;
    return code && !CURRENCIES.includes(code as (typeof CURRENCIES)[number])
      ? [code, ...CURRENCIES]
      : [...CURRENCIES];
  }, [subscription]);

  async function onSubmit(values: SubscriptionFormValues) {
    const payload = formValuesToPayload(values);
    try {
      if (subscription) {
        await update.mutateAsync({ id: subscription.id, input: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      setError('root', { message: t('subscriptions.form.submitError') });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? t('subscriptions.form.editTitle') : t('subscriptions.form.addTitle')}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? t('subscriptions.form.editDescription')
                : t('subscriptions.form.addDescription')}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="max-h-[60vh] gap-4 overflow-y-auto py-4">
            <Field>
              <FieldLabel htmlFor="sub-name">{t('subscriptions.form.fields.name')}</FieldLabel>
              <Input id="sub-name" autoComplete="off" {...register('name')} />
              <FieldError errors={[errors.name]} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="sub-price">{t('subscriptions.form.fields.price')}</FieldLabel>
                <Input
                  id="sub-price"
                  inputMode="decimal"
                  placeholder="0.00"
                  {...register('price')}
                />
                <FieldError errors={[errors.price]} />
              </Field>
              <Controller
                control={control}
                name="currency"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>{t('subscriptions.form.fields.currency')}</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {currencyOptions.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Controller
                control={control}
                name="billing_cycle"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>{t('subscriptions.form.fields.billingCycle')}</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(value: string) => t(`subscriptions.cycle.${value}`)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {BILLING_CYCLES.map((cycle) => (
                          <SelectItem key={cycle} value={cycle}>
                            {t(`subscriptions.cycle.${cycle}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>{t('subscriptions.form.fields.category')}</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(value: string) =>
                            value
                              ? t(`subscriptions.category.${value}`)
                              : t('subscriptions.form.categoryNone')
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>
                          {t('subscriptions.form.categoryNone')}
                        </SelectItem>
                        {CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {t(`subscriptions.category.${category}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Controller
                control={control}
                name="start_date"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="sub-start">
                      {t('subscriptions.form.fields.startDate')}
                    </FieldLabel>
                    <DatePicker
                      id="sub-start"
                      value={field.value}
                      onChange={field.onChange}
                      ariaInvalid={Boolean(errors.start_date)}
                    />
                    <FieldError errors={[errors.start_date]} />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="next_renewal_date"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="sub-renewal">
                      {t('subscriptions.form.fields.nextRenewalDate')}
                    </FieldLabel>
                    <DatePicker
                      id="sub-renewal"
                      value={field.value}
                      onChange={field.onChange}
                      ariaInvalid={Boolean(errors.next_renewal_date)}
                    />
                    <FieldError errors={[errors.next_renewal_date]} />
                  </Field>
                )}
              />
            </div>
            <FieldDescription>{t('subscriptions.form.fields.nextRenewalHint')}</FieldDescription>

            <Field>
              <FieldLabel htmlFor="sub-notes">{t('subscriptions.form.fields.notes')}</FieldLabel>
              <Textarea id="sub-notes" rows={3} {...register('notes')} />
              <FieldError errors={[errors.notes]} />
            </Field>

            {errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {errors.root.message}
              </p>
            )}
          </FieldGroup>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t('subscriptions.form.cancel')}
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {isEdit ? t('subscriptions.form.submitEdit') : t('subscriptions.form.submitCreate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
