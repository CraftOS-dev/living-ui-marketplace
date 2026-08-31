/**
 * Company OS, shell + hash router. LoginGate (multi-user) wraps this in
 * main.tsx; here we gate on the company record: no company yet → onboarding
 * wizard; otherwise the sidebar + the active page. Inactive-module pages
 * render an activation prompt instead of content (Journey links land there).
 */
import { useCallback, useEffect, useState } from 'react';
import { Spinner, getPbClient } from '../kit/index.ts';
import { useAuth } from './lib/useAuth.ts';
import './theme.css';

// PocketBase's SDK auto-cancels concurrent list requests to the same
// collection (its cancel key ignores query params), which randomly blanks
// whichever live view lost the race. This app legitimately keeps several
// views on one collection at once, so auto-cancellation is off for good.
getPbClient().pb.autoCancellation(false);
import { callOp } from './lib/ops.ts';
import type { ModuleKey, Page } from './lib/types.ts';
import { useCompany, useModules } from './lib/useCompany.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { ActivateGate } from './components/ActivateGate.tsx';
import { PendingApproval } from './components/PendingApproval.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { HomePage } from './pages/Home.tsx';
import { JourneyPage } from './pages/Journey.tsx';
import { CustomersPage } from './pages/Customers.tsx';
import { MoneyPage } from './pages/Money.tsx';
import { KanbanPage } from './pages/Kanban.tsx';
import { GoalsPage } from './pages/Goals.tsx';
import { TeamPage } from './pages/Team.tsx';
import { MeetingsPage } from './pages/Meetings.tsx';
import { ProcessesPage } from './pages/Processes.tsx';
import { MarketingPage } from './pages/Marketing.tsx';
import { NotesPage } from './pages/Notes.tsx';
import { FilesPage } from './pages/Files.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { SettingsPage } from './pages/Settings.tsx';

const PAGES: readonly Page[] = [
  'home',
  'journey',
  'customers',
  'money',
  'kanban',
  'goals',
  'team',
  'meetings',
  'processes',
  'marketing',
  'notes',
  'files',
  'profile',
  'settings',
];

function pageFromHash(): Page {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (PAGES as readonly string[]).includes(raw) ? (raw as Page) : 'home';
}

const MODULE_PAGES: readonly ModuleKey[] = [
  'customers',
  'money',
  'kanban',
  'goals',
  'team',
  'meetings',
  'processes',
  'marketing',
];

export function App(): React.JSX.Element {
  const { company, vocab, loading } = useCompany();
  const { activeKeys, suggestedKeys } = useModules();
  const { userId, email, role, approved, authReady, refresh, logout } = useAuth();
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    const onHash = (): void => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: Page): void => {
    window.location.hash = `/${next}`;
  }, []);

  // Silent journey auto-detection on load: steps complete from real data
  // without manual ticking. Best-effort; failures stay quiet.
  useEffect(() => {
    if (company === null) return;
    void callOp('/api/ops/journey-autocheck').catch(() => undefined);
  }, [company === null]);

  // Wait for the token to be validated/refreshed before deciding access, so an
  // approved user never briefly sees the "pending" screen (and vice-versa).
  if (userId !== null && !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Signed in but not approved: no company data at all until an admin grants it.
  if (userId !== null && !approved) {
    return <PendingApproval email={email} onRefresh={refresh} onSignOut={logout} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (company === null) {
    return <Onboarding />;
  }

  const isOwner = role === 'owner';
  const isAdmin = role === 'owner' || role === 'admin';
  const moduleKey = (MODULE_PAGES as readonly string[]).includes(page)
    ? (page as ModuleKey)
    : null;
  // The Team page hosts access management, so an owner/admin can always open it
  // even when the Team module itself is turned off for this stage.
  const gated = moduleKey !== null && !activeKeys.has(moduleKey) && !(page === 'team' && isAdmin);
  const ownerBlocked = !isAdmin && (page === 'money' || page === 'settings');

  let content: React.JSX.Element;
  if (ownerBlocked) {
    content = (
      <p className="py-16 text-center text-sm text-[var(--lui-muted)]">
        This page is only visible to the company owner.
      </p>
    );
  } else if (gated && moduleKey !== null) {
    content = (
      <ActivateGate
        moduleKey={moduleKey}
        vocab={vocab}
        suggested={suggestedKeys.has(moduleKey)}
      />
    );
  } else {
    switch (page) {
      case 'journey':
        content = <JourneyPage company={company} onNavigate={navigate} />;
        break;
      case 'customers':
        content = <CustomersPage company={company} vocab={vocab} />;
        break;
      case 'money':
        content = <MoneyPage company={company} />;
        break;
      case 'kanban':
        content = <KanbanPage />;
        break;
      case 'goals':
        content = <GoalsPage />;
        break;
      case 'team':
        content = <TeamPage company={company} />;
        break;
      case 'meetings':
        content = <MeetingsPage />;
        break;
      case 'processes':
        content = <ProcessesPage company={company} />;
        break;
      case 'marketing':
        content = <MarketingPage vocab={vocab} />;
        break;
      case 'notes':
        content = <NotesPage />;
        break;
      case 'files':
        content = <FilesPage />;
        break;
      case 'profile':
        content = <ProfilePage company={company} />;
        break;
      case 'settings':
        content = <SettingsPage company={company} />;
        break;
      default:
        content = <HomePage company={company} onNavigate={navigate} />;
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        page={page}
        onNavigate={navigate}
        activeKeys={activeKeys}
        isAdmin={isAdmin}
        companyName={company.name}
        stage={company.stage}
        vocab={vocab}
      />
      <main className="min-w-0 flex-1 px-4 pb-12 pt-16 md:px-8 md:pt-8">
        <div key={page} className="cos-page mx-auto max-w-5xl">
          {content}
        </div>
      </main>
    </div>
  );
}
