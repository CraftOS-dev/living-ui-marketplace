/**
 * ERP: sales, purchasing, stock, manufacturing, money, accounting, people,
 * payroll and projects for a team of 1 to 5,000, with your AI agent working
 * through the same operations (agent-app CLI) under the same rules.
 *
 * Before the app: setup (first run) or sign in. After: the frame (sidebar,
 * search, "+"), and the page of the current route.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { Suspense, useEffect, useMemo } from 'react';
import { Lock } from 'lucide-react';
import { getPbClient } from '../kit/index.ts';
import { CreateProvider } from './components/Create.tsx';
import { PaletteProvider } from './components/Palette.tsx';
import { Frame, Mark } from './components/Shell.tsx';
import { Card, Empty, PageSkeleton, PillButton } from './components/ui.tsx';
import { startLive, useOnChange } from './lib/live.ts';
import { useMe } from './lib/me.ts';
import { buildNav, offered } from './lib/nav.ts';
import { navigate, trackTrail, useRoute } from './lib/router.ts';
import { boot, refreshMe, useSession } from './lib/session.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { SetupScreen, SignInScreen } from './pages/Welcome.tsx';
import { ROUTES } from './routes.tsx';

// Screens legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// One realtime hub, subscribed in one tick before any view mounts (see live.ts).
startLive();
// Back buttons follow the app's own trail (see router.ts).
trackTrail();

function Splash(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--erp-canvas)]">
      <span className="erp-pulse">
        <Mark size={48} />
      </span>
    </div>
  );
}

/** A list page this member's role does not include (reached by an old or shared link). */
function NotOffered(): React.JSX.Element {
  return (
    <Card>
      <Empty
        icon={Lock}
        title="This page is not part of your role"
        action={
          <PillButton variant="soft" onClick={() => navigate('home')}>
            Go to Home
          </PillButton>
        }
      >
        Your role, or the modules your company uses, do not include it. An administrator can change that in Settings.
      </Empty>
    </Card>
  );
}

function Signed(): React.JSX.Element {
  const route = useRoute();
  const me = useMe();
  // Modules switched on or off and rights changed elsewhere reach the menu and pages without a reload.
  // (Not members: they change at every sign-in, and every open screen would ask again.)
  useOnChange(['settings', 'roles'], () => void refreshMe());
  const nav = useMemo(() => buildNav(me, []), [me]);
  const Page = ROUTES[route.page];
  // A page remounts when it shows another record (or opens its "new" form);
  // filters, tabs and searches in the address update it in place.
  const key = ['id', 'kind', 'type', 'new'].reduce((k, name) => `${k}|${route.query.get(name) ?? ''}`, route.page);
  return (
    <PaletteProvider>
      <CreateProvider>
        <Frame route={route}>
          <Suspense fallback={<PageSkeleton />}>
            <div key={key}>{offered(nav, route.page) ? <Page query={route.query} /> : <NotOffered />}</div>
          </Suspense>
        </Frame>
      </CreateProvider>
    </PaletteProvider>
  );
}

export function App(): React.JSX.Element {
  const s = useSession();
  useEffect(() => {
    void boot();
  }, []);
  useEffect(() => {
    document.title = s.me !== null ? `${s.me.company.name} · ERP` : 'ERP';
  }, [s.me]);
  if (s.phase === 'loading') return <Splash />;
  if (s.phase === 'setup') return <SetupScreen />;
  if (s.phase === 'signed_out') return <SignInScreen notice={s.notice} company={s.company} />;
  return <Signed />;
}
