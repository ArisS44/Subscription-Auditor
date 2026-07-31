import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { AuthContext } from '@/features/auth/auth-context';
import { DashboardSidebar } from './DashboardSidebar';

// The sidebar only reads the profile for the account footer; a real query client
// would add nothing to what these tests assert.
vi.mock('@/hooks/useMe', () => ({ useMe: () => ({ data: undefined }) }));

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthContext.Provider value={{ session: null, loading: false }}>
        <DashboardSidebar />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('DashboardSidebar', () => {
  it('renders a placeholder tab as inert rather than as a link', () => {
    renderSidebar();

    // Positive control: the same query does find the shipped tabs, so a null
    // result for Reports means "not a link", not "the query is broken".
    expect(screen.getByRole('link', { name: i18n.t('dashboard.nav.subscriptions') })).toBeVisible();
    expect(screen.queryByRole('link', { name: /reports/i })).toBeNull();

    const reports = screen.getByText(i18n.t('dashboard.nav.reports')).closest('[aria-disabled]');
    expect(reports).not.toBeNull();
    expect(reports).toHaveAttribute('aria-disabled', 'true');
    // No href anywhere in the row: nothing for a click, a middle-click or a
    // "copy link address" to reach.
    expect(reports?.querySelector('a')).toBeNull();
  });

  it('labels the placeholder tab as coming soon', () => {
    renderSidebar();

    const row = screen.getByText(i18n.t('dashboard.nav.reports')).closest('[aria-disabled]');
    expect(row).toHaveTextContent(i18n.t('dashboard.comingSoon.badge'));
    // The tooltip carries the same meaning for the collapsed rail, where the
    // text label and badge are both hidden.
    expect(row?.getAttribute('title')).toContain(i18n.t('dashboard.comingSoon.badge'));
  });
});
