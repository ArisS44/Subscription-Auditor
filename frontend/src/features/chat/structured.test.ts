import { describe, expect, it } from 'vitest';
import { classifyStructured } from './structured';

// The payload arrives as untrusted-shaped JSON (validated server-side, but the
// renderer must not assume that). Classification decides which typed component
// draws it, and a shape matching neither known kind must degrade, never throw.

describe('classifyStructured', () => {
  it('recognizes a chart by chart_type + points', () => {
    const result = classifyStructured({
      chart_type: 'bar',
      title: 'Spend',
      currency: 'EUR',
      points: [
        { label: 'A', value: 10 },
        { label: 'B', value: 20 },
      ],
    });
    expect(result.kind).toBe('chart');
    if (result.kind === 'chart') {
      expect(result.payload.chart_type).toBe('bar');
      expect(result.payload.points).toHaveLength(2);
      expect(result.payload.currency).toBe('EUR');
    }
  });

  it('accepts every valid chart_type', () => {
    for (const chart_type of ['bar', 'column', 'line', 'pie', 'donut']) {
      const result = classifyStructured({ chart_type, points: [{ label: 'A', value: 1 }] });
      expect(result.kind).toBe('chart');
    }
  });

  it('recognizes a table by columns + rows', () => {
    const result = classifyStructured({
      title: 'Subs',
      columns: ['Name', 'Price'],
      rows: [
        ['Netflix', 9.99],
        ['Spotify', 5.99],
      ],
    });
    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.payload.columns).toEqual(['Name', 'Price']);
      expect(result.payload.rows).toHaveLength(2);
    }
  });

  it('treats a table with no rows as a valid empty table', () => {
    const result = classifyStructured({ columns: ['A'], rows: [] });
    expect(result.kind).toBe('table');
    if (result.kind === 'table') expect(result.payload.rows).toEqual([]);
  });

  it('treats a table with a missing rows field as empty, not malformed', () => {
    const result = classifyStructured({ columns: ['A'] });
    expect(result.kind).toBe('table');
  });

  it('classifies chart first when a payload somehow has both discriminators', () => {
    const result = classifyStructured({
      chart_type: 'pie',
      points: [{ label: 'A', value: 1 }],
      columns: ['X'],
      rows: [],
    });
    expect(result.kind).toBe('chart');
  });

  it.each([
    ['empty object', {}],
    ['unknown chart_type', { chart_type: 'radar', points: [{ label: 'A', value: 1 }] }],
    ['chart with no points', { chart_type: 'bar', points: [] }],
    ['chart point missing value', { chart_type: 'bar', points: [{ label: 'A' }] }],
    [
      'chart point non-finite value',
      { chart_type: 'bar', points: [{ label: 'A', value: Infinity }] },
    ],
    ['table with no columns', { columns: [], rows: [] }],
    ['table with non-string column', { columns: [1, 2], rows: [] }],
  ])('falls back to unknown for %s', (_label, payload) => {
    expect(classifyStructured(payload as Record<string, unknown>).kind).toBe('unknown');
  });

  it('pads a short row to the column width rather than rejecting the table', () => {
    const result = classifyStructured({ columns: ['A', 'B', 'C'], rows: [['x']] });
    expect(result.kind).toBe('table');
    if (result.kind === 'table') expect(result.payload.rows[0]).toEqual(['x', '', '']);
  });

  it('truncates an over-wide row to the column width', () => {
    const result = classifyStructured({ columns: ['A'], rows: [['x', 'y', 'z']] });
    expect(result.kind).toBe('table');
    if (result.kind === 'table') expect(result.payload.rows[0]).toEqual(['x']);
  });
});
