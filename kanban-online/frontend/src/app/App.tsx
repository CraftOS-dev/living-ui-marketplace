/**
 * App entry for the V2 platform (multi-user).
 *
 * Bootstraps the ORIGINAL V1 kanban-online frontend unchanged — same board,
 * same auth-aware chrome (UserMenu, member list, invites), same "CraftBot
 * Browser Interface" look. Adaptation to the V2 platform is confined to:
 *   1. ./services/apiAdapter — translates V1 REST calls to the V2 backend
 *      (PocketBase collections + ops) and bridges V1 /api/auth/* onto the
 *      PocketBase session.
 *   2. syncAuthToken() below — the platform's kit LoginGate authenticates the
 *      user and persists the PocketBase session under localStorage
 *      'pocketbase_auth'. V1's AuthService gates on its own 'auth_token' key,
 *      so we mirror the platform token into it. This makes V1's AuthProvider
 *      recognize the already-authenticated session (no second login screen)
 *      while keeping every V1 component verbatim.
 *
 * The adapter import is FIRST so its module-eval sets the sentinel backend URL
 * before the component modules read it.
 */
import { installApiAdapter } from './services/apiAdapter';
import { useEffect, useState } from 'react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { MainView } from './components/MainView';
import { AppController } from './AppController';
import { uiCapture } from './services/UICapture';
import { AuthProvider, useAuth } from './components/auth/AuthProvider';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import './styles/global.css';
import './styles/theme-bridge.css';

installApiAdapter();

const backendUrl =
  ((window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ ?? '') +
  '/api';
uiCapture.initialize(backendUrl);

// Mirror the platform's PocketBase session token (set by the kit LoginGate)
// into the key V1's AuthService reads, so V1 sees the existing session.
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

const controller = new AppController();

function AuthGate(): React.JSX.Element {
  const { isAuthenticated, loading } = useAuth();
  const [page, setPage] = useState<'login' | 'register'>('login');

  useEffect(() => {
    if (isAuthenticated) {
      controller.initialize();
      uiCapture.registerComponent('App', { initialized: true, componentName: 'App' });
    }
    return () => {
      controller.cleanup();
      uiCapture.unregisterComponent('App');
    };
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-muted)',
        }}
      >
        Loading...
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

  return <MainView controller={controller} />;
}

export function App(): React.JSX.Element {
  // Seed V1's auth_token from the platform session once, during first render,
  // before AuthProvider (a child) reads it in its state initializer.
  useState(() => {
    syncAuthToken();
    return 0;
  });

  return (
    <AuthProvider>
      <div className="app">
        <AuthGate />
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          pauseOnHover
          theme="colored"
        />
      </div>
    </AuthProvider>
  );
}
