import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import type { TablePayload } from './structured';

// Renders a grounded table payload from the assistant on the shared shadcn table
// primitive, so an in-chat table matches the app's tables. Cells arrive already
// sanitized and length-capped server-side; they are rendered as PLAIN TEXT here,
// never as HTML. Numeric cells are right-aligned and locale-formatted; text
// cells stay left-aligned as-is. An empty `rows` array is a valid empty-state,
// not an error.

export function ChatTable({ payload }: { payload: TablePayload }) {
  const { t, i18n } = useTranslation();
  const { title, columns, rows } = payload;

  function renderCell(cell: string | number): string {
    return typeof cell === 'number' ? formatNumber(cell, i18n.language) : cell;
  }

  const isNumeric = (cell: string | number) => typeof cell === 'number';

  return (
    <figure className="my-1 w-full overflow-hidden rounded-lg border border-border">
      {title && (
        <figcaption className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
          {title}
        </figcaption>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column, i) => (
              <TableHead key={i}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="py-6 text-center text-muted-foreground"
              >
                {t('chat.table.empty')}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, r) => (
              <TableRow key={r}>
                {row.map((cell, c) => (
                  <TableCell key={c} className={isNumeric(cell) ? 'text-right tabular-nums' : ''}>
                    {renderCell(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </figure>
  );
}
