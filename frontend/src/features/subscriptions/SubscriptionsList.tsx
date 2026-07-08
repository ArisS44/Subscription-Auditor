import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import {
  useSubscriptions,
  type Category,
  type Subscription,
  type SubscriptionListParams,
  type SubscriptionStatus,
} from '@/hooks/useSubscriptions';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CATEGORIES } from './subscription-schema';
import { perPeriodPrice, statusBadgeVariant } from './display';
import { SubscriptionRowActions } from './SubscriptionRowActions';
import { SubscriptionFormDialog } from './SubscriptionFormDialog';

const STATUSES: readonly SubscriptionStatus[] = ['active', 'paused', 'cancelled'];
const SORT_FIELDS: readonly NonNullable<SubscriptionListParams['sort_by']>[] = [
  'created_at',
  'name',
  'price',
  'next_renewal_date',
];
// Sentinel for the "all" filter option — Base UI Select needs a concrete value.
const ALL = '__all__';

/** The Subscriptions tab: filter/sort controls, a table of subscriptions with
 *  per-row actions, and the shared add/edit dialog. Filters/sort map 1:1 to the
 *  backend query params, so changing them re-keys the query and refetches. */
export function SubscriptionsList() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const accessToken = session?.access_token;

  const [status, setStatus] = useState<SubscriptionStatus | typeof ALL>(ALL);
  const [category, setCategory] = useState<Category | typeof ALL>(ALL);
  const [sortBy, setSortBy] =
    useState<NonNullable<SubscriptionListParams['sort_by']>>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | undefined>(undefined);

  const params: SubscriptionListParams = useMemo(
    () => ({
      status: status === ALL ? undefined : status,
      category: category === ALL ? undefined : category,
      sort_by: sortBy,
      order,
      limit: 100,
    }),
    [status, category, sortBy, order],
  );

  const { data, isLoading, isError } = useSubscriptions(accessToken, params);
  const items = data?.items ?? [];
  const hasFilters = status !== ALL || category !== ALL;

  function openAdd() {
    setEditing(undefined);
    setFormOpen(true);
  }
  function openEdit(subscription: Subscription) {
    setEditing(subscription);
    setFormOpen(true);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-heading text-2xl font-semibold">
            {t('dashboard.subscriptions.title')}
          </h1>
          {data && (
            <span className="text-sm text-muted-foreground">
              {t('subscriptions.count', { count: data.total })}
            </span>
          )}
        </div>
        <Button onClick={openAdd}>
          <Plus aria-hidden />
          {t('subscriptions.add')}
        </Button>
      </div>

      {/* Filter + sort controls — each maps to a backend query param. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as SubscriptionStatus | typeof ALL)}
        >
          <SelectTrigger className="w-48">
            <SelectValue>
              {(v: string) =>
                `${t('subscriptions.filters.status')}: ${
                  v === ALL ? t('subscriptions.filters.all') : t(`subscriptions.status.${v}`)
                }`
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('subscriptions.filters.allStatuses')}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`subscriptions.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => setCategory(v as Category | typeof ALL)}>
          <SelectTrigger className="w-56">
            <SelectValue>
              {(v: string) =>
                `${t('subscriptions.filters.category')}: ${
                  v === ALL ? t('subscriptions.filters.all') : t(`subscriptions.category.${v}`)
                }`
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('subscriptions.filters.allCategories')}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`subscriptions.category.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort dropdown (with "Sort by:" prefix inside) joined to a direction
            arrow. The trigger is wide enough for the longest label so the text
            never runs under the chevron; SelectValue also truncates as a guard. */}
        <div className="ml-auto flex items-center">
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as NonNullable<SubscriptionListParams['sort_by']>)}
          >
            <SelectTrigger className="w-56 rounded-r-none border-r-0">
              <SelectValue>
                {(v: string) =>
                  `${t('subscriptions.filters.sortBy')}: ${t(`subscriptions.sort.${v}`)}`
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORT_FIELDS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`subscriptions.sort.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="rounded-l-none"
            aria-label={t('subscriptions.filters.toggleOrder')}
            title={t(order === 'asc' ? 'subscriptions.filters.asc' : 'subscriptions.filters.desc')}
            onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
          >
            {order === 'asc' ? (
              <ArrowUp className="size-4" aria-hidden />
            ) : (
              <ArrowDown className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>

      {isError ? (
        <Card className="py-10 text-center text-sm text-destructive">
          {t('subscriptions.loadError')}
        </Card>
      ) : isLoading ? (
        <Card className="py-10 text-center text-sm text-muted-foreground">
          {t('hello.loading')}
        </Card>
      ) : items.length === 0 ? (
        <Card className="py-10 text-center text-sm text-muted-foreground">
          {hasFilters ? t('subscriptions.emptyFiltered') : t('subscriptions.empty')}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('subscriptions.columns.name')}</TableHead>
                <TableHead>{t('subscriptions.columns.price')}</TableHead>
                <TableHead>{t('subscriptions.columns.category')}</TableHead>
                <TableHead>{t('subscriptions.columns.status')}</TableHead>
                <TableHead>{t('subscriptions.columns.nextRenewal')}</TableHead>
                <TableHead className="w-10 text-right">
                  <span className="sr-only">{t('subscriptions.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-medium">
                    <Link to={`/dashboard/subscriptions/${sub.id}`} className="hover:underline">
                      {sub.name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {perPeriodPrice(sub, i18n.language, t)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sub.category
                      ? t(`subscriptions.category.${sub.category}`)
                      : t('subscriptions.category.none')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(sub.status)}>
                      {t(`subscriptions.status.${sub.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {sub.next_renewal_date
                      ? formatDate(sub.next_renewal_date, i18n.language)
                      : t('subscriptions.detail.notSet')}
                  </TableCell>
                  <TableCell className="text-right">
                    <SubscriptionRowActions
                      subscription={sub}
                      accessToken={accessToken}
                      onEdit={openEdit}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <SubscriptionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        subscription={editing}
        accessToken={accessToken}
      />
    </section>
  );
}
