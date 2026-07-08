import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { el as elLocale, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Parse/serialize as *local* dates (new Date(y, m-1, d)) to avoid the UTC-parsing
// off-by-one that `new Date('2026-07-01')` causes in negative-offset timezones.
function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Display as DD/MM/YYYY (day-first) for both locales — the app is EU/euro-first,
// and Greek uses the same day-first ordering.
function displayDate(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

/** A date field that matches the app's styling: a Popover with the design
 *  system's Calendar inside. Value is an ISO `YYYY-MM-DD` string (what the API
 *  wants); the trigger shows it as DD/MM/YYYY and the calendar's month/day names
 *  follow the active language. */
export function DatePicker({
  id,
  value,
  onChange,
  ariaInvalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  ariaInvalid?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  const locale = i18n.language.startsWith('el') ? elLocale : enUS;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            id={id}
            aria-invalid={ariaInvalid}
            className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
          />
        }
      >
        {value ? displayDate(value) : t('subscriptions.form.datePlaceholder')}
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          locale={locale}
          autoFocus
          onSelect={(date) => {
            if (date) {
              onChange(toIsoDate(date));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
