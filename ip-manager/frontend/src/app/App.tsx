/**
 * IP Manager: shell and hash router. The kit's LoginGate (multi-user) wraps
 * this in main.tsx. First run: the first account is the admin and sets up
 * the organization; everyone else waits until that is done. Inventors see
 * only their inventions and their account.
 */
import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { getPbClient } from '../kit/index.ts';
import './theme.css';

// PocketBase's SDK auto-cancels concurrent list requests to the same
// collection (the cancel key ignores query params), which randomly blanks
// views that legitimately watch one collection twice. Off for good.
getPbClient().pb.autoCancellation(false);

import { dropStaleSession } from './lib/api.ts';
import { AppDataProvider, useApp } from './lib/context.tsx';
import { useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { Sidebar, TopBar } from './components/shell.tsx';
import { Onboarding } from './pages/Onboarding.tsx';

// Checked before main.tsx mounts the kit's login gate (this module is
// imported first), so no request ever carries a token the server has lost.
await dropStaleSession();

// Pages load on first visit so the first paint only carries the shell.
const TodayPage = lazy(() => import('./pages/Today.tsx').then((m) => ({ default: m.TodayPage })));
const InboxPage = lazy(() => import('./pages/Inbox.tsx').then((m) => ({ default: m.InboxPage })));
const DeadlinesPage = lazy(() => import('./pages/Deadlines.tsx').then((m) => ({ default: m.DeadlinesPage })));
const RenewalsPage = lazy(() => import('./pages/Renewals.tsx').then((m) => ({ default: m.RenewalsPage })));
const PropertiesPage = lazy(() => import('./pages/Properties.tsx').then((m) => ({ default: m.PropertiesPage })));
const PropertyPage = lazy(() => import('./pages/Property.tsx').then((m) => ({ default: m.PropertyPage })));
const PortfolioPage = lazy(() => import('./pages/Portfolio.tsx').then((m) => ({ default: m.PortfolioPage })));
const MatterPage = lazy(() => import('./pages/Matter.tsx').then((m) => ({ default: m.MatterPage })));
const FamilyPage = lazy(() => import('./pages/Family.tsx').then((m) => ({ default: m.FamilyPage })));
const WorksPage = lazy(() => import('./pages/Works.tsx').then((m) => ({ default: m.WorksPage })));
const WorkPage = lazy(() => import('./pages/Work.tsx').then((m) => ({ default: m.WorkPage })));
const InventionsPage = lazy(() => import('./pages/Inventions.tsx').then((m) => ({ default: m.InventionsPage })));
const InventionPage = lazy(() => import('./pages/Invention.tsx').then((m) => ({ default: m.InventionPage })));
const AgreementsPage = lazy(() => import('./pages/Agreements.tsx').then((m) => ({ default: m.AgreementsPage })));
const AgreementPage = lazy(() => import('./pages/Agreement.tsx').then((m) => ({ default: m.AgreementPage })));
const RightsPage = lazy(() => import('./pages/Rights.tsx').then((m) => ({ default: m.RightsPage })));
const ApprovalsPage = lazy(() => import('./pages/Approvals.tsx').then((m) => ({ default: m.ApprovalsPage })));
const EnforcementPage = lazy(() => import('./pages/Enforcement.tsx').then((m) => ({ default: m.EnforcementPage })));
const PeoplePage = lazy(() => import('./pages/People.tsx').then((m) => ({ default: m.PeoplePage })));
const ReportsPage = lazy(() => import('./pages/Reports.tsx').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.SettingsPage })));

const INVENTOR_PAGES: Page[] = ['inventions', 'invention', 'settings'];

function PageLoading(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-[var(--agent-app-muted)]">
      <Loader2 size={15} className="animate-spin" aria-hidden /> Loading
    </div>
  );
}

function Content({ page, id }: { page: Page; id: string }): React.JSX.Element {
  switch (page) {
    case 'inbox':
      return <InboxPage id={id} />;
    case 'deadlines':
      return <DeadlinesPage id={id} />;
    case 'renewals':
      return <RenewalsPage />;
    case 'properties':
      return <PropertiesPage />;
    case 'property':
      return <PropertyPage id={id} />;
    case 'patents':
      return <PortfolioPage ipType="patent" />;
    case 'trademarks':
      return <PortfolioPage ipType="trademark" />;
    case 'designs':
      return <PortfolioPage ipType="design" />;
    case 'copyrights':
      return <PortfolioPage ipType="copyright" />;
    case 'matter':
      return <MatterPage id={id} />;
    case 'family':
      return <FamilyPage id={id} />;
    case 'works':
      return <WorksPage />;
    case 'work':
      return <WorkPage id={id} />;
    case 'inventions':
      return <InventionsPage />;
    case 'invention':
      return <InventionPage id={id} />;
    case 'agreements':
      return <AgreementsPage />;
    case 'agreement':
      return <AgreementPage id={id} />;
    case 'rights':
      return <RightsPage />;
    case 'approvals':
      return <ApprovalsPage />;
    case 'enforcement':
      return <EnforcementPage />;
    case 'people':
      return <PeoplePage id={id} />;
    case 'reports':
      return <ReportsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <TodayPage />;
  }
}

function Root(): React.JSX.Element {
  const { settings, settingsLoading, role, me } = useApp();
  const route = useRoute();

  if (settingsLoading || (me === null && role === '')) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--agent-app-muted)]">
        <Loader2 size={16} className="mr-2 animate-spin" aria-hidden /> Loading IP Manager
      </div>
    );
  }

  if (settings !== null && !settings.onboarding_done) {
    if (role === 'admin') return <Onboarding />;
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">IP Manager is being set up</h1>
          <p className="mt-2 text-sm text-[var(--agent-app-muted)]">
            The first account created is the administrator and finishes the setup. Once that is done, this page opens automatically.
          </p>
        </div>
      </div>
    );
  }

  let page = route.page;
  if (role === 'inventor' && !INVENTOR_PAGES.includes(page)) page = 'inventions';

  return (
    <div className="flex min-h-screen">
      <Sidebar page={page} />
      <main className="min-w-0 flex-1 px-4 pb-16 pt-16 md:px-8 md:pt-5">
        <div className="mx-auto max-w-7xl">
          <TopBar />
          <div key={`${page}/${route.id}`} className="ipm-page">
            <Suspense fallback={<PageLoading />}>
              <Content page={page} id={route.id} />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppDataProvider>
      <Root />
    </AppDataProvider>
  );
}
