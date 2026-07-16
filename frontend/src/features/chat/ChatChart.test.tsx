import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { ChatChart } from './ChatChart';
import type { ChartPayload } from './structured';

// The chart's SVG doesn't lay out under jsdom, but everything that makes a chart
// self-describing — its header, and a pie/donut's legend and centre total — is
// plain DOM around the plot, so it's all assertable here.

function chart(overrides: Partial<ChartPayload> = {}): ChartPayload {
  return {
    chart_type: 'bar',
    points: [
      { label: 'streaming', value: 48 },
      { label: 'ai_tool', value: 39 },
    ],
    ...overrides,
  };
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('chart header', () => {
  it('always names the chart type', () => {
    render(<ChatChart payload={chart({ chart_type: 'bar' })} />);
    expect(screen.getByText(i18n.t('chat.chartType.bar'))).toBeInTheDocument();
  });

  it('shows the assistant title when present', () => {
    render(<ChatChart payload={chart({ title: 'Spend by category' })} />);
    expect(screen.getByText('Spend by category')).toBeInTheDocument();
  });

  it('still names the type when the assistant gave no title', () => {
    render(<ChatChart payload={chart({ chart_type: 'line', title: undefined })} />);
    expect(screen.getByText(i18n.t('chat.chartType.line'))).toBeInTheDocument();
  });

  it('localizes the chart-type label', async () => {
    await i18n.changeLanguage('el');
    render(<ChatChart payload={chart({ chart_type: 'pie' })} />);
    expect(screen.getByText(i18n.t('chat.chartType.pie'))).toBeInTheDocument();
  });
});

describe('pie/donut legend', () => {
  it('lists each slice with a humanized label and value', () => {
    render(<ChatChart payload={chart({ chart_type: 'pie', currency: 'EUR' })} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Raw enum keys are humanized, not leaked.
    expect(screen.getByText('AI tool')).toBeInTheDocument();
    expect(screen.queryByText('ai_tool')).not.toBeInTheDocument();
    // Value is shown, currency-formatted.
    expect(screen.getByText('€48.00')).toBeInTheDocument();
  });

  it('shows the total in the donut centre', () => {
    render(<ChatChart payload={chart({ chart_type: 'donut', currency: 'EUR' })} />);
    expect(screen.getByText(i18n.t('chat.chart.total'))).toBeInTheDocument();
    expect(screen.getByText('€87.00')).toBeInTheDocument(); // 48 + 39
  });

  it('formats legend values as plain numbers when no currency is given', () => {
    render(<ChatChart payload={chart({ chart_type: 'pie' })} />);
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.queryByText('€48.00')).not.toBeInTheDocument();
  });

  it('gives a bar chart no legend (its axis already labels every bar)', () => {
    render(<ChatChart payload={chart({ chart_type: 'bar' })} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
