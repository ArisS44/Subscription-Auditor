import { useTranslation } from 'react-i18next';
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PASSWORD_RULES } from './password-policy';

/** The live password checklist: every rule is listed from the start and ticks off
 *  as the user types, so the requirements are visible *before* they are failed
 *  rather than appearing as errors afterwards.
 *
 *  Accessibility: the list is a status region so a screen reader announces rules
 *  as they are satisfied, and each item carries a text label for its met/unmet
 *  state — colour and icon alone would not convey it. */
export function PasswordRequirements({ value, id }: { value: string; id?: string }) {
  const { t } = useTranslation();

  return (
    <ul id={id} className="flex flex-col gap-1" aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li key={rule.id} className="flex items-center gap-2 text-xs">
            {met ? (
              <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
            ) : (
              <Circle className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
            )}
            <span className={cn(met ? 'text-foreground' : 'text-muted-foreground')}>
              {t(`auth.passwordPolicy.${rule.id}`)}
            </span>
            <span className="sr-only">
              {met ? t('auth.passwordPolicy.met') : t('auth.passwordPolicy.notMet')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
