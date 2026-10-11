/**
 * Advance POS: ring up sales at the counter, take any payment, handle
 * returns and the cash drawer, and run the store behind it (products,
 * stock, customers, promotions, staff and reports). Your AI agent runs the
 * same operations through the agent-app CLI and is asked for help through
 * Requests: sending receipts, reviewing the drawer, drafting restock lists
 * and answering questions about the business.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { Lock } from 'lucide-react';
import { getPbClient } from '../kit/index.ts';
import { ApprovalProvider } from './components/Approval.tsx';
import { LockScreen, Unreachable } from './components/LockScreen.tsx';
import { Setup } from './components/Setup.tsx';
import { Frame } from './components/Shell.tsx';
import { Empty } from './components/ui.tsx';
import { StoreProvider, useStore } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { navigate, trackTrail, useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { SessionProvider, useSession } from './lib/session.tsx';
import { startThemeColors } from './lib/themeColors.ts';
import type { PermKey } from './lib/types.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { CustomerPage, CustomersPage } from './pages/Customers.tsx';
import { DisplayPage } from './pages/Display.tsx';
import { DrawerPage } from './pages/Drawer.tsx';
import { OrderPage, OrdersPage } from './pages/Orders.tsx';
import { ProductPage } from './pages/Product.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { PromotionsPage } from './pages/Promotions.tsx';
import { ReportsPage } from './pages/Reports.tsx';
import { RequestsPage } from './pages/Requests.tsx';
import { SellPage } from './pages/Sell.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { StockPage } from './pages/Stock.tsx';
import { TeamPage } from './pages/Team.tsx';
import { Button } from './components/ui.tsx';

// Views legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// All realtime subscriptions in one tick, before any view mounts (see live.ts).
startLive();
// Back buttons follow the app's own trail (see router.ts).
trackTrail();

/** Pages a role needs a permission for (the rail hides them too). */
const NEEDS: Partial<Record<Page, PermKey>> = {
  reports: 'view_reports',
  activity: 'view_reports',
  team: 'manage_staff',
  settings: 'manage_settings',
};

function Content({ page, query }: { page: Page; query: URLSearchParams }): React.JSX.Element {
  switch (page) {
    case 'orders':
      return <OrdersPage query={query} />;
    case 'order':
      return <OrderPage id={query.get('id') ?? ''} />;
    case 'products':
      return <ProductsPage query={query} />;
    case 'product':
      return <ProductPage id={query.get('id') ?? 'new'} />;
    case 'stock':
      return <StockPage query={query} />;
    case 'customers':
      return <CustomersPage />;
    case 'customer':
      return <CustomerPage id={query.get('id') ?? ''} />;
    case 'promotions':
      return <PromotionsPage query={query} />;
    case 'reports':
      return <ReportsPage />;
    case 'drawer':
      return <DrawerPage query={query} />;
    case 'team':
      return <TeamPage query={query} />;
    case 'activity':
      return <ActivityPage />;
    case 'requests':
      return <RequestsPage />;
    case 'settings':
      return <SettingsPage query={query} />;
    default:
      return <SellPage />;
  }
}

function Root(): React.JSX.Element {
  const { ready } = useStore();
  const { can } = useSession();
  const route = useRoute();
  const sell = route.page === 'home';
  const need = NEEDS[route.page];
  let body: React.JSX.Element;
  if (!ready) {
    body = (
      <div className="flex h-[60vh] items-center justify-center">
        <span aria-label="Loading" className="size-5 animate-spin rounded-full border-2 border-[var(--ps-ink)] border-t-transparent" />
      </div>
    );
  } else if (need !== undefined && !can(need)) {
    body = (
      <Empty icon={Lock} title="This page needs a manager" action={<Button onClick={() => navigate('home')}>Back to selling</Button>}>
        Your role does not include it. The owner can change what each role may do in Team, Permissions.
      </Empty>
    );
  } else {
    // A new address (a link, the rail, back) opens the page fresh; filters a
    // page writes into the address itself do not.
    const key = route.page + ':' + route.query.toString();
    body = (
      <div key={key} className={sell ? 'h-full' : undefined}>
        <Content page={route.page} query={route.query} />
      </div>
    );
  }
  return (
    <Frame page={route.page} wide={sell}>
      {body}
    </Frame>
  );
}

function Gate(): React.JSX.Element {
  const session = useSession();
  const route = useRoute();
  // The customer display needs no one signed in (it shows one register's sale).
  if (route.page === 'display') return <DisplayPage register={route.query.get('register') ?? ''} />;
  switch (session.phase) {
    case 'loading':
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--ps-shell)]">
          <span aria-label="Loading" className="size-5 animate-spin rounded-full border-2 border-[var(--ps-ink)] border-t-transparent" />
        </div>
      );
    case 'unreachable':
      return <Unreachable onRetry={session.reload} />;
    case 'setup':
      return <Setup />;
    case 'locked':
      return <LockScreen />;
    default:
      return (
        <StoreProvider>
          <ApprovalProvider>
            <Root />
          </ApprovalProvider>
        </StoreProvider>
      );
  }
}

export function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
