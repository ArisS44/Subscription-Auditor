import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Build the page-number row with ellipses: always show first & last, the current
// page, and `siblings` on each side; collapse the rest into an ellipsis marker.
// e.g. page 5 of 56 → [1, '…', 4, 5, 6, '…', 56].
function pageItems(page: number, pageCount: number, siblings = 1): (number | 'ellipsis')[] {
  const totalSlots = siblings * 2 + 5; // first, last, current, 2 ellipses
  if (pageCount <= totalSlots) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, pageCount);
  const showLeftEllipsis = left > 2;
  const showRightEllipsis = right < pageCount - 1;
  const items: (number | 'ellipsis')[] = [1];
  if (showLeftEllipsis) items.push('ellipsis');
  for (let p = showLeftEllipsis ? left : 2; p <= (showRightEllipsis ? right : pageCount - 1); p++) {
    items.push(p);
  }
  if (showRightEllipsis) items.push('ellipsis');
  items.push(pageCount);
  return items;
}

/** Reusable pager: « ‹ 1 2 … 56 › » for any list that can outgrow a page.
 *  1-based `page`; renders nothing when there's a single page. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (pageCount <= 1) return null;

  const go = (p: number) => onPageChange(Math.min(Math.max(p, 1), pageCount));
  const atStart = page <= 1;
  const atEnd = page >= pageCount;

  return (
    <nav
      role="navigation"
      aria-label={t('pagination.label')}
      className={cn('flex items-center justify-center gap-1', className)}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('pagination.first')}
        disabled={atStart}
        onClick={() => go(1)}
      >
        <ChevronsLeft className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('pagination.previous')}
        disabled={atStart}
        onClick={() => go(page - 1)}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </Button>

      {pageItems(page, pageCount).map((item, i) =>
        item === 'ellipsis' ? (
          <span
            key={`e${i}`}
            className="grid size-7 place-content-center text-muted-foreground"
            aria-hidden
          >
            <MoreHorizontal className="size-4" />
          </span>
        ) : (
          <Button
            key={item}
            variant={item === page ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={t('pagination.page', { page: item })}
            aria-current={item === page ? 'page' : undefined}
            className="tabular-nums"
            onClick={() => go(item)}
          >
            {item}
          </Button>
        ),
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('pagination.next')}
        disabled={atEnd}
        onClick={() => go(page + 1)}
      >
        <ChevronRight className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('pagination.last')}
        disabled={atEnd}
        onClick={() => go(pageCount)}
      >
        <ChevronsRight className="size-4" aria-hidden />
      </Button>
    </nav>
  );
}
