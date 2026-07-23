import { Outlet } from 'react-router-dom';
import { DashboardSidebar } from './DashboardSidebar';

/** Layout route for the dashboard. Renders the persistent sidebar and an
 *  <Outlet/> — the placeholder React Router fills with whichever nested child
 *  route is active (Overview, Subscriptions, the detail route, Settings, or a
 *  "coming soon" placeholder). Because only the <Outlet/> region re-renders on
 *  navigation, the sidebar and its state persist across tab changes.
 *
 *  The first-login onboarding decision is made by <OnboardingGate/> before this
 *  shell renders (see App.tsx), so the shell and its data queries never mount for
 *  a user who should be in the wizard. */
export function DashboardShell() {
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
