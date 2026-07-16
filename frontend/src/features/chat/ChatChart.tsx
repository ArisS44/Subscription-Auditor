import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '@/lib/format';
import { humanizeLabel } from './labels';
import type { ChartPayload } from './structured';

// Renders a grounded chart payload from the assistant. The chart TYPE is chosen
// by the backend (chart_type), not here — this component only draws whatever it
// is handed. It deliberately mirrors the dashboard's CategorySpendChart: the same
// categorical --chart-* palette, the same compact-currency axis ticks with
// full-precision tooltips, the same recessive grid/axis styling — so a chart in
// chat reads as the same family as a chart on the Overview.

// The design system's categorical ramp (CVD-validated light + dark, see
// index.css). Assigned by point index; charts always show the point label too,
// so identity never rests on colour alone. Beyond five points the ramp repeats —
// acceptable only because the label is the primary encoding on every mark.
const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function colorAt(index: number): string {
  return PALETTE[index % PALETTE.length];
}

interface ChartRow {
  label: string;
  value: number;
  color: string;
}

// Money when the payload carries a currency, a plain grouped number otherwise.
function formatValue(value: number, currency: string | undefined, locale: string): string {
  return currency ? formatCurrency(value, currency, locale) : formatNumber(value, locale);
}

function tickFormatter(currency: string | undefined, locale: string) {
  return (value: number) =>
    currency
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(value)
      : formatNumber(value, locale, true);
}

interface TooltipEntry {
  payload: ChartRow;
  value: number;
}

function ChartTooltip({
  active,
  payload,
  currency,
  locale,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  currency: string | undefined;
  locale: string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0];
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <div className="flex items-center gap-1.5 font-medium">
        <span
          className="size-2.5 rounded-[2px]"
          style={{ backgroundColor: datum.payload.color }}
          aria-hidden
        />
        {datum.payload.label}
      </div>
      <div className="text-muted-foreground">{formatValue(datum.value, currency, locale)}</div>
    </div>
  );
}

export function ChatChart({ payload, height = 240 }: { payload: ChartPayload; height?: number }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { chart_type, currency, title } = payload;

  // Humanize labels once, here — axis, tooltip, and legend all read `label`, so a
  // raw category key like `ai_tool` is turned into its localized name in one place.
  const data: ChartRow[] = payload.points.map((p, i) => ({
    label: humanizeLabel(p.label, t),
    value: p.value,
    color: colorAt(i),
  }));

  const axisTick = { fontSize: 12, fill: 'var(--muted-foreground)' };
  const tooltip = (
    <Tooltip
      content={<ChartTooltip currency={currency} locale={locale} />}
      cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
    />
  );

  let chart: React.ReactNode;

  if (chart_type === 'pie' || chart_type === 'donut') {
    chart = (
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={chart_type === 'donut' ? '55%' : 0}
          outerRadius="80%"
          paddingAngle={data.length > 1 ? 2 : 0}
          stroke="var(--card)"
          strokeWidth={2}
        >
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} />
          ))}
        </Pie>
        {tooltip}
      </PieChart>
    );
  } else if (chart_type === 'line') {
    chart = (
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={tickFormatter(currency, locale)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        {tooltip}
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 3, fill: 'var(--chart-1)' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    );
  } else if (chart_type === 'column') {
    chart = (
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={tickFormatter(currency, locale)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        {tooltip}
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    );
  } else {
    // Horizontal bars (default) — best for long labels like category names.
    chart = (
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          tickFormatter={tickFormatter(currency, locale)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={104}
        />
        {tooltip}
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    );
  }

  return (
    <figure className="my-1 w-full">
      {title && (
        <figcaption className="mb-2 text-sm font-medium text-foreground">{title}</figcaption>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {chart}
      </ResponsiveContainer>
    </figure>
  );
}
