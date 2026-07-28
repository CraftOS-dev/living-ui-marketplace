/**
 * App entry for the V2 platform (multi-user).
 *
 * Bootstraps the ORIGINAL V1 crm-system frontend unchanged — same shadcn UI,
 * same behavior. Adaptation to the V2 (PocketBase) platform is confined to:
 *   1. ./services/apiAdapter — translates the V1 /api/* calls to the V2
 *      backend (PocketBase collections + ops) and bridges V1 /api/auth/* onto
 *      the PocketBase session.
 *   2. syncAuthToken() — the platform kit LoginGate authenticates the user and
 *      persists the PocketBase session under localStorage 'pocketbase_auth';
 *      V1's AuthService gates on its own 'auth_token' key, so we mirror the
 *      platform token into it (no second login screen).
 *
 * The adapter import is FIRST so its module-eval sets the sentinel backend URL
 * before the component modules (which read it at their own top level) evaluate.
 */
import { installApiAdapter } from './services/apiAdapter';
import { useEffect, useState } from 'react';
import { MainView } from './components/MainView';
import { uiCapture } from './services/UICapture';
import { AuthProvider, useAuth } from './components/auth/AuthProvider';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { Skeleton } from './components/ui/skeleton';
import './styles/global.css';

installApiAdapter();

const backendUrl =
  ((window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ ?? '') +
  '/api';
uiCapture.initialize(backendUrl, true, 2000);

// Mirror the platform's PocketBase session token (set by the kit LoginGate)
// into the key V1's AuthService reads, so V1 recognizes the existing session.
function syncAuthToken(): void {
  try {
    const raw = localStorage.getItem('pocketbase_auth');
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
    if (token) localStorage.setItem('auth_token', token);
    else localStorage.removeItem('auth_token');
  } catch {
    /* ignore malformed session */
  }
}

function AuthGate(): React.JSX.Element {
  const { isAuthenticated, loading } = useAuth();
  const [page, setPage] = useState<'login' | 'register'>('login');

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-3 p-6">
          <Skeleton className="h-10 w-10 rounded-lg mx-auto" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3 mx-auto" />
        </div>
      </div>
    );
  }
  if (!isAuthenticated) {
    return page === 'login' ? (
      <LoginPage onSwitchToRegister={() => setPage('register')} />
    ) : (
      <RegisterPage onSwitchToLogin={() => setPage('login')} />
    );
  }
  return <MainView />;
}

export function App(): React.JSX.Element {
  // Seed V1's auth_token from the platform session once, at first render,
  // before AuthProvider (a child) reads it in its state initializer.
  useState(() => {
    syncAuthToken();
    return 0;
  });

  useEffect(() => {
    uiCapture.registerComponent('App', { initialized: true, componentName: 'App' });
    return () => uiCapture.unregisterComponent('App');
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen">
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}
