/**
 * CAD Workshop: design real, editable parts. A part is a feature tree
 * driven by named parameters, built by the OpenCascade kernel on this
 * computer. An AI agent operates the same operations through the agent-app
 * CLI, and everything it does shows up here live.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { getPbClient } from '../kit/index.ts';
import { NewPartProvider } from './components/NewPart.tsx';
import { Frame } from './components/Shell.tsx';
import { AppDataProvider, useApp } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { trackTrail, useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { ExportsPage } from './pages/Exports.tsx';
import { HomePage } from './pages/Home.tsx';
import { PartPage } from './pages/Part.tsx';
import { PartsPage } from './pages/Parts.tsx';
import { RequestsPage } from './pages/Requests.tsx';
import { SettingsPage } from './pages/Settings.tsx';

// Views legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// All realtime subscriptions in one tick, before any view mounts (see live.ts).
startLive();
// Back buttons follow the app's own trail (see router.ts).
trackTrail();

function Content({ page, query }: { page: Page; query: URLSearchParams }): React.JSX.Element {
  switch (page) {
    case 'parts':
      return <PartsPage query={query} />;
    case 'part':
      return <PartPage id={query.get('id') ?? ''} />;
    case 'exports':
      return <ExportsPage />;
    case 'activity':
      return <ActivityPage />;
    case 'requests':
      return <RequestsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

function Root(): React.JSX.Element {
  const { ready } = useApp();
  const route = useRoute();
  return (
    <Frame page={route.page} wide={route.page === 'part'}>
      {ready ? (
        <div key={route.page === 'part' ? 'part:' + (route.query.get('id') ?? '') : route.page} className={route.page === 'part' ? 'h-full' : undefined}>
          <Content page={route.page} query={route.query} />
        </div>
      ) : (
        <div className="flex h-[60vh] items-center justify-center">
          <span aria-label="Loading" className="size-5 animate-spin rounded-full border-2 border-[var(--cw-ink)] border-t-transparent" />
        </div>
      )}
    </Frame>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppDataProvider>
      <NewPartProvider>
        <Root />
      </NewPartProvider>
    </AppDataProvider>
  );
}
