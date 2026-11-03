/**
 * Store OS: every online shop of one seller in one place. Overview, Orders,
 * Products, Inbox, Customers, Approvals, each shop and Settings, in the
 * frame (sidebar with the shops as a tree, top bar, your AI agent's panel).
 */
import '@fontsource-variable/inter';
import './theme.css';
import { useCallback, useEffect, useState } from 'react';
import { getPbClient } from '../kit/index.ts';
import { startLive } from './lib/live.ts';
import { useRoute } from './lib/router.ts';
import { StoreProvider, useStore } from './lib/store.tsx';
import { Notices } from './lib/toast.tsx';
import { AddShopDialog } from './components/AddShopDialog.tsx';
import { AgentPanel } from './components/AgentPanel.tsx';
import { SearchPalette } from './components/SearchPalette.tsx';
import { Frame, useOpenSignal } from './components/Shell.tsx';
import { ConfirmHost, Empty } from './components/ui.tsx';
import { ApprovalsPage } from './pages/Approvals.tsx';
import { CustomersPage } from './pages/Customers.tsx';
import { InboxPage } from './pages/Inbox.tsx';
import { OrdersPage } from './pages/Orders.tsx';
import { OverviewPage } from './pages/Overview.tsx';
import { ProductPage } from './pages/Product.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { ShopPage } from './pages/Shop.tsx';
import { ShopsPage } from './pages/Shops.tsx';
import { CloudOff } from 'lucide-react';

// Views load the same operation more than once; the SDK's auto-cancel would blank one.
getPbClient().pb.autoCancellation(false);

function Pages(): React.JSX.Element {
  const route = useRoute();
  const { settings, error } = useStore();
  const [addShop, setAddShop] = useState(false);
  useOpenSignal(
    'addShop',
    useCallback(() => setAddShop(true), []),
  );
  useEffect(() => {
    if (route.page !== 'orders' && route.page !== 'inbox' && route.page !== 'customers') window.scrollTo({ top: 0 });
  }, [route.page, route.sub]);
  if (settings === null && error !== null) {
    return (
      <div className="so-app grid min-h-screen place-items-center bg-[var(--so-canvas)]">
        <Empty icon={CloudOff} title="Store OS cannot reach its data">
          {error}
        </Empty>
      </div>
    );
  }
  const setUp = settings !== null && settings.base_currency !== '';
  return (
    <Frame route={route}>
      {(!setUp || route.page === 'overview') && <OverviewPage />}
      {setUp && route.page === 'orders' && <OrdersPage route={route} />}
      {setUp && route.page === 'products' && <ProductsPage route={route} />}
      {setUp && route.page === 'product' && <ProductPage id={route.sub} />}
      {setUp && route.page === 'inbox' && <InboxPage route={route} />}
      {setUp && route.page === 'customers' && <CustomersPage route={route} />}
      {setUp && route.page === 'approvals' && <ApprovalsPage route={route} />}
      {setUp && route.page === 'shops' && <ShopsPage />}
      {setUp && route.page === 'shop' && <ShopPage id={route.sub} />}
      {setUp && route.page === 'settings' && <SettingsPage route={route} />}
      <AddShopDialog open={addShop} onClose={() => setAddShop(false)} />
    </Frame>
  );
}

export function App(): React.JSX.Element {
  useEffect(() => {
    startLive();
  }, []);
  return (
    <StoreProvider>
      <Pages />
      <AgentPanel />
      <SearchPalette />
      <Notices />
      <ConfirmHost />
    </StoreProvider>
  );
}
