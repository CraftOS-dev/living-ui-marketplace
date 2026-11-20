/**
 * Venture OS: a venture firm's deal flow, diligence, committee, portfolio,
 * funds and LP reporting in one place, with your AI agent working through
 * the same operations under the same rules.
 *
 * Before the app: first-run setup, or sign in (and accepting an invite, or
 * an owner's recovery). After: the frame and the page of the current route
 * (pages are collected by registry.ts from every module).
 */
import './theme.css';
import { Suspense, useEffect } from 'react';
import { CloudOff, Telescope } from 'lucide-react';
import { getPbClient } from '../kit/index.ts';
import { Frame, resolve } from './components/shell/Frame.tsx';
import { Button, ConfirmHost, Empty, PinHost, Spinner, Toasts, toast } from './components/ui.tsx';
import { onPinNotSet } from './lib/api.ts';
import { boot, useSession } from './lib/auth.ts';
import { startLive } from './lib/live.ts';
import { currentRoute, navigate, useRoute } from './lib/router.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { InvitePage, RecoverPage, SignInPage } from './pages/auth/index.tsx';
import { lazyPage, preloadPage } from './lib/lazy.ts';
import { routes } from './registry.ts';

const SetupPage = lazyPage(() => import('./pages/setup/index.tsx'), 'SetupPage');

// Screens legitimately load the same operation twice; the SDK's auto-cancel would blank one.
getPbClient().pb.autoCancellation(false);
// Colours follow the host theme with contrast checks (themeColors.ts).
startThemeColors();
// One realtime hub, subscribed in one tick before any view mounts (live.ts).
startLive();
// The first page's code loads while the session is checked, not after.
preloadPage(resolve(currentRoute().path, routes())?.route.page);
// A confirm operation by someone without a PIN: the way to set one.
onPinNotSet(() => toast.info('Set your approval PIN first.', { label: 'Set PIN', run: () => navigate('/settings/security') }));

function Splash(): React.JSX.Element {
  return (
    <div className="flex h-[100dvh] items-center justify-center gap-2 bg-[var(--vo-page)] text-[var(--vo-muted)]">
      <Telescope size={18} aria-hidden />
      <Spinner />
    </div>
  );
}

function Offline(): React.JSX.Element {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[var(--vo-page)]">
      <Empty icon={CloudOff} title="Cannot reach the app" action={<Button onClick={() => void boot()}>Try again</Button>} />
    </div>
  );
}

function Screen(): React.JSX.Element {
  const s = useSession();
  const route = useRoute();
  if (s.phase === 'loading') return <Splash />;
  if (s.phase === 'offline') return <Offline />;
  if (s.phase === 'setup') return <SetupPage />;
  if (s.phase === 'signed_out') {
    if (route.path === '/invite') return <InvitePage />;
    if (route.path === '/recover') return <RecoverPage />;
    return <SignInPage notice={s.notice} firm={s.firm} />;
  }
  return <Frame />;
}

export function App(): React.JSX.Element {
  useEffect(() => {
    void boot();
  }, []);
  return (
    <>
      <Suspense fallback={<Splash />}>
        <Screen />
      </Suspense>
      <Toasts />
      <PinHost />
      <ConfirmHost />
    </>
  );
}
