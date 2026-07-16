import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useMe } from '@/hooks/useMe';
import { readProgress } from '@/features/onboarding/onboarding-state';
import { DashboardSidebar } from './DashboardSidebar';

/** Layout route for the dashboard. Renders the persistent sidebar and an
 *  <Outlet/> — the placeholder React Router fills with whichever nested child
 *  route is active (Overview, Subscriptions, the detail route, Settings, or a
 *  "coming soon" placeholder). Because only the <Outlet/> region re-renders on
 *  navigation, the sidebar and its state persist across tab changes. */
export function DashboardShell() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const meQuery = useMe(session?.access_token);

  // First-login routing: a brand-new user (onboarding unfinished server-side, and
  // has never entered the flow) is taken into onboarding once. After they've
  // entered it, they're never force-redirected again — the resume banner on the
  // Overview handles picking it back up — so leaving mid-flow is respected.
  useEffect(() => {
    if (meQuery.data && !meQuery.data.onboarding_completed && !readProgress().entered) {
      navigate('/onboarding', { replace: true });
    }
  }, [meQuery.data, navigate]);

  return (
    // Fix the shell to the viewport height and hide overflow, so the sidebar
    // stays put and only the main content area scrolls (never the whole page).
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
