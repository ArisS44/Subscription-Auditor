import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, BarChartHorizontal, CalendarClock, PieChart, TrendingUp } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useAnalytics, type Analytics } from '@/hooks/useAnalytics';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';
import { categoryColor } from './category-colors';
import { CategorySpendChart, type CategoryDatum, type ChartType } from './CategorySpendChart';

const ALL = '__all__';
const LIST_PAGE_SIZE = 8; // rows per page for the renewals / top-expenses lists
const CHARTS_PER_PAGE = 3; // per-currency charts per page in "All" mode

// Slice `items` for 1-based `page`, clamping the page so a shrunk list never
// lands on an empty page.
function paginate<T>(items: T[], page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(page, pageCount);
  return { visible: items.slice((safePage - 1) * size, safePage * size), pageCount };
}

const CHART_TYPES: { type: ChartType; icon: typeof BarChart3; labelKey: string }[] = [
  { type: 'bar', icon: BarChartHorizontal, labelKey: 'overview.chartType.bar' },
  { type: 'column', icon: BarChart3, labelKey: 'overview.chartType.column' },
  { type: 'donut', icon: PieChart, labelKey: 'overview.chartType.donut' },
];

// Build the chart data for one currency: only that currency's category rows,
// converted (string → number), translated, coloured, sorted high → low.
function categoryData(
  analytics: Analytics,
  currency: string,
  t: (k: string) => string,
): CategoryDatum[] {
  return analytics.spend_by_category
    .filter((row) => row.currency === currency)
    .map((row) => ({
      key: row.category,
      label: row.category
        ? t(`subscriptions.category.${row.category}`)
        : t('subscriptions.category.none'),
      amount: Number(row.monthly_equivalent),
      color: categoryColor(row.category),
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function OverviewPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { session } = useAuth();
  const { data, isLoading, isError } = useAnalytics(session?.access_token);

  // Currencies present, ordered by monthly burn (desc) so the biggest leads.
  const currencies = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.monthly_burn_by_currency).sort(
      (a, b) => Number(data.monthly_burn_by_currency[b]) - Number(data.monthly_burn_by_currency[a]),
    );
  }, [data]);

  const [chartType, setChartType] = useState<ChartType>('bar');
  const [currency, setCurrency] = useState<string>(ALL);
  const [chartPage, setChartPage] = useState(1);
  const [renewalsPage, setRenewalsPage] = useState(1);
  const [expensesPage, setExpensesPage] = useState(1);

  if (isLoading) {
    return <StateCard>{t('hello.loading')}</StateCard>;
  }
  if (isError || !data) {
    return <StateCard tone="error">{t('overview.loadError')}</StateCard>;
  }
  if (currencies.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">{t('dashboard.overview.title')}</h1>
        <StateCard>{t('overview.empty')}</StateCard>
      </section>
    );
  }

  // Default the selector: a single currency shows itself; multiple default to All.
  const effectiveCurrency = currency === ALL && currencies.length === 1 ? currencies[0] : currency;
  const allChartCurrencies = effectiveCurrency === ALL ? currencies : [effectiveCurrency];
  // Page through the per-currency charts (only paginates in "All" mode with many
  // currencies) and the two lists — each pager hides itself at a single page.
  const { visible: chartCurrencies, pageCount: chartPages } = paginate(
    allChartCurrencies,
    chartPage,
    CHARTS_PER_PAGE,
  );
  const { visible: renewals, pageCount: renewalPages } = paginate(
    data.upcoming_renewals,
    renewalsPage,
    LIST_PAGE_SIZE,
  );
  const { visible: expenses, pageCount: expensePages } = paginate(
    data.top_expenses,
    expensesPage,
    LIST_PAGE_SIZE,
  );

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">{t('dashboard.overview.title')}</h1>

      {/* Per-currency burn tiles (never summed across currencies). */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {currencies.map((cur) => (
          <Card key={cur}>
            <CardContent className="flex flex-col gap-1 py-4">
              <span className="text-xs tracking-wide text-muted-foreground uppercase">
                {t('overview.monthlyBurn')} · {cur}
              </span>
              <span className="font-heading text-2xl font-semibold tabular-nums">
                {formatCurrency(data.monthly_burn_by_currency[cur], cur, locale)}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t('overview.annualProjection', {
                  amount: formatCurrency(data.annual_projection_by_currency[cur], cur, locale),
                })}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Spend-by-category chart with type + currency controls. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>{t('overview.spendByCategory')}</CardTitle>
            <div className="flex items-center gap-2">
              {currencies.length > 1 && (
                <Select
                  value={currency}
                  onValueChange={(v) => {
                    setCurrency(v ?? ALL);
                    setChartPage(1);
                  }}
                >
                  <SelectTrigger size="sm" className="w-auto">
                    <SelectValue>
                      {(v: string) => (v === ALL ? t('overview.currency.all') : v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('overview.currency.all')}</SelectItem>
                    {currencies.map((cur) => (
                      <SelectItem key={cur} value={cur}>
                        {cur}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
                {CHART_TYPES.map(({ type, icon: Icon, labelKey }) => (
                  <Button
                    key={type}
                    size="icon-sm"
                    variant={chartType === type ? 'secondary' : 'ghost'}
                    aria-label={t(labelKey)}
                    aria-pressed={chartType === type}
                    title={t(labelKey)}
                    onClick={() => setChartType(type)}
                  >
                    <Icon className="size-4" aria-hidden />
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {chartCurrencies.map((cur) => {
              const cdata = categoryData(data, cur, t);
              return (
                <div key={cur} className="flex flex-col gap-1">
                  {chartCurrencies.length > 1 && (
                    <span className="text-xs font-medium text-muted-foreground">{cur}</span>
                  )}
                  {cdata.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {t('overview.noCategoryData')}
                    </p>
                  ) : (
                    <CategorySpendChart
                      data={cdata}
                      currency={cur}
                      type={chartType}
                      locale={locale}
                    />
                  )}
                </div>
              );
            })}
            <Pagination page={chartPage} pageCount={chartPages} onPageChange={setChartPage} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {/* Upcoming renewals (next 30 days). */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
                {t('overview.upcomingRenewals')}
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {t('overview.upcomingRenewalsHint')}
              </span>
            </CardHeader>
            <CardContent>
              {data.upcoming_renewals.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t('overview.noRenewals')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <ul className="flex flex-col">
                    {renewals.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0"
                      >
                        <span className="truncate font-medium">{r.name}</span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="text-muted-foreground">
                            {formatDate(r.next_renewal_date, locale)}
                          </span>
                          <span className="tabular-nums">
                            {formatCurrency(r.price, r.currency, locale)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={renewalsPage}
                    pageCount={renewalPages}
                    onPageChange={setRenewalsPage}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top expenses (monthly-equivalent, per currency). */}
          <Card>
            <CardHeader className="space-y-0">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
                {t('overview.topExpenses')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.top_expenses.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t('overview.noExpenses')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <ul className="flex flex-col">
                    {expenses.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0"
                      >
                        <span className="truncate font-medium">{e.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {t('overview.perMonth', {
                            amount: formatCurrency(e.monthly_equivalent, e.currency, locale),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={expensesPage}
                    pageCount={expensePages}
                    onPageChange={setExpensesPage}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function StateCard({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <Card
      className={cn(
        'py-10 text-center text-sm',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {children}
    </Card>
  );
}
