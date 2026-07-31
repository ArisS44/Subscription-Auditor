import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  BarChartHorizontal,
  CalendarClock,
  Info,
  PieChart,
  Signpost,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useAnalytics, type Analytics, type TopExpense } from '@/hooks/useAnalytics';
import { useFxRates } from '@/hooks/useFx';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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

// Convert `amount` (in `currency`) into `target` using rates keyed base=target
// (so rates[c] = units of c per 1 target ⇒ amount_in_target = amount / rates[c]).
// The target itself is 1:1. Returns null when the needed rate is missing, so a
// gap surfaces as "incomplete" rather than a silently wrong total.
function convertToTarget(
  amount: number,
  currency: string,
  target: string,
  rates: Record<string, string>,
): number | null {
  if (currency === target) return amount;
  const rate = Number(rates[currency]);
  return rate > 0 ? amount / rate : null;
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

/** A small marker that flags a figure as an FX-converted approximation, never a
 *  real per-currency amount. Carries an explanatory tooltip on hover/focus. */
function EstimateBadge() {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className="gap-1 text-muted-foreground"
      title={t('overview.convert.estimateTooltip')}
    >
      <Info className="size-3" aria-hidden />
      {t('overview.convert.estimate')}
    </Badge>
  );
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
  const [expensesCurrency, setExpensesCurrency] = useState<string>(ALL);

  // Opt-in cross-currency conversion. Off by default: with it off the Overview is
  // exactly per-currency (the app's default everywhere). On: convert every
  // currency into one target and show comparison totals, each labeled an estimate.
  const [convertOn, setConvertOn] = useState(false);
  const [targetCurrency, setTargetCurrency] = useState<string>('');
  // Default the conversion target to EUR when the user actually holds a EUR
  // subscription: the app's primary audience is in the eurozone, so "what does
  // this all cost me in euros" is the question being asked. Falling back to
  // `currencies[0]` (the highest monthly burn) keeps the previous behaviour for
  // anyone with no EUR at all — and matters because the selector below lists
  // exactly `currencies` as its options, so a target outside that list would
  // leave the dropdown displaying nothing.
  const effectiveTarget =
    targetCurrency || (currencies.includes('EUR') ? 'EUR' : currencies[0]) || '';
  // Only the *other* currencies need rates; the target is 1:1.
  const fxSymbols = useMemo(
    () => currencies.filter((c) => c !== effectiveTarget),
    [currencies, effectiveTarget],
  );
  // Called unconditionally (Rules of Hooks) but only fetches when conversion is on
  // and there is more than one currency to reconcile.
  const fx = useFxRates(
    session?.access_token,
    effectiveTarget,
    fxSymbols,
    convertOn && currencies.length > 1,
  );

  // Derived converted figures: a single summed monthly/annual total and a
  // cross-currency top-expenses ranking, all in the target currency. Null unless
  // conversion is on and rates are loaded.
  const converted = useMemo(() => {
    if (!convertOn || !data || !fx.data || effectiveTarget === '') return null;
    const rates = fx.data.rates;
    let monthly = 0;
    let annual = 0;
    let incomplete = false;
    for (const cur of currencies) {
      const m = convertToTarget(
        Number(data.monthly_burn_by_currency[cur]),
        cur,
        effectiveTarget,
        rates,
      );
      const a = convertToTarget(
        Number(data.annual_projection_by_currency[cur]),
        cur,
        effectiveTarget,
        rates,
      );
      if (m === null || a === null) {
        incomplete = true;
        continue;
      }
      monthly += m;
      annual += a;
    }
    const expenses = data.top_expenses
      .map((e) => {
        const value = convertToTarget(
          Number(e.monthly_equivalent),
          e.currency,
          effectiveTarget,
          rates,
        );
        return value === null ? null : { ...e, converted: value };
      })
      .filter((e): e is TopExpense & { converted: number } => e !== null)
      .sort((a, b) => b.converted - a.converted);
    return { monthly, annual, expenses, incomplete };
  }, [convertOn, data, fx.data, currencies, effectiveTarget]);

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
  // Top expenses can be filtered to a single currency (each item already carries
  // its own currency); "All" passes the full, correctly per-currency-ranked list.
  const filteredExpenses =
    expensesCurrency === ALL
      ? data.top_expenses
      : data.top_expenses.filter((e) => e.currency === expensesCurrency);
  // When conversion is on, the top-expenses card shows the cross-currency ranking
  // instead of the per-currency filtered list.
  const expenseSource: (TopExpense & { converted?: number })[] =
    converted != null ? converted.expenses : filteredExpenses;
  const { visible: expenses, pageCount: expensePages } = paginate(
    expenseSource,
    expensesPage,
    LIST_PAGE_SIZE,
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">{t('dashboard.overview.title')}</h1>

        {/* Opt-in cross-currency conversion control. Only meaningful with more
            than one currency in the portfolio. */}
        {currencies.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <Switch
              id="convert-toggle"
              checked={convertOn}
              onCheckedChange={(checked) => setConvertOn(checked === true)}
            />
            <label htmlFor="convert-toggle" className="text-muted-foreground">
              {t('overview.convert.label')}
            </label>
            <Select
              value={effectiveTarget}
              onValueChange={(v) => setTargetCurrency((v as string) ?? '')}
              disabled={!convertOn}
            >
              <SelectTrigger size="sm" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((cur) => (
                  <SelectItem key={cur} value={cur}>
                    {cur}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Roadmap teaser: a small, non-modal wink at what's coming (real Session
          4-7 features). Deliberately minor — muted, single line, no dismiss/badge
          — so it never competes with real data. */}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Signpost className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{t('overview.roadmap.teaser')}</span>
      </p>

      {/* Per-currency burn tiles (never summed across currencies) — always the
          real, literal figures. */}
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

      {/* Converted comparison total — additive, appears only when conversion is
          on. Clearly labeled an estimate so it never reads as a real figure. */}
      {convertOn && currencies.length > 1 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="flex items-center gap-2 text-xs tracking-wide text-muted-foreground uppercase">
              {t('overview.convert.total')} · {effectiveTarget}
              <EstimateBadge />
            </span>
            {fx.isError ? (
              <span className="py-1 text-sm text-muted-foreground">
                {t('overview.convert.unavailable')}
              </span>
            ) : fx.isLoading || !converted ? (
              <span className="py-1 text-sm text-muted-foreground">
                {t('overview.convert.loading')}
              </span>
            ) : (
              <>
                <span className="font-heading text-2xl font-semibold tabular-nums">
                  ≈ {formatCurrency(converted.monthly, effectiveTarget, locale)}
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {t('overview.annualProjection', {
                    amount: `≈ ${formatCurrency(converted.annual, effectiveTarget, locale)}`,
                  })}
                </span>
              </>
            )}
          </CardContent>
        </Card>
      )}

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

          {/* Top expenses (monthly-equivalent). Per currency by default; a fairer
              cross-currency ranking (all converted to the target) when on. */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
                {t('overview.topExpenses')}
              </CardTitle>
              {converted != null ? (
                <EstimateBadge />
              ) : (
                currencies.length > 1 && (
                  <Select
                    value={expensesCurrency}
                    onValueChange={(v) => {
                      setExpensesCurrency(v ?? ALL);
                      setExpensesPage(1);
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
                )
              )}
            </CardHeader>
            <CardContent>
              {expenseSource.length === 0 ? (
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
                          {e.converted != null
                            ? t('overview.perMonth', {
                                amount: `≈ ${formatCurrency(e.converted, effectiveTarget, locale)}`,
                              })
                            : t('overview.perMonth', {
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
