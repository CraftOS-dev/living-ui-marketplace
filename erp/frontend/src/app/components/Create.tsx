/**
 * "New": the "+" grows into a full screen of everything the person can
 * start, grouped by what it is for (sell, buy, money, stock, make, people,
 * your AI agent). Each tile opens the page that makes it. Only what the
 * role may create is shown.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BookOpen,
  Boxes,
  CalendarPlus,
  Clock,
  ClipboardList,
  Factory,
  FileInput,
  FilePlus2,
  FileText,
  FolderPlus,
  HandCoins,
  MessageCircleQuestion,
  Package,
  PackagePlus,
  Receipt,
  ShoppingCart,
  Truck,
  UserPlus,
  Users,
} from 'lucide-react';
import { can, moduleOn, useMe } from '../lib/me.ts';
import { navigate } from '../lib/router.ts';
import type { Page, Query } from '../lib/router.ts';
import { ScreenBar, useFullScreen } from './FullScreen.tsx';

interface Tile {
  key: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  page: Page;
  query?: Query | undefined;
}

interface Group {
  key: string;
  label: string;
  tiles: Tile[];
}

const Ctx = createContext<{ open: (from?: Element | null) => void } | null>(null);

export function useCreate(): { open: (from?: Element | null) => void } {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useCreate outside CreateProvider');
  return v;
}

function useGroups(): Group[] {
  const me = useMe();
  return useMemo(() => {
    const groups: Group[] = [];
    const inv = moduleOn(me, 'inventory');
    const t = (key: string, label: string, sub: string, icon: LucideIcon, page: Page, query?: Query): Tile => ({ key, label, sub, icon, page, query });
    if (can(me, 'sales', 'edit')) {
      groups.push({
        key: 'sell',
        label: 'Sell',
        tiles: [
          t('invoice', 'Invoice', 'Bill a customer', FileText, 'doc-new', { type: 'invoice' }),
          t('quote', 'Quote', 'Price something up', FilePlus2, 'doc-new', { type: 'quote' }),
          t('sales_order', 'Sales order', 'Confirm what they ordered', ClipboardList, 'doc-new', { type: 'sales_order' }),
          ...(inv ? [t('delivery', 'Delivery', 'Send goods out', Truck, 'doc-new', { type: 'delivery' })] : []),
          t('credit_note', 'Credit note', 'Give money back', ArrowLeftRight, 'doc-new', { type: 'credit_note' }),
          t('customer', 'Customer', 'Someone you sell to', UserPlus, 'customers', { new: '1' }),
        ],
      });
    }
    if (can(me, 'purchasing', 'edit')) {
      groups.push({
        key: 'buy',
        label: 'Buy',
        tiles: [
          t('bill', 'Bill', 'Record what you owe', Receipt, 'doc-new', { type: 'bill' }),
          t('purchase_order', 'Purchase order', 'Order from a supplier', ShoppingCart, 'doc-new', { type: 'purchase_order' }),
          ...(inv ? [t('goods_receipt', 'Goods receipt', 'Take delivery', Package, 'doc-new', { type: 'goods_receipt' })] : []),
          t('supplier_credit', 'Supplier credit', 'A refund from a supplier', ArrowLeftRight, 'doc-new', { type: 'supplier_credit' }),
          t('supplier', 'Supplier', 'Someone you buy from', UserPlus, 'suppliers', { new: '1' }),
        ],
      });
    }
    const money: Tile[] = [];
    if (can(me, 'sales', 'edit') || can(me, 'banking', 'edit')) money.push(t('pay-in', 'Money in', 'A customer paid you', ArrowDownLeft, 'payments', { new: 'in' }));
    if (can(me, 'purchasing', 'edit') || can(me, 'banking', 'edit')) money.push(t('pay-out', 'Money out', 'Pay a supplier', ArrowUpRight, 'payments', { new: 'out' }));
    if (can(me, 'banking', 'full')) money.push(t('transfer', 'Transfer', 'Between your accounts', ArrowLeftRight, 'banks', { transfer: '1' }));
    if (can(me, 'accounting', 'full')) money.push(t('journal', 'Journal entry', 'Adjust the books', BookOpen, 'journals', { new: '1' }));
    if (money.length > 0) groups.push({ key: 'money', label: 'Money', tiles: money });
    const stock: Tile[] = [];
    if (can(me, 'inventory', 'edit')) {
      stock.push(t('item', 'Item', 'A product or service', PackagePlus, 'items', { new: '1' }));
      stock.push(t('stock-change', 'Stock change', 'Adjust, move or count', Boxes, 'stock-changes', { new: '1' }));
    } else if (can(me, 'sales', 'edit') || can(me, 'purchasing', 'edit')) stock.push(t('item', 'Item', 'A product or service', PackagePlus, 'items', { new: '1' }));
    if (can(me, 'manufacturing', 'edit')) stock.push(t('build', 'Build', 'Make finished goods', Factory, 'builds', { new: '1' }));
    if (stock.length > 0) groups.push({ key: 'stock', label: 'Stock', tiles: stock });
    const people: Tile[] = [];
    if (moduleOn(me, 'people') && me.employee !== null) {
      people.push(t('leave', 'Leave request', 'Time off', CalendarPlus, 'leave', { new: '1' }));
      people.push(t('claim', 'Expense claim', 'Get paid back', HandCoins, 'claims', { new: '1' }));
    }
    if (moduleOn(me, 'projects') && me.employee !== null) people.push(t('time', 'Timesheet', 'Log your hours', Clock, 'timesheets'));
    if (can(me, 'people', 'edit')) people.push(t('employee', 'Employee', 'Someone on the team', Users, 'employees', { new: '1' }));
    if (can(me, 'projects', 'edit')) people.push(t('project', 'Project', 'Work for a customer', FolderPlus, 'projects', { new: '1' }));
    if (people.length > 0) groups.push({ key: 'people', label: 'People and projects', tiles: people });
    groups.push({
      key: 'agent',
      label: 'Your AI agent',
      tiles: [t('inbox', 'Drop a file', 'A bill, receipt or statement', FileInput, 'inbox', { new: '1' }), t('ask', 'Ask a question', 'About the business', MessageCircleQuestion, 'asks', { new: '1' })],
    });
    return groups;
  }, [me]);
}

function CreateScreen({ onClose }: { onClose: () => void }): React.JSX.Element {
  const groups = useGroups();
  return (
    <div className="min-h-full">
      <ScreenBar title="New" onClose={onClose} />
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-4 pb-16 @min-[640px]:px-8">
        {groups.map((g, gi) => (
          <section key={g.key} className={`erp-rise erp-d${Math.min(5, gi + 1)}`}>
            <h3 className="mb-3 px-1 text-[13px] font-bold text-[var(--erp-muted)]">{g.label}</h3>
            <div className="grid grid-cols-2 gap-3 @min-[480px]:grid-cols-3 @min-[900px]:grid-cols-6">
              {g.tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate(tile.page, tile.query);
                    }}
                    className="group flex flex-col items-start gap-3 rounded-[22px] bg-[var(--erp-card)] p-4 text-left transition-[transform,box-shadow] hover:shadow-[0_20px_40px_-30px_rgba(29,28,26,0.6)] active:scale-[0.98]"
                  >
                    <span className="flex size-10 items-center justify-center rounded-full bg-[var(--erp-row)] text-[var(--erp-ink)] transition-colors group-hover:bg-[var(--erp-solid)] group-hover:text-[var(--erp-on-solid)]">
                      <Icon size={18} aria-hidden />
                    </span>
                    <span>
                      <span className="block text-[14px] font-bold">{tile.label}</span>
                      <span className="block text-[12px] text-[var(--erp-muted)]">{tile.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function CreateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const fs = useFullScreen();
  const value = useMemo(() => ({ open: fs.open }), [fs.open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {fs.node(<CreateScreen onClose={fs.close} />, { title: 'New' })}
    </Ctx.Provider>
  );
}
