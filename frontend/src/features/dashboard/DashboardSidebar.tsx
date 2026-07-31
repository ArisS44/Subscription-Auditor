import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, Wallet } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LanguageToggle } from '@/components/LanguageToggle';
import { SidebarAccount } from './SidebarAccount';
import { NAV_ITEMS } from './nav-items';

/** The persistent left navigation rail. Rendered once by the shell; it stays
 *  mounted while the routed content to its right swaps on navigation.
 *
 *  Collapsible: a small control in the header shrinks it to an icon-only rail so
 *  the content area gets more room. The collapsed/expanded choice is kept in
 *  component state (not persisted) — the shell stays mounted across tab
 *  navigation, so it holds for the whole session and only resets on a full page
 *  reload. We deliberately avoid local storage here to keep to the app's rule of
 *  storing only strictly-necessary values (auth token, language). */
export function DashboardSidebar() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { data: profile } = useMe(session?.access_token);
  const [collapsed, setCollapsed] = useState(false);

  // Prefer the session email (always present when logged in) so the account
  // still shows correctly even if the profile fetch (/me) is unavailable.
  const email = session?.user?.email ?? profile?.email;

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Header: brand lockup + a compact collapse toggle. The glyph reads as a
          logo (not an account avatar) and stays when collapsed. */}
      <div
        className={cn(
          'flex items-center border-b border-border',
          collapsed ? 'flex-col gap-1 px-2 py-2' : 'h-14 justify-between px-4',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-content-center rounded-md bg-primary/15 text-primary">
            <Wallet className="size-4" aria-hidden />
          </span>
          {!collapsed && (
            // Tight leading because the full product name wraps to two lines at
            // the sidebar's width; ragged default leading looks like a mistake.
            <span className="font-heading text-lg leading-tight font-semibold">
              {t('dashboard.brand')}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? t('dashboard.sidebar.expand') : t('dashboard.sidebar.collapse')}
          aria-expanded={!collapsed}
          title={collapsed ? t('dashboard.sidebar.expand') : t('dashboard.sidebar.collapse')}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? (
            <ChevronsRight className="size-4" aria-hidden />
          ) : (
            <ChevronsLeft className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end, placeholder }) => {
          // Shared between the real links and the placeholder rows so the two
          // stay dimensionally identical — only the interaction states differ.
          const rowClass = cn(
            'flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors',
            collapsed ? 'justify-center px-0' : 'px-3',
          );
          // title doubles as the hover tooltip when collapsed, where the text
          // label is hidden — and it is the only thing carrying "coming soon"
          // for a collapsed placeholder row.
          const title = placeholder
            ? `${t(labelKey)} — ${t('dashboard.comingSoon.badge')}`
            : t(labelKey);

          const contents = (
            <>
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && (
                <>
                  <span className="flex-1">{t(labelKey)}</span>
                  {placeholder && (
                    // h-[18px] + leading-none: the badge's default h-5 with the
                    // row's inherited 20px line-height left the 10px label in a
                    // line box taller than the pill's content area, so it read
                    // as vertically off-centre and clipped.
                    <Badge
                      variant="outline"
                      className="h-[18px] px-1.5 text-[10px] leading-none text-muted-foreground"
                    >
                      {t('dashboard.comingSoon.badge')}
                    </Badge>
                  )}
                </>
              )}
            </>
          );

          // A placeholder tab has no destination, so it is deliberately not a
          // link: no href, not focusable, and announced as disabled. Rendering
          // it as an inert element (rather than a link with preventDefault) is
          // what actually makes it unclickable for mouse, keyboard and screen
          // reader alike.
          return placeholder ? (
            <div
              key={to || 'index'}
              aria-disabled="true"
              title={title}
              className={cn(rowClass, 'cursor-default text-muted-foreground/55 select-none')}
            >
              {contents}
            </div>
          ) : (
            <NavLink
              key={to || 'index'}
              to={to}
              end={end}
              title={title}
              className={({ isActive }) =>
                cn(
                  rowClass,
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )
              }
            >
              {contents}
            </NavLink>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-border px-2 py-2">
        {!collapsed && (
          <div className="px-1 py-1">
            <LanguageToggle />
          </div>
        )}
        <SidebarAccount collapsed={collapsed} email={email} displayName={profile?.display_name} />
      </div>
    </aside>
  );
}
