import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const PRESETS = [1, 3, 7, 14] as const;
const MIN = 0;
const MAX = 30;

function isPresetValue(value: number | null): boolean {
  return value !== null && (PRESETS as readonly number[]).includes(value);
}

function clampDays(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Math.trunc(Number(raw));
  if (Number.isNaN(n)) return null;
  return Math.max(MIN, Math.min(MAX, n));
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Presets + custom lead-time picker. Emits days as a number, or `null` when
 *  `allowInherit` is set and the user picks "Inherit" (per-subscription only —
 *  the per-user default itself can't inherit). A value that is not one of the
 *  presets opens the custom number field showing that value. Callers render this
 *  only once their value is known, so the initial custom-open state is correct
 *  without an effect. */
export function LeadTimeChips({
  value,
  onChange,
  allowInherit = false,
  inheritDays,
  label,
  idPrefix = 'lead',
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  allowInherit?: boolean;
  inheritDays?: number;
  label?: string;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  // Open the custom field when the initial value is a concrete non-preset number,
  // or once the user explicitly chooses Custom.
  const [customOpen, setCustomOpen] = useState(value !== null && !isPresetValue(value));

  const isInherit = value === null;
  const activeCustom = customOpen && value !== null;

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {allowInherit && (
          <Chip
            active={isInherit}
            onClick={() => {
              setCustomOpen(false);
              onChange(null);
            }}
          >
            {t('notifications.leadTime.inherit', { days: inheritDays ?? 0 })}
          </Chip>
        )}
        {PRESETS.map((preset) => (
          <Chip
            key={preset}
            active={!isInherit && !activeCustom && value === preset}
            onClick={() => {
              setCustomOpen(false);
              onChange(preset);
            }}
          >
            {t('notifications.leadTime.days', { days: preset })}
          </Chip>
        ))}
        <Chip
          active={activeCustom}
          onClick={() => {
            setCustomOpen(true);
            // Opening custom from inherit/blank seeds a starting value so the
            // field isn't empty; from a preset it keeps that value.
            if (value === null) onChange(inheritDays ?? 3);
          }}
        >
          {t('notifications.leadTime.custom')}
        </Chip>
      </div>

      {activeCustom && (
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-custom`}
            type="number"
            min={MIN}
            max={MAX}
            className="w-24"
            aria-label={t('notifications.leadTime.customLabel')}
            value={value ?? ''}
            onChange={(e) => {
              const next = clampDays(e.target.value);
              if (next !== null) onChange(next);
            }}
          />
          <span className="text-sm text-muted-foreground">
            {t('notifications.leadTime.daysSuffix')}
          </span>
        </div>
      )}
    </div>
  );
}
