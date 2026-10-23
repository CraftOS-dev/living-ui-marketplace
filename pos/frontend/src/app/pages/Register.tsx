/**
 * The register (home): a greeting and the search on top, the category pills
 * and product tiles on the left, and the sale always on the right in its own
 * card, with what is due and the pay button in the dark card at its foot.
 * Options, returns and the keypad open over the tiles; paying grows out of
 * the pay button into a full screen. A barcode scanner works anywhere on
 * this page: a product's code adds it, a receipt's code opens it for a
 * return.
 *
 * Keyboard: F2 or / searches, F9 pays, Esc closes what is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Banknote, ChefHat, ChevronRight, ExternalLink, GripVertical, Link2, MonitorSmartphone, MoreHorizontal, Plus, RotateCcw, ShoppingBag, Ticket as TicketIcon } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { cartStore, newRef, priceCart, toInput, useCart } from '../lib/cart.ts';
import type { CartLine } from '../lib/cart.ts';
import { useApp } from '../lib/context.tsx';
import { post as postDisplay } from '../lib/display.ts';
import { money, time } from '../lib/format.ts';
import { absolute, navigate } from '../lib/router.ts';
import { saleSheet } from '../lib/saleSheet.ts';
import { useScanner } from '../lib/scanner.ts';
import { can, useSession } from '../lib/session.ts';
import { beep } from '../lib/sound.ts';
import type { CatalogProduct, SalePayment, Ticket } from '../lib/types.ts';
import { CashMoveDialog } from '../components/CashMove.tsx';
import { Catalog } from '../components/register/Catalog.tsx';
import { CartPane } from '../components/register/CartPane.tsx';
import { ItemPanel, defaultChoice, needsPanel } from '../components/register/ItemPanel.tsx';
import type { ItemChoice } from '../components/register/ItemPanel.tsx';
import { PayScreen } from '../components/register/PayScreen.tsx';
import { TextDialog } from '../components/register/Pickers.tsx';
import { ReturnPanel } from '../components/register/ReturnPanel.tsx';
import { CustomAmount, OpenRegister, TicketsDialog } from '../components/register/SmallPanels.tsx';
import { Badge, Button, Count, IconButton, Modal, Popover, SearchField, menuItem, originOf, rowCls, useConfirm } from '../components/ui.tsx';
import type { Origin } from '../components/ui.tsx';

/** What is open over the tiles. */
type Over = { kind: 'none' } | { kind: 'item'; product: CatalogProduct; edit: CartLine | null; preset: ItemChoice | null } | { kind: 'return'; sale: string } | { kind: 'keypad' };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A code nothing has: add it to a product, or make a new product with it. */
function UnknownCode({ code, onClose }: { code: string; onClose: () => void }): React.JSX.Element {
  const { catalog } = useApp();
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');
  const list = (catalog?.products ?? []).filter((p) => q.trim() === '' || p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  const link = async (p: CatalogProduct): Promise<void> => {
    try {
      await api.updateProduct({ product: p.id, barcodes: [...p.barcodes.map((b) => ({ code: b.code, variant: b.variant })), { code, variant: '' }] });
      toast.success(`Added the code to ${p.name}`);
      onClose();
    } catch {
      /* toasted */
    }
  };
  return (
    <Modal open onClose={onClose} title="A new code" description={`Nothing has the code ${code} yet.`} wide={linking}>
      {linking ? (
        <div className="flex flex-col gap-3">
          <SearchField value={q} onChange={setQ} placeholder="The product it belongs to" label="Find the product" autoFocus tone="card" />
          <ul className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => void link(p)} className={cn(rowCls, 'flex w-full items-center justify-between gap-3 bg-[var(--ps-card)] px-4 py-3 text-left hover:bg-[var(--ps-row)]')}>
                  <span className="truncate text-[14px] font-semibold">{p.name}</span>
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ps-muted)]" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            icon={Plus}
            dot
            onClick={() => {
              onClose();
              navigate('products', { new: '1', barcode: code });
            }}
          >
            New product with this code
          </Button>
          <Button variant="light" icon={Link2} onClick={() => setLinking(true)}>
            Add it to a product
          </Button>
        </div>
      )}
    </Modal>
  );
}

export function RegisterPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const app = useApp();
  const { settings, registers, productById, groupById, taxById, taxes, currency, exp } = app;
  const { register: registerId, session: signedIn } = useSession();
  const register = registers.find((r) => r.id === registerId);
  const cart = useCart();
  const [over, setOver] = useState<Over>({ kind: 'none' });
  const [paying, setPaying] = useState<{ origin: Origin; n: number } | null>(null);
  const [search, setSearch] = useState('');
  const [arranging, setArranging] = useState(false);
  const [dialog, setDialog] = useState<'tickets' | 'park' | 'cash' | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [originPayments, setOriginPayments] = useState<SalePayment[]>([]);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const payCount = useRef(0);
  const [confirmEl, confirm] = useConfirm();
  const ticketCount = app.status?.open_tickets ?? 0;
  const defaultType = settings?.default_order_type ?? '';

  useEffect(() => {
    if (registerId !== '') cartStore.useRegister(registerId, defaultType);
  }, [registerId, defaultType]);

  // Orders sends a return here: #/?return=R1-000123 opens that receipt.
  const returnFrom = query.get('return') ?? '';
  useEffect(() => {
    if (returnFrom === '') return;
    setOver({ kind: 'return', sale: returnFrom });
    window.history.replaceState(null, '', '#/');
  }, [returnFrom]);

  // The phone bar's sale button shows the sale.
  useEffect(() => {
    const show = (): void => {
      if (saleSheet.take()) setCartOpen(true);
    };
    show();
    return saleSheet.subscribe(show);
  }, []);

  const totals = useMemo(
    () => (settings === null ? null : priceCart(cart, { settings, productById, groupById, taxById, taxes })),
    [cart, settings, productById, groupById, taxById, taxes],
  );

  // The customer display shows the cart as it is built (the pay screen speaks for itself).
  useEffect(() => {
    if (totals === null || registerId === '' || paying !== null) return;
    const t = window.setTimeout(() => {
      if (cart.lines.length === 0) {
        postDisplay(registerId, { type: 'idle', business: settings?.business_name ?? '' });
        return;
      }
      postDisplay(registerId, {
        type: 'cart',
        business: settings?.business_name ?? '',
        currency,
        exp,
        lines: totals.lines.map((pl) => ({
          label: `${pl.label}${pl.variantName !== '' ? ` ${pl.variantName}` : ''}${pl.kind === 'return' || pl.kind === 'blind' ? ' (return)' : ''}`,
          detail: pl.modifiers.map((m) => m.name).join(', '),
          qty: pl.line.qty,
          total: pl.kind === 'return' || pl.kind === 'blind' ? pl.net : pl.gross - pl.lineDiscount,
        })),
        subtotal: totals.calc.subtotal,
        discount: totals.calc.discount_total,
        service: totals.calc.service_charge,
        tax: totals.calc.tax_total,
        taxIncluded: settings?.price_mode === 'inclusive',
        total: totals.calc.total,
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [totals, cart.lines.length, registerId, paying, settings, currency, exp]);

  const addChoice = (p: CatalogProduct, c: ItemChoice): void => {
    cartStore.addProduct({ product: p.id, variant: c.variant, modifiers: c.modifiers, qty: c.qty, price: c.price, note: c.note });
  };

  const pick = useCallback(
    (p: CatalogProduct): void => {
      if (needsPanel(p, groupById)) {
        setOver({ kind: 'item', product: p, edit: null, preset: null });
        return;
      }
      addChoice(p, defaultChoice(p, groupById));
      setSearch('');
    },
    [groupById],
  );

  const openOptions = (p: CatalogProduct): void => setOver({ kind: 'item', product: p, edit: null, preset: null });

  // Scans: a product's code adds it; a receipt's code opens it for a return.
  const onScan = useCallback(
    (code: string): void => {
      api
        .lookup(code)
        .then((hit) => {
          if (hit.type === 'product') {
            const p = productById.get(hit.product.id);
            if (p === undefined || !p.available) {
              beep('miss');
              toast.error(p === undefined ? `${hit.product.name} is not for sale` : `${p.name} is sold out`);
              return;
            }
            beep('ok');
            const choice = defaultChoice(p, groupById);
            if (hit.variant !== '') choice.variant = hit.variant;
            const missingVariant = p.variants.length > 1 && choice.variant === '';
            const needsChoice = p.open_price || missingVariant || p.modifier_groups.some((g) => (groupById.get(g)?.min ?? 0) > (groupById.get(g)?.options.filter((o) => o.is_default && o.available).length ?? 0));
            if (needsChoice) setOver({ kind: 'item', product: p, edit: null, preset: choice });
            else addChoice(p, choice);
          } else if (hit.type === 'sale') {
            beep('ok');
            setOver({ kind: 'return', sale: hit.sale.number });
          } else {
            beep('miss');
            if (can('catalog')) setUnknown(code);
            else toast.error(`Nothing has the code ${code}`);
          }
        })
        .catch(() => beep('miss'));
    },
    [productById, groupById],
  );
  useScanner(onScan, paying === null && over.kind === 'none' && dialog === null);

  const pay = useCallback(
    (from: HTMLElement | null): void => {
      if (totals === null || cart.lines.length === 0 || totals.problems.length > 0) return;
      if (register?.shift === null) return;
      // Refunds go back the way they were paid: remember the original payments.
      const first = cart.lines.find((l) => l.origin !== null)?.origin;
      if (first !== undefined && first !== null) {
        api
          .sale(first.sale_id)
          .then((s) => setOriginPayments(s.payments))
          .catch(() => setOriginPayments([]));
      } else setOriginPayments([]);
      payCount.current += 1;
      setPaying({ origin: originOf(from ?? document.querySelector('[data-pay-button]')), n: payCount.current });
    },
    [totals, cart.lines, register?.shift],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (document.querySelector('[role="dialog"]') !== null) return;
      if (e.key === 'F2' || (e.key === '/' && !typing)) {
        e.preventDefault();
        window.setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === 'F9') {
        e.preventDefault();
        pay(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pay]);

  const park = async (name: string): Promise<void> => {
    try {
      const ref = cart.ticketRef !== '' ? cart.ticketRef : newRef('T');
      const t = await api.park({
        ref,
        register: registerId,
        name,
        lines: toInput(cart),
        discount: cart.discount,
        order_type: cart.orderType,
        customer: cart.customer?.id ?? '',
        note: cart.note,
      });
      toast.success(`Saved ${t.name !== '' ? t.name : 'the ticket'}`);
      cartStore.clear(defaultType);
      setDialog(null);
      setCartOpen(false);
    } catch {
      /* toasted */
    }
  };

  const openTicket = async (t: Ticket): Promise<void> => {
    if (cart.lines.length > 0) {
      const ok = await confirm(
        cart.ticketRef !== '' ? 'The ticket you have open is saved first, with its changes.' : 'The sale you are ringing up is saved as a ticket first, so nothing is lost.',
        `Open ${t.name !== '' ? t.name : 'this ticket'}?`,
        'Save and open',
      );
      if (!ok) return;
      try {
        await api.park({
          ref: cart.ticketRef !== '' ? cart.ticketRef : newRef('T'),
          register: registerId,
          name: cart.name !== '' ? cart.name : `Saved ${time(new Date().toISOString())}`,
          lines: toInput(cart),
          discount: cart.discount,
          order_type: cart.orderType,
          customer: cart.customer?.id ?? '',
          note: cart.note,
        });
      } catch {
        return;
      }
    }
    try {
      const opened = await api.resume(t.ref, registerId);
      cartStore.loadTicket(opened, defaultType);
      setDialog(null);
    } catch {
      /* toasted */
    }
  };

  if (settings === null || totals === null || register === undefined) {
    return <div className="flex h-64 items-center justify-center text-[13px] text-[var(--ps-muted)]">Loading the register</div>;
  }

  const closed = register.shift === null;
  const blocked = closed ? 'Open the register first' : '';
  const first = signedIn?.staff.name.split(/\s+/)[0] ?? '';
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const cartPane = (onClose?: () => void): React.JSX.Element => (
    <CartPane
      totals={totals}
      blocked={blocked}
      onPay={(from) => {
        setCartOpen(false);
        pay(from);
      }}
      onPark={() => {
        if (cart.name !== '' || cart.ticketRef !== '') void park(cart.name);
        else setDialog('park');
      }}
      onOptions={(l) => {
        const p = productById.get(l.product);
        if (p !== undefined) setOver({ kind: 'item', product: p, edit: l, preset: null });
        setCartOpen(false);
      }}
      onReturns={() => {
        setCartOpen(false);
        setOver({ kind: 'return', sale: '' });
      }}
      onTickets={() => setDialog('tickets')}
      ticketCount={ticketCount}
      {...(onClose !== undefined ? { onClose } : {})}
    />
  );

  const editing = over.kind === 'item' ? over.edit : null;

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="ps-rise flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-bold leading-[34px] tracking-[-0.01em]">
              {greeting()}
              {first !== '' ? `, ${first}` : ''}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--ps-muted)]">
              <span>{dateLine}</span>
              <button type="button" onClick={() => navigate('shifts')} title="Cash and shifts" className="inline-flex items-center gap-1.5 font-semibold text-[var(--ps-ink-2)] hover:text-[var(--ps-ink)]">
                <span className={cn('size-2 rounded-full', closed ? 'bg-[var(--ps-muted)]' : 'bg-[var(--ps-green)]')} aria-hidden />
                {register.name} {closed ? 'is closed' : `open since ${time(register.shift?.opened ?? '')}`}
              </button>
            </p>
          </div>
          <div className="flex min-w-0 basis-full items-center justify-end gap-2 sm:basis-auto">
            {signedIn?.staff.training === true && <Badge tone="warn">Training</Badge>}
            <SearchField
              inputRef={searchRef}
              value={search}
              onChange={setSearch}
              onEnter={(v) => {
                const code = v.trim();
                if (code === '') return;
                const exact = (app.catalog?.products ?? []).find((p) => p.sku.toLowerCase() === code.toLowerCase() || p.barcodes.some((b) => b.code.toLowerCase() === code.toLowerCase()) || p.variants.some((x) => x.sku !== '' && x.sku.toLowerCase() === code.toLowerCase()));
                if (exact !== undefined || /^[A-Z0-9]{1,8}-\d{6}$/i.test(code)) {
                  onScan(code);
                  setSearch('');
                  return;
                }
                const matches = (app.catalog?.products ?? []).filter((p) => p.name.toLowerCase().includes(code.toLowerCase()));
                if (matches.length === 1 && matches[0] !== undefined) {
                  pick(matches[0]);
                  setSearch('');
                }
              }}
              placeholder="Search or scan"
              label="Search products (F2)"
              tone="card"
              className="min-w-0 flex-1 sm:w-72 sm:flex-none"
            />
            <div className="relative">
              <IconButton ref={moreRef} icon={MoreHorizontal} label="More" variant="light" size={44} aria-haspopup="menu" onClick={() => setMore((m) => !m)} />
              <Popover open={more} onClose={() => setMore(false)} keep={moreRef} align="right" className="w-64">
                {/* Phones: the sale is folded away until it is asked for. */}
                <button
                  type="button"
                  className={cn(menuItem, 'md:hidden')}
                  onClick={() => {
                    setMore(false);
                    setDialog('tickets');
                  }}
                >
                  <TicketIcon size={16} /> <span className="flex-1">Open tickets</span>
                  {ticketCount > 0 && <Count n={ticketCount} />}
                </button>
                <button
                  type="button"
                  className={cn(menuItem, 'md:hidden')}
                  onClick={() => {
                    setMore(false);
                    setOver({ kind: 'return', sale: '' });
                  }}
                >
                  <RotateCcw size={16} /> Return items
                </button>
                <a href={absolute('display', { register: registerId })} target="_blank" rel="noreferrer" className={menuItem} onClick={() => setMore(false)}>
                  <MonitorSmartphone size={16} /> <span className="flex-1">Customer display</span> <ExternalLink size={13} />
                </a>
                {settings.kitchen_enabled && (
                  <a href={absolute('board')} target="_blank" rel="noreferrer" className={menuItem} onClick={() => setMore(false)}>
                    <ChefHat size={16} /> <span className="flex-1">Order board</span> <ExternalLink size={13} />
                  </a>
                )}
                {!closed && (
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => {
                      setMore(false);
                      setDialog('cash');
                    }}
                  >
                    <Banknote size={16} /> Cash in or out
                  </button>
                )}
                {can('catalog') && !closed && (
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => {
                      setMore(false);
                      setSearch('');
                      setArranging(true);
                    }}
                  >
                    <GripVertical size={16} /> Arrange the tiles
                  </button>
                )}
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMore(false);
                    navigate('shifts');
                  }}
                >
                  <ArrowRight size={16} /> {closed ? 'Cash and shifts' : 'Close the register'}
                </button>
              </Popover>
            </div>
          </div>
        </header>

        <section aria-label="Products" className="min-w-0">
          {closed ? (
            <OpenRegister register={registerId} name={register.name} onOpened={() => app.reloadAll()} />
          ) : (
            <Catalog query={search} onPick={(p) => pick(p)} onOptions={openOptions} onKeypad={() => setOver({ kind: 'keypad' })} arranging={arranging} onArrangeDone={() => setArranging(false)} />
          )}
        </section>
      </div>

      {/* The sale: always in view beside the tiles. */}
      <aside className="sticky top-8 hidden h-[calc(100vh-96px)] min-h-[520px] md:block" aria-label="Sale">
        {cartPane()}
      </aside>

      {/* Phones: a pill above the bar shows the sale as it grows. */}
      {cart.lines.length > 0 && !cartOpen && paying === null && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="ps-pop ps-on-ink fixed inset-x-4 bottom-[92px] z-30 flex h-14 items-center gap-3 rounded-full bg-[var(--ps-ink)] py-1.5 pl-1.5 pr-5 text-[var(--ps-shell)] shadow-[var(--ps-shadow-float)] md:hidden"
        >
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--ps-dot)] text-[var(--ps-on-dot)]">
            <ShoppingBag size={18} />
          </span>
          <span className="flex-1 text-left text-[14px] font-bold">{totals.items === 1 ? '1 item' : `${totals.items} items`}</span>
          <span className="num text-[15px] font-bold text-[var(--ps-accent)]">{money(Math.abs(totals.calc.total), currency, exp)}</span>
          <ChevronRight size={18} aria-hidden />
        </button>
      )}
      {cartOpen && <div className="fixed inset-0 z-50 bg-[var(--ps-shell)] p-3 md:hidden">{cartPane(() => setCartOpen(false))}</div>}

      {over.kind === 'item' && (
        <ItemPanel
          key={`${over.product.id}${editing?.key ?? ''}`}
          product={over.product}
          initial={editing !== null ? { variant: editing.variant, modifiers: editing.modifiers, qty: editing.qty, price: editing.price, note: editing.note } : (over.preset ?? undefined)}
          submitLabel={editing !== null ? 'Update' : 'Add'}
          onClose={() => setOver({ kind: 'none' })}
          onSubmit={(c) => {
            if (editing !== null) {
              cartStore.update(editing.key, { variant: c.variant, modifiers: c.modifiers, note: c.note, price: c.price });
              cartStore.setQty(editing.key, c.qty);
            } else addChoice(over.product, c);
            setOver({ kind: 'none' });
            setSearch('');
          }}
        />
      )}
      {over.kind === 'return' && <ReturnPanel initialSale={over.sale} onClose={() => setOver({ kind: 'none' })} />}
      {over.kind === 'keypad' && (
        <CustomAmount
          onClose={() => setOver({ kind: 'none' })}
          onAdd={(name, price, taxClass) => {
            cartStore.addCustom(name, price, taxClass);
            toast.success(`Added ${money(price, currency, exp)}`);
          }}
        />
      )}

      {paying !== null && (
        <PayScreen
          key={paying.n}
          origin={paying.origin}
          cart={cart}
          totals={totals}
          register={registerId}
          registerName={register.name}
          originPayments={originPayments}
          onPaid={() => cartStore.clear(defaultType)}
          onClosed={() => setPaying(null)}
          onShiftClosed={() => app.reloadAll()}
        />
      )}

      {dialog === 'tickets' && <TicketsDialog current={cart.ticketRef} onClose={() => setDialog(null)} onOpen={(t) => void openTicket(t)} />}
      {dialog === 'park' && (
        <TextDialog
          title="Save as a ticket"
          label="Table, name or number"
          initial=""
          max={40}
          quick={['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'Bar', 'Takeaway']}
          confirmLabel="Save ticket"
          onClose={() => setDialog(null)}
          onSave={(v) => void park(v)}
        />
      )}
      {dialog === 'cash' && <CashMoveDialog register={registerId} onClose={() => setDialog(null)} />}
      {unknown !== null && <UnknownCode code={unknown} onClose={() => setUnknown(null)} />}
      {confirmEl}
    </div>
  );
}
