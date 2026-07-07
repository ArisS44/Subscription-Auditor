import { BarChart3, CreditCard, LayoutDashboard, MessageSquare, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Single source of truth for the shell's tab navigation. The shell renders the
// nav from this list and App.tsx declares matching nested routes, so the two
// stay in lockstep. `end` marks the index route (Overview) so its NavLink is
// only "active" on an exact match, not for every nested path. `placeholder`
// tabs are visible but route to a clearly-labelled "coming soon" view.
export interface NavItem {
  /** Path relative to the /dashboard layout route. Empty string = index. */
  to: string;
  /** i18n key under dashboard.nav for the label. */
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
  placeholder?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '', labelKey: 'dashboard.nav.overview', icon: LayoutDashboard, end: true },
  { to: 'subscriptions', labelKey: 'dashboard.nav.subscriptions', icon: CreditCard },
  { to: 'reports', labelKey: 'dashboard.nav.reports', icon: BarChart3, placeholder: true },
  { to: 'chat', labelKey: 'dashboard.nav.chat', icon: MessageSquare, placeholder: true },
  { to: 'settings', labelKey: 'dashboard.nav.settings', icon: Settings },
];
