import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/format';

export type ChartType = 'bar' | 'column' | 'donut';

export interface CategoryDatum {
  key: string;
  label: string;
  amount: number;
  color: string;
}

// Compact currency for axis ticks (e.g. "€26"), full precision in the tooltip.
function compactCurrency(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

interface TooltipEntry {
  payload: CategoryDatum;
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
  currency: string;
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
      <div className="text-muted-foreground">{formatCurrency(datum.value, currency, locale)}</div>
    </div>
  );
}

/** Reusable spend-by-category chart. Renders the same data as a horizontal bar,
 *  vertical column, or donut — colours are fixed per category so switching type
 *  keeps identities stable. One currency per chart (money is never converted).
 *  Decoupled from the Overview page so it can be reused (e.g. in-chat charts). */
export function CategorySpendChart({
  data,
  currency,
  type,
  locale,
  height = 260,
}: {
  data: CategoryDatum[];
  currency: string;
  type: ChartType;
  locale: string;
  height?: number;
}) {
  const tooltip = <Tooltip content={<ChartTooltip currency={currency} locale={locale} />} />;
  const axisTick = { fontSize: 12, fill: 'var(--muted-foreground)' };

  if (type === 'donut') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="var(--card)"
            strokeWidth={2}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Pie>
          {tooltip}
          <Legend
            iconType="circle"
            formatter={(value) => <span className="text-sm text-foreground">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'column') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis
            tickFormatter={(v: number) => compactCurrency(v, currency, locale)}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            content={<ChartTooltip currency={currency} locale={locale} />}
            cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Horizontal bars (default) — best for long category labels.
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          tickFormatter={(v: number) => compactCurrency(v, currency, locale)}
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
        <Tooltip
          content={<ChartTooltip currency={currency} locale={locale} />}
          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
        />
        <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.key} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
