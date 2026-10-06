/**
 * NetSentry — app shell and navigation (docs/SYSTEM-V4-PLAN.md §5). It looks after the one server
 * it runs on, in five places: Home (is everything OK, what to fix, your apps, ask the agent), Apps,
 * Server, Activity (what happened) and Settings. Every page you walk into is its own address, one
 * level of detail at a time, with breadcrumbs back (paths in lib/nav.ts); addresses from earlier
 * versions still land somewhere sensible.
 */
import { useEffect, useState } from 'react';
import { AppShell, Button, getPbClient, IdentityChip, Pill, Select, SidebarNav } from '../kit/index.ts';
import { useCollection } from './store/collections.ts';
import { Breadcrumbs } from './components/Breadcrumbs.tsx';
import { ActivityIcon, BoxIcon, GaugeIcon, ServerIcon, ShieldIcon, SlidersIcon } from './components/icons.tsx';
import { MeProvider, useMe } from './lib/me.tsx';
import { DetailScope } from './lib/view.tsx';
import { go } from './lib/nav.ts';
import { capitalize } from './lib/format.ts';
import type { Sensor, Settings as SettingsRecord } from './lib/types.ts';
import { Activity, type ActivityTab } from './pages/Activity.tsx';
import { APP_PARTS, type AppPart } from './pages/AppPage.tsx';
import { LiveProvider } from './lib/liveStatus.tsx';
import { Provider } from 'react-redux';
import { store } from './store/store.ts';
import { AppsSetup } from './pages/AppsSetup.tsx';
import { FixPage } from './pages/Fixes.tsx';
import { IssuePage } from './pages/IssuePage.tsx';
import { Home as SecurityScore } from './pages/Home.tsx';
import { IncidentDetail } from './pages/IncidentDetail.tsx';
import { AcceptedRisks } from './pages/AcceptedRisks.tsx';
import { InstallApp } from './pages/InstallApp.tsx';
import { Apps } from './pages/Apps.tsx';
import { AllIssues, Issues, type IssuesTab } from './pages/Issues.tsx';
import { ServerHome } from './pages/ServerHome.tsx';
import { ServerPage, SERVER_TABS, type ServerTab } from './pages/Server.tsx';
import { Settings, SETTINGS_TABS, type SettingsTab } from './pages/Settings.tsx';
import { Setup, setupSeen } from './pages/Setup.tsx';
import './theme.css';

// Several screens read the same collection with different filters at once
// (e.g. the nav badge and the page body). The SDK's default auto-cancellation
// keys requests by path, so one of them would be silently cancelled and render
// as an empty list. Each hook owns its own request, so turn it off.
getPbClient().pb.autoCancellation(false);

type Page = 'home' | 'apps' | 'app' | 'server' | 'activity' | 'settings' | 'setup' | 'install' | 'issue' | 'fix' | 'case' | 'issues' | 'score' | 'accepted';
type Place = 'home' | 'apps' | 'server' | 'activity' | 'settings';

const NAV: Array<{ key: Place; label: string; icon: React.JSX.Element }> = [
  { key: 'home', label: 'Home', icon: <GaugeIcon /> },
  { key: 'apps', label: 'Apps', icon: <BoxIcon /> },
  { key: 'server', label: 'Server', icon: <ServerIcon /> },
  { key: 'activity', label: 'Activity', icon: <ActivityIcon /> },
  { key: 'settings', label: 'Settings', icon: <SlidersIcon /> },
];

interface Route {
  page: Page;
  /** Record id (#/app/<id>, #/issue/<id>) or sub-page (#/server/network, #/settings/alerts). */
  sub: string | null;
  /** One level below a record: #/app/<id>/logs, #/issue/<id>/technical. */
  part: string | null;
}

/** Addresses from earlier versions → where that now lives. */
const LEGACY: Record<string, string> = {
  findings: 'issues',
  incidents: 'issues/cases',
  fixes: 'issues/fixes',
  assets: 'server',
  item: 'server',
  machines: 'server',
  protected: 'server',
  network: 'server/network',
  reports: 'home',
  sources: 'settings/checks',
  rules: 'settings/rules',
  workspace: 'settings/team',
  overview: 'score',
};

const RECORD_PAGES: Page[] = ['issue', 'fix', 'case', 'app'];
const PAGES: Page[] = ['home', 'apps', 'app', 'server', 'activity', 'settings', 'setup', 'install', 'issue', 'fix', 'case', 'issues', 'score', 'accepted'];

function parseHash(): Route {
  const [p = '', sub, part] = window.location.hash.replace(/^#\/?/, '').split('/');
  const clean = (x: string | undefined): string | null => (x && /^[a-z0-9_-]+$/.test(x) ? x : null);
  if (p === 'incidents' && sub) return { page: 'case', sub: clean(sub), part: null };
  if (LEGACY[p]) {
    const [lp, ls] = LEGACY[p]!.split('/');
    return { page: lp as Page, sub: ls ?? null, part: null };
  }
  const page = PAGES.includes(p as Page) ? (p as Page) : 'home';
  const id = clean(sub);
  if (RECORD_PAGES.includes(page) && !id) return { page: page === 'app' ? 'apps' : 'issues', sub: page === 'case' ? 'cases' : null, part: null };
  return { page, sub: id, part: clean(part) };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const SETUP_OFFERED = 'netsentry.setup.offered';

/** The place in the menu a page lives under. */
function placeOf(page: Page): Place {
  if (page === 'apps' || page === 'app' || page === 'install') return 'apps';
  if (page === 'server' || page === 'score') return 'server';
  if (page === 'activity' || page === 'accepted' || page === 'issues' || page === 'case') return 'activity';
  if (page === 'settings') return 'settings';
  return 'home';
}

function Shell(): React.JSX.Element {
  const { member, role, loading: meLoading, logout, can } = useMe();
  const { page, sub, part } = useHashRoute();
  const settings = useCollection<SettingsRecord>('settings');
  const monitors = useCollection<Sensor>('sensors', { filter: 'status != "revoked"' });
  const workspaceName = settings.records[0]?.workspace_name || 'NetSentry';

  // First visit with no monitor on this server yet: open the setup guide once (skipping it is remembered).
  const admin = can('admin');
  useEffect(() => {
    if (monitors.loading || meLoading || !admin || monitors.records.length > 0 || setupSeen() || page !== 'home') return;
    let offered = false;
    try {
      offered = window.sessionStorage.getItem(SETUP_OFFERED) === '1';
      window.sessionStorage.setItem(SETUP_OFFERED, '1');
    } catch {
      /* storage blocked: offer every time */
    }
    if (!offered) go('setup');
  }, [monitors.loading, monitors.records.length, meLoading, admin, page]);

  const active = placeOf(page);

  const brand = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-[var(--agent-app-accent)]">
        <ShieldIcon size={18} />
      </span>
      <span className="truncate text-sm font-semibold">{workspaceName}</span>
    </div>
  );

  const sidebar = (
    <SidebarNav
      className="hidden md:flex"
      brand={brand}
      active={active}
      onSelect={(k) => go(k)}
      sections={[{ items: NAV.map((p) => ({ key: p.key, label: p.label, icon: p.icon })) }]}
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <IdentityChip name={member?.email ?? '?'} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[12px]">{member?.email ?? ''}</p>
              {!meLoading && <Pill tone={role === 'admin' ? 'accent' : 'neutral'}>{capitalize(role)}</Pill>}
            </div>
          </div>
          <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={logout}>
            Sign out
          </Button>
        </div>
      }
    />
  );

  let content: React.JSX.Element;
  if (page === 'app' && sub) {
    // v4 §16: the app opens beside the list on wide screens (its own page on phones).
    const appPart = APP_PARTS.includes(part as AppPart) ? (part as AppPart) : null;
    content = <Apps selected={sub} part={appPart} />;
  } else if (page === 'issue' && sub) {
    content = <IssuePage key={sub} findingId={sub} technical={part === 'technical'} steps={part === 'steps'} />;
  } else if (page === 'fix' && sub) {
    content = <FixPage key={sub} id={sub} technical={part === 'technical'} />;
  } else if (page === 'case' && sub) {
    content = <IncidentDetail key={sub} incidentId={sub} technical={part === 'technical'} />;
  } else if (page === 'setup' && sub === 'apps') {
    content = <AppsSetup />;
  } else if (page === 'setup') {
    content = <Setup onFinish={() => go('home')} />;
  } else if (page === 'issues') {
    if (sub === 'all') {
      content = <AllIssues />;
    } else {
      const tab: IssuesTab = sub === 'cases' || sub === 'fixes' ? sub : 'list';
      const filter = sub === 'handled' ? 'acknowledged' : undefined;
      content = <Issues tab={tab} filter={filter} onTab={(t) => go(t === 'list' ? 'issues' : 'issues/' + t)} />;
    }
  } else if (page === 'server') {
    content = <ServerPage tab={SERVER_TABS.includes(sub as ServerTab) ? (sub as ServerTab) : null} />;
  } else if (page === 'activity') {
    const tab: ActivityTab = sub === 'changes' || sub === 'actions' || sub === 'network' ? sub : 'inbox';
    content = (
      <DetailScope on>
        <Breadcrumbs trail={[{ label: 'Home', to: 'home' }, { label: 'Activity' }]} />
        <Activity tab={tab} onTab={(t) => go(t === 'inbox' ? 'activity' : 'activity/' + t)} onOpenFinding={(id) => go('issue/' + id)} onOpenItem={() => go('server')} />
      </DetailScope>
    );
  } else if (page === 'settings') {
    const tab: SettingsTab = SETTINGS_TABS.includes(sub as SettingsTab) ? (sub as SettingsTab) : 'monitor';
    content = <Settings tab={tab} onTab={(t) => go('settings/' + t)} />;
  } else if (page === 'apps') {
    content = <Apps selected={null} part={null} />;
  } else if (page === 'install') {
    content = <InstallApp />;
  } else if (page === 'accepted') {
    content = <AcceptedRisks />;
  } else if (page === 'score') {
    content = (
      <DetailScope on>
        <SecurityScore />
      </DetailScope>
    );
  } else {
    content = <ServerHome />;
  }

  return (
    <AppShell sidebar={sidebar}>
      <div className="mb-4 flex items-center gap-3 md:hidden">
        {brand}
        <div className="ml-auto w-40">
          <Select aria-label="Navigate" value={active} onChange={(e) => go(e.target.value)} options={NAV.map((p) => ({ value: p.key, label: p.label }))} />
        </div>
        <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={logout}>
          Sign out
        </Button>
      </div>
      {content}
    </AppShell>
  );
}

export function App(): React.JSX.Element {
  return (
    <Provider store={store}>
      <MeProvider>
        <LiveProvider>
          <Shell />
        </LiveProvider>
      </MeProvider>
    </Provider>
  );
}
