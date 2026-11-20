/**
 * HR OS: HR and payroll for every company, country and currency in one
 * place, with your AI agent working through the same operations (agent-app
 * CLI) under the same rules.
 *
 * Before the app: first-run setup, or sign in (and accepting an invite).
 * After: the frame (sidebar, page, phone bottom bar) and the page of the
 * current route; '#/print/...' routes render alone on an A4 sheet.
 * A module's public route (the time kiosk) renders alone in any session
 * state once the company is set up.
 */
import './theme.css';
import { useEffect, useMemo } from 'react';
import { CloudOff, Users } from 'lucide-react';
import { getPbClient } from '../kit/index.ts';
import { Frame, resolve, type Resolved } from './components/shell/Frame.tsx';
import { Button, ConfirmHost, Empty, PinHost, Spinner, Toasts, toast } from './components/ui.tsx';
import { onPinNotSet } from './lib/api.ts';
import { allowed, boot, useSession } from './lib/auth.tsx';
import { t } from './lib/i18n.ts';
import { startLive } from './lib/live.ts';
import { navigate, useRoute } from './lib/router.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { InvitePage, SignInPage } from './pages/auth/SignIn.tsx';
import { PrintFrame } from './pages/print/index.tsx';
import { SetupPage } from './pages/setup/index.tsx';
import { allRoutes, publicRoutes } from './routes.tsx';

// Screens legitimately load the same operation twice; the SDK's auto-cancel would blank one.
getPbClient().pb.autoCancellation(false);
// Colours follow the host theme with contrast checks (see themeColors.ts).
startThemeColors();
// One realtime hub, subscribed in one tick before any view mounts (see live.ts).
startLive();
// A confirm operation by someone without a PIN: offer the way to set one.
onPinNotSet(() => toast.info(t('pin.not_set'), { label: t('pin.set_now'), run: () => navigate('/settings/security') }));

function Splash(): React.JSX.Element {
  return (
    <div className="flex h-[100dvh] items-center justify-center gap-2 bg-[var(--hr-page)] text-[var(--hr-muted)]">
      <Users size={18} aria-hidden />
      <Spinner />
    </div>
  );
}

function Offline(): React.JSX.Element {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[var(--hr-page)]">
      <Empty icon={CloudOff} title={t('app.offline')} action={<Button onClick={() => void boot()}>{t('ui.try_again')}</Button>}>
        {t('app.offline_text')}
      </Empty>
    </div>
  );
}

function Signed(): React.JSX.Element {
  const route = useRoute();
  const s = useSession();
  const routes = useMemo(() => allRoutes(), []);
  const found = resolve(route.path, routes);
  if (found !== null && found.route.frame === 'print' && s.me !== null && allowed(s.me, found.route.perm)) {
    const Page = found.route.page;
    return (
      <PrintFrame title={found.route.title}>
        <Page params={found.params} query={route.query} />
      </PrintFrame>
    );
  }
  return <Frame />;
}

const PUBLIC = publicRoutes();

/** A page that opens before sign-in (the time kiosk), alone: no shell, no session. */
function PublicPage({ found }: { found: Resolved }): React.JSX.Element {
  const route = useRoute();
  const Page = found.route.page;
  useEffect(() => {
    document.title = `${found.route.title} · HR OS`;
  }, [found.route.title]);
  return (
    <main id="hr-main" className="min-h-[100dvh] bg-[var(--hr-page)]">
      <Page key={JSON.stringify(found.params)} params={found.params} query={route.query} />
    </main>
  );
}

function Screen(): React.JSX.Element {
  const s = useSession();
  const route = useRoute();
  if (s.phase === 'loading') return <Splash />;
  if (s.phase === 'offline') return <Offline />;
  if (s.phase === 'setup') return <SetupPage />;
  const open = resolve(route.path, PUBLIC);
  if (open !== null) return <PublicPage found={open} />;
  if (s.phase === 'signed_out') return route.path === '/invite' ? <InvitePage /> : <SignInPage notice={s.notice} company={s.company} logo={s.logo} />;
  return <Signed />;
}

export function App(): React.JSX.Element {
  useEffect(() => {
    void boot();
  }, []);
  return (
    <>
      <Screen />
      <Toasts />
      <PinHost />
      <ConfirmHost />
    </>
  );
}
