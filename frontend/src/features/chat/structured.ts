// Typed view of the `structured` SSE payload the chat engine emits — the JSON
// dump of the backend's RenderChartArgs / RenderTableArgs (see
// backend/app/services/tools.py). The two share no discriminator field, so they
// are told apart by shape: a chart has `chart_type` + `points`, a table has
// `columns` + `rows`. Anything else is unknown and renders as a safe fallback.
//
// The payload arrives over the wire as `Record<string, unknown>` (already
// validated + length-capped server-side). These guards re-check the structure
// on the client too: the renderers must never assume a field exists, so a shape
// that slips through degrades gracefully instead of throwing.

export const CHART_TYPES = ['bar', 'column', 'line', 'pie', 'donut'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartPayload {
  chart_type: ChartType;
  title?: string;
  currency?: string;
  points: ChartPoint[];
}

export interface TablePayload {
  title?: string;
  columns: string[];
  rows: (string | number)[][];
}

export type StructuredKind =
  | { kind: 'chart'; payload: ChartPayload }
  | { kind: 'table'; payload: TablePayload }
  | { kind: 'unknown' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value);
}

function asChart(payload: Record<string, unknown>): ChartPayload | null {
  if (!isChartType(payload.chart_type)) return null;
  if (!Array.isArray(payload.points)) return null;

  const points: ChartPoint[] = [];
  for (const raw of payload.points) {
    if (!isRecord(raw)) return null;
    const value = raw.value;
    if (typeof raw.label !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    points.push({ label: raw.label, value });
  }
  if (points.length === 0) return null;

  return {
    chart_type: payload.chart_type,
    title: typeof payload.title === 'string' ? payload.title : undefined,
    currency: typeof payload.currency === 'string' ? payload.currency : undefined,
    points,
  };
}

function asTable(payload: Record<string, unknown>): TablePayload | null {
  if (!Array.isArray(payload.columns) || payload.columns.length === 0) return null;
  if (!payload.columns.every((c): c is string => typeof c === 'string')) return null;

  const width = payload.columns.length;
  // `rows` may legitimately be absent or empty (an empty-state table).
  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rows: (string | number)[][] = [];
  for (const row of rawRows) {
    if (!Array.isArray(row)) return null;
    const cells: (string | number)[] = [];
    for (const cell of row) {
      if (typeof cell === 'string') cells.push(cell);
      else if (typeof cell === 'number' && Number.isFinite(cell)) cells.push(cell);
      else return null;
    }
    // Tolerate a width mismatch by padding/truncating rather than throwing — the
    // backend guarantees square rows, but a renderer must not crash if it lies.
    while (cells.length < width) cells.push('');
    rows.push(cells.slice(0, width));
  }

  return {
    title: typeof payload.title === 'string' ? payload.title : undefined,
    columns: payload.columns,
    rows,
  };
}

/** Classify a raw structured payload by shape. Chart is checked first (it has the
 *  unambiguous `chart_type`), then table; neither → `unknown` for the fallback. */
export function classifyStructured(payload: Record<string, unknown>): StructuredKind {
  const chart = asChart(payload);
  if (chart) return { kind: 'chart', payload: chart };
  const table = asTable(payload);
  if (table) return { kind: 'table', payload: table };
  return { kind: 'unknown' };
}
