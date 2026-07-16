import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { DashboardShell } from '@/features/dashboard/DashboardShell';
import { OnboardingFlow } from '@/features/onboarding/OnboardingFlow';
import { OverviewPage } from '@/features/dashboard/pages/OverviewPage';
import { SubscriptionsPage } from '@/features/dashboard/pages/SubscriptionsPage';
import { SubscriptionDetailPage } from '@/features/dashboard/pages/SubscriptionDetailPage';
import { SettingsPage } from '@/features/dashboard/pages/SettingsPage';
import { ChatPage } from '@/features/dashboard/pages/ChatPage';
import { ComingSoonPage } from '@/features/dashboard/pages/ComingSoonPage';
import { BarChart3 } from 'lucide-react';
import Landing from '@/routes/Landing';
import Login from '@/routes/auth/Login';
import Signup from '@/routes/auth/Signup';
import ForgotPassword from '@/routes/auth/ForgotPassword';
import ResetPassword from '@/routes/auth/ResetPassword';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            {/* Full-screen onboarding wizard, outside the dashboard shell (no
                nav sidebar) but still auth-guarded. New users are routed here on
                first login; it returns to /dashboard on finish or exit. */}
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <OnboardingFlow />
                </ProtectedRoute>
              }
            />
            {/* Layout route: the shell (sidebar + <Outlet/>) stays mounted while
                the nested child routes below swap into its content area. Still
                guarded by ProtectedRoute, so the whole dashboard requires auth. */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<OverviewPage />} />
              <Route path="subscriptions" element={<SubscriptionsPage />} />
              <Route path="subscriptions/:id" element={<SubscriptionDetailPage />} />
              <Route
                path="reports"
                element={
                  <ComingSoonPage
                    icon={BarChart3}
                    titleKey="dashboard.nav.reports"
                    bodyKey="dashboard.comingSoon.reports"
                  />
                }
              />
              <Route path="chat" element={<ChatPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
