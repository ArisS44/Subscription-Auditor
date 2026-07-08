import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronsUpDown, LogOut, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from './ConfirmDialog';

/** Footer account control: shows who is signed in and offers "Switch account"
 *  and "Log out". Both are guarded by a confirmation so an accidental click
 *  can't drop the session — the app holds one session at a time, so switching
 *  also signs the current account out (returning to the login screen). Collapses
 *  to just the avatar when the rail is collapsed. */
export function SidebarAccount({
  collapsed,
  email,
  displayName,
}: {
  collapsed: boolean;
  email?: string;
  displayName?: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  const primaryLabel = displayName || email || '';
  const initial = (primaryLabel || '?').charAt(0).toUpperCase();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  async function handleSwitch() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  const avatar = (
    <span className="grid size-6 shrink-0 place-content-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
      {initial}
    </span>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              aria-label={email}
              title={collapsed ? email : undefined}
              className={cn(
                'h-auto w-full py-1.5',
                collapsed ? 'justify-center px-0' : 'justify-start gap-2 px-2',
              )}
            />
          }
        >
          {avatar}
          {!collapsed && (
            <>
              <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                <span className="truncate text-xs font-medium">{primaryLabel}</span>
                {displayName && email && (
                  <span className="truncate text-[11px] text-muted-foreground">{email}</span>
                )}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-56">
          {/* Plain header, not a Menu.GroupLabel — group-label parts require a
              surrounding Menu.Group and throw without one. */}
          <div className="flex flex-col gap-0.5 px-1.5 py-1">
            <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
              {t('dashboard.account.signedInAs')}
            </span>
            <span className="truncate text-sm font-medium text-foreground">{email}</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setConfirmSwitch(true)}>
            <Users aria-hidden />
            {t('dashboard.account.switch')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmLogout(true)}>
            <LogOut aria-hidden />
            {t('hello.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title={t('dashboard.logoutDialog.title')}
        description={t('dashboard.logoutDialog.description')}
        confirmLabel={t('dashboard.logoutDialog.confirm')}
        cancelLabel={t('dashboard.logoutDialog.cancel')}
        onConfirm={handleLogout}
        destructive
      />

      <ConfirmDialog
        open={confirmSwitch}
        onOpenChange={setConfirmSwitch}
        title={t('dashboard.switchDialog.title')}
        description={t('dashboard.switchDialog.description', { email: email ?? '' })}
        confirmLabel={t('dashboard.switchDialog.confirm')}
        cancelLabel={t('dashboard.switchDialog.cancel')}
        onConfirm={handleSwitch}
      />
    </>
  );
}
