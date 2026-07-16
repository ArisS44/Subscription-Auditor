import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { StructuredPayload } from './StructuredPayload';
import { ChatTable } from './ChatTable';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('StructuredPayload dispatch', () => {
  it('routes a chart payload to a chart (title rendered, no raw HTML)', () => {
    const { container } = render(
      <StructuredPayload
        payload={{
          chart_type: 'bar',
          title: 'Spend by category',
          currency: 'EUR',
          points: [{ label: 'Streaming', value: 12 }],
        }}
      />,
    );
    expect(screen.getByText('Spend by category')).toBeInTheDocument();
    // Typed component only — never dangerouslySetInnerHTML.
    expect(container.querySelector('figure')).toBeInTheDocument();
  });

  it('routes a table payload to a table', () => {
    render(
      <StructuredPayload payload={{ columns: ['Name', 'Price'], rows: [['Netflix', 9.99]] }} />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
  });

  it('falls back to a safe placeholder for an unrecognized shape', () => {
    render(<StructuredPayload payload={{ nonsense: true }} />);
    expect(screen.getByText(i18n.t('chat.structuredUnavailable'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('ChatTable', () => {
  it('renders headers and rows, right-aligning numeric cells', () => {
    render(
      <ChatTable
        payload={{ title: 'Subs', columns: ['Name', 'Price'], rows: [['Netflix', 9.5]] }}
      />,
    );
    expect(screen.getByText('Subs')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();

    const priceCell = screen.getByText('9.5').closest('td');
    expect(priceCell?.className).toContain('text-right');
    // Text cell is not right-aligned.
    expect(screen.getByText('Netflix').closest('td')?.className).not.toContain('text-right');
  });

  it('renders an empty-state row when there are no rows', () => {
    render(<ChatTable payload={{ columns: ['A', 'B'], rows: [] }} />);
    const emptyCell = screen.getByText(i18n.t('chat.table.empty'));
    expect(emptyCell).toBeInTheDocument();
    expect(emptyCell.closest('td')?.getAttribute('colspan')).toBe('2');
  });

  it('localizes the empty state', async () => {
    await i18n.changeLanguage('el');
    render(<ChatTable payload={{ columns: ['A'], rows: [] }} />);
    expect(screen.getByText(i18n.t('chat.table.empty'))).toBeInTheDocument();
  });

  it('renders a string cell that looks like HTML as literal text, never markup', () => {
    render(<ChatTable payload={{ columns: ['Note'], rows: [['<img src=x onerror=alert(1)>']] }} />);
    const cell = screen.getByRole('cell');
    // The angle-bracket text is present as text; no <img> element was created.
    expect(cell.textContent).toContain('<img');
    expect(within(cell).queryByRole('img')).not.toBeInTheDocument();
    expect(cell.querySelector('img')).toBeNull();
  });

  it('formats numeric cells with Intl for the active locale', async () => {
    await i18n.changeLanguage('el');
    render(<ChatTable payload={{ columns: ['N'], rows: [[1234.5]] }} />);
    // el-GR groups with a dot: 1.234,5
    expect(screen.getByRole('cell').textContent).toBe('1.234,5');
  });
});
