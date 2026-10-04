/**
 * Entertainment IP Manager: shell and hash router. The kit's LoginGate
 * (multi-user) wraps this in main.tsx. First run: the first account is the
 * admin and sets up the organization; everyone else waits until that is
 * done. External accounts (licensees, committee members, outside reviewers)
 * see only their portal and their account. Pages of switched-off modules
 * fall back to Today. Changing the language remounts the page tree.
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
import { t } from './lib/i18n.ts';
import { useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import type { ModuleKey } from './lib/shapes.ts';
import { LanguageSwitch, Sidebar, TopBar } from './components/shell.tsx';
import { Onboarding } from './pages/Onboarding.tsx';

// Checked before main.tsx mounts the kit's login gate (this module is
// imported first), so no request ever carries a token the server has lost.
await dropStaleSession();

// Pages load on first visit so the first paint only carries the shell.
const TodayPage = lazy(() => import('./pages/Today.tsx').then((m) => ({ default: m.TodayPage })));
const InboxPage = lazy(() => import('./pages/Inbox.tsx').then((m) => ({ default: m.InboxPage })));
const DeadlinesPage = lazy(() => import('./pages/Deadlines.tsx').then((m) => ({ default: m.DeadlinesPage })));
const ReportsPage = lazy(() => import('./pages/Reports.tsx').then((m) => ({ default: m.ReportsPage })));
const FranchisesPage = lazy(() => import('./pages/Franchises.tsx').then((m) => ({ default: m.FranchisesPage })));
const FranchisePage = lazy(() => import('./pages/Franchise.tsx').then((m) => ({ default: m.FranchisePage })));
const CharactersPage = lazy(() => import('./pages/Characters.tsx').then((m) => ({ default: m.CharactersPage })));
const CharacterPage = lazy(() => import('./pages/Character.tsx').then((m) => ({ default: m.CharacterPage })));
const TalentsPage = lazy(() => import('./pages/Talents.tsx').then((m) => ({ default: m.TalentsPage })));
const TalentPage = lazy(() => import('./pages/Talent.tsx').then((m) => ({ default: m.TalentPage })));
const TitlesPage = lazy(() => import('./pages/Titles.tsx').then((m) => ({ default: m.TitlesPage })));
const TitlePage = lazy(() => import('./pages/Title.tsx').then((m) => ({ default: m.TitlePage })));
const MusicPage = lazy(() => import('./pages/Music.tsx').then((m) => ({ default: m.MusicPage })));
const SongPage = lazy(() => import('./pages/Song.tsx').then((m) => ({ default: m.SongPage })));
const RecordingPage = lazy(() => import('./pages/Recording.tsx').then((m) => ({ default: m.RecordingPage })));
const CanWePage = lazy(() => import('./pages/CanWe.tsx').then((m) => ({ default: m.CanWePage })));
const AgreementsPage = lazy(() => import('./pages/Agreements.tsx').then((m) => ({ default: m.AgreementsPage })));
const AgreementPage = lazy(() => import('./pages/Agreement.tsx').then((m) => ({ default: m.AgreementPage })));
const CommitteesPage = lazy(() => import('./pages/Committees.tsx').then((m) => ({ default: m.CommitteesPage })));
const CommitteePage = lazy(() => import('./pages/Committee.tsx').then((m) => ({ default: m.CommitteePage })));
const PermissionsPage = lazy(() => import('./pages/Permissions.tsx').then((m) => ({ default: m.PermissionsPage })));
const ProductsPage = lazy(() => import('./pages/Products.tsx').then((m) => ({ default: m.ProductsPage })));
const ProductPage = lazy(() => import('./pages/Product.tsx').then((m) => ({ default: m.ProductPage })));
const ApprovalsPage = lazy(() => import('./pages/Approvals.tsx').then((m) => ({ default: m.ApprovalsPage })));
const RoyaltiesPage = lazy(() => import('./pages/Royalties.tsx').then((m) => ({ default: m.RoyaltiesPage })));
const TrademarksPage = lazy(() => import('./pages/Trademarks.tsx').then((m) => ({ default: m.TrademarksPage })));
const MatterPage = lazy(() => import('./pages/Matter.tsx').then((m) => ({ default: m.MatterPage })));
const FamilyPage = lazy(() => import('./pages/Family.tsx').then((m) => ({ default: m.FamilyPage })));
const RenewalsPage = lazy(() => import('./pages/Renewals.tsx').then((m) => ({ default: m.RenewalsPage })));
const EnforcementPage = lazy(() => import('./pages/Enforcement.tsx').then((m) => ({ default: m.EnforcementPage })));
const CasePage = lazy(() => import('./pages/Case.tsx').then((m) => ({ default: m.CasePage })));
const GuidelinesPage = lazy(() => import('./pages/Guidelines.tsx').then((m) => ({ default: m.GuidelinesPage })));
const PeoplePage = lazy(() => import('./pages/People.tsx').then((m) => ({ default: m.PeoplePage })));
const SettingsPage = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.SettingsPage })));
const PortalPage = lazy(() => import('./pages/Portal.tsx').then((m) => ({ default: m.PortalPage })));

const EXTERNAL_PAGES: Page[] = ['portal', 'settings'];

/** The module a page belongs to; pages of switched-off modules fall back to Today. */
const PAGE_MODULE: Partial<Record<Page, ModuleKey>> = {
  franchises: 'franchises',
  franchise: 'franchises',
  talents: 'talents',
  talent: 'talents',
  titles: 'titles',
  title: 'titles',
  music: 'music',
  song: 'music',
  recording: 'music',
  committees: 'committees',
  committee: 'committees',
  permissions: 'permissions',
  products: 'products',
  product: 'products',
  approvals: 'approvals',
  royalties: 'royalties',
  guidelines: 'guidelines',
};

function PageLoading(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-[var(--agent-app-muted)]">
      <Loader2 size={15} className="animate-spin" aria-hidden /> {t('Loading')}
    </div>
  );
}

function Content({ page, id }: { page: Page; id: string }): React.JSX.Element {
  switch (page) {
    case 'inbox':
      return <InboxPage id={id} />;
    case 'deadlines':
      return <DeadlinesPage id={id} />;
    case 'reports':
      return <ReportsPage />;
    case 'franchises':
      return <FranchisesPage />;
    case 'franchise':
      return <FranchisePage id={id} />;
    case 'characters':
      return <CharactersPage />;
    case 'character':
      return <CharacterPage id={id} />;
    case 'talents':
      return <TalentsPage />;
    case 'talent':
      return <TalentPage id={id} />;
    case 'titles':
      return <TitlesPage />;
    case 'title':
      return <TitlePage id={id} />;
    case 'music':
      return <MusicPage />;
    case 'song':
      return <SongPage id={id} />;
    case 'recording':
      return <RecordingPage id={id} />;
    case 'canwe':
      return <CanWePage />;
    case 'agreements':
      return <AgreementsPage />;
    case 'agreement':
      return <AgreementPage id={id} />;
    case 'committees':
      return <CommitteesPage />;
    case 'committee':
      return <CommitteePage id={id} />;
    case 'permissions':
      return <PermissionsPage />;
    case 'products':
      return <ProductsPage />;
    case 'product':
      return <ProductPage id={id} />;
    case 'approvals':
      return <ApprovalsPage />;
    case 'royalties':
      return <RoyaltiesPage />;
    case 'trademarks':
      return <TrademarksPage />;
    case 'matter':
      return <MatterPage id={id} />;
    case 'family':
      return <FamilyPage id={id} />;
    case 'renewals':
      return <RenewalsPage />;
    case 'enforcement':
      return <EnforcementPage />;
    case 'case':
      return <CasePage id={id} />;
    case 'guidelines':
      return <GuidelinesPage />;
    case 'people':
      return <PeoplePage id={id} />;
    case 'settings':
      return <SettingsPage />;
    case 'portal':
      return <PortalPage />;
    default:
      return <TodayPage />;
  }
}

function Root(): React.JSX.Element {
  const { settings, settingsLoading, role, me, can, on, lang } = useApp();
  const route = useRoute();

  if (settingsLoading || (me === null && role === '')) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--agent-app-muted)]">
        <Loader2 size={16} className="mr-2 animate-spin" aria-hidden /> {t('Loading')}
      </div>
    );
  }

  if (settings !== null && !settings.onboarding_done && !can.external) {
    if (role === 'admin') return <Onboarding />;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <LanguageSwitch />
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">{t('Entertainment IP Manager is being set up')}</h1>
          <p className="mt-2 text-sm text-[var(--agent-app-muted)]">{t('The first account created is the administrator and finishes the setup. Once that is done, this page opens automatically.')}</p>
        </div>
      </div>
    );
  }

  let page = route.page;
  if (can.external) {
    if (!EXTERNAL_PAGES.includes(page)) page = 'portal';
  } else {
    if (page === 'portal') page = 'today';
    const m = PAGE_MODULE[page];
    if (m !== undefined && !on(m)) page = 'today';
  }

  return (
    <div className="flex min-h-screen" key={lang}>
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
