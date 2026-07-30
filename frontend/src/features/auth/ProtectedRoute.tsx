import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';
import { PreferredLanguageSync } from '@/i18n/PreferredLanguageSync';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return null;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Mounted here because it is the one place that wraps BOTH the onboarding wizard
  // and the dashboard — the two first destinations after signup. It renders nothing
  // and only runs once a session exists, so no profile query is issued for a
  // visitor who is about to be redirected to /login.
  return (
    <>
      <PreferredLanguageSync accessToken={session.access_token} />
      {children}
    </>
  );
}
