/**
 * The home page: selling. Products on the left (search, scan, categories,
 * keypad), the sale on the right with one Charge button. On a phone the
 * products fill the screen and the sale opens from the bar at the bottom.
 */
import { useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { plain, qty as qtyText } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { useSession } from '../lib/session.tsx';
import type { Order, OrderLine, Product, Variant } from '../lib/types.ts';
import { CashMoveDialog, OpenDrawerDialog } from '../components/DrawerDialogs.tsx';
import { Catalog, needsSheet } from '../components/sell/Catalog.tsx';
import { Checkout } from '../components/sell/Checkout.tsx';
import { ClearDialog, CustomAmountDialog, CustomerPicker, GiftCardDialog, NameDialog, OrderDiscountDialog, ParkDialog } from '../components/sell/dialogs.tsx';
import { ItemDialog } from '../components/sell/ItemDialog.tsx';
import type { ItemChoice } from '../components/sell/ItemDialog.tsx';
import { LineDialog } from '../components/sell/LineDialog.tsx';
import { ReturnDialog } from '../components/sell/ReturnDialog.tsx';
import { TicketPanel } from '../components/sell/TicketPanel.tsx';
import type { TicketAction } from '../components/sell/TicketPanel.tsx';
import { TicketProvider, useTicket } from '../components/sell/ticket.tsx';
import { takeSellIntent } from '../components/sell/intent.ts';

type Dialog = 'customer' | 'discount' | 'name' | 'gift_card' | 'custom' | 'clear' | 'return' | 'open_drawer' | null;

function SellScreen(): React.JSX.Element {
  const { money, settings, catalog } = useStore();
  const { lock } = useSession();
  const ticket = useTicket();
  const [sheet, setSheet] = useState<{ product: Product; variant: Variant | null } | null>(null);
  const [line, setLine] = useState<OrderLine | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cash, setCash] = useState<'pay_in' | 'pay_out' | 'no_sale' | null>(null);
  const [park, setPark] = useState<Order | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [chargeAfterOpen, setChargeAfterOpen] = useState(false);
  const [mobileTicket, setMobileTicket] = useState(false);
  const [returnFrom, setReturnFrom] = useState('');

  // Work handed over from another page (a ticket to open, a receipt to return from).
  useEffect(() => {
    const intent = takeSellIntent();
    if (intent === null) return;
    if (intent.kind === 'open') ticket.open(intent.order);
    else if (intent.kind === 'customer') void ticket.change({ customer: intent.customer });
    else {
      setReturnFrom(intent.from);
      setDialog('return');
    }
    // Taken once, when the sell screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const drawer = useLive(() => api.currentShift(), ['shifts'], []);
  const drawerClosed = settings?.require_shift === true && drawer.data !== null && drawer.data.shift === null;
  const order = ticket.order !== null && ticket.order.status === 'open' ? ticket.order : null;
  const groups = new Map((catalog?.modifier_groups ?? []).map((g) => [g.id, g]));

  const pick = (product: Product, variant: Variant | null): void => {
    const live = product.variants.filter((v) => !v.archived);
    const v = variant ?? (live.length === 1 ? (live[0] ?? null) : null);
    const needs = product.sold_by === 'weight' || product.modifier_groups.some((g) => (groups.get(g)?.min ?? 0) > 0) || (v === null && needsSheet(product, groups));
    if (v !== null && !needs) {
      void ticket.add({ variant: v.id });
      return;
    }
    setSheet({ product, variant: v });
  };

  const addChoice = async (c: ItemChoice): Promise<boolean> => (await ticket.add({ variant: c.variant.id, qty: c.qty, modifiers: c.modifiers.length > 0 ? c.modifiers : undefined, note: c.note !== '' ? c.note : undefined })) !== null;

  const custom = async (amount: number, name: string, taxed: boolean): Promise<boolean> => (await ticket.add({ kind: 'custom', amount: plain(amount, money.digits), name: name !== '' ? name : undefined, tax: taxed ? 'default' : 'none' })) !== null;

  const charge = (): void => {
    if (drawerClosed) {
      setChargeAfterOpen(true);
      setDialog('open_drawer');
      return;
    }
    setCheckout(true);
  };

  const closeCheckout = (): void => {
    setCheckout(false);
    if (ticket.order !== null && ticket.order.status === 'paid') {
      ticket.open('');
      setMobileTicket(false);
      if (settings?.lock_after_sale === true) lock();
    }
  };

  const action = (a: TicketAction): void => {
    switch (a) {
      case 'new':
        if (order !== null && order.lines.length > 0) setPark(order);
        else ticket.open('');
        return;
      case 'tax':
        if (order !== null) void ticket.change({ tax_exempt: !order.tax_exempt });
        return;
      case 'no_sale':
      case 'pay_in':
      case 'pay_out':
        setCash(a);
        return;
      default:
        setDialog(a);
    }
  };

  const items = order?.items ?? 0;

  return (
    <div className="ps-touch grid h-full min-h-0 md:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className={cn('min-h-0 min-w-0', mobileTicket && 'hidden md:block')}>
        <Catalog onPick={pick} onCustom={custom} onGiftCard={() => setDialog('gift_card')} scanEnabled={sheet === null && line === null && dialog === null && !checkout && cash === null && park === null} />
      </div>
      <div className={cn('min-h-0 border-l border-[var(--ps-line)]', mobileTicket ? 'block' : 'hidden md:block')}>
        <TicketPanel onLine={setLine} onAction={action} onCharge={charge} drawerClosed={drawerClosed} onOpenDrawer={() => setDialog('open_drawer')} onBack={() => setMobileTicket(false)} />
      </div>

      {/* Phone: the sale opens from a bar above the navigation. */}
      {!mobileTicket && (
        <button type="button" onClick={() => setMobileTicket(true)} className="ps-on-dark fixed inset-x-3 bottom-[64px] z-30 flex h-12 items-center justify-between rounded-[var(--ps-r-md)] bg-[var(--ps-dark)] px-4 text-[var(--ps-on-dark)] shadow-[var(--ps-shadow)] md:hidden">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <ChevronUp size={16} />
            {items > 0 ? qtyText(items) + (items === 1 ? ' item' : ' items') : 'Sale'}
          </span>
          <span className="num text-[15px] font-bold">{money.fmt(order?.due ?? 0)}</span>
        </button>
      )}

      {sheet !== null && <ItemDialog product={sheet.product} initialVariant={sheet.variant} onClose={() => setSheet(null)} onDone={addChoice} />}
      <LineDialog line={line} onClose={() => setLine(null)} onSave={async (c) => (await ticket.changeLine(c)) !== null} onRemove={async (id) => (await ticket.removeLine(id)) !== null} />
      <CustomerPicker open={dialog === 'customer'} onClose={() => setDialog(null)} />
      <OrderDiscountDialog open={dialog === 'discount'} onClose={() => setDialog(null)} />
      <NameDialog open={dialog === 'name'} onClose={() => setDialog(null)} />
      <GiftCardDialog open={dialog === 'gift_card'} onClose={() => setDialog(null)} />
      <CustomAmountDialog open={dialog === 'custom'} onClose={() => setDialog(null)} />
      <ReturnDialog
        open={dialog === 'return'}
        from={returnFrom}
        onClose={() => {
          setDialog(null);
          setReturnFrom('');
        }}
      />
      <ClearDialog open={dialog === 'clear'} onClose={() => setDialog(null)} onCleared={() => ticket.open('')} />
      <ParkDialog
        order={park}
        onClose={() => setPark(null)}
        onKept={() => {
          setPark(null);
          ticket.open('');
        }}
        onClear={() => {
          setPark(null);
          setDialog('clear');
        }}
      />
      <OpenDrawerDialog
        open={dialog === 'open_drawer'}
        onClose={() => {
          setDialog(null);
          setChargeAfterOpen(false);
        }}
        onOpened={() => {
          drawer.reload();
          if (chargeAfterOpen) {
            setChargeAfterOpen(false);
            setCheckout(true);
          }
        }}
      />
      <CashMoveDialog kind={cash} onClose={() => setCash(null)} />
      <Checkout open={checkout} onClose={closeCheckout} />
    </div>
  );
}

export function SellPage(): React.JSX.Element {
  return (
    <TicketProvider>
      <SellScreen />
    </TicketProvider>
  );
}
