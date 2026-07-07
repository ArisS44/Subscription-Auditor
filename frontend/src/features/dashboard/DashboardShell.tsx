import { Outlet } from 'react-router-dom';
import { DashboardSidebar } from './DashboardSidebar';

/** Layout route for the dashboard. Renders the persistent sidebar and an
 *  <Outlet/> — the placeholder React Router fills with whichever nested child
 *  route is active (Overview, Subscriptions, the detail route, Settings, or a
 *  "coming soon" placeholder). Because only the <Outlet/> region re-renders on
 *  navigation, the sidebar and its state persist across tab changes. */
export function DashboardShell() {
  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <DashboardSidebar />
      <main className="flex-1 overflow-x-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
