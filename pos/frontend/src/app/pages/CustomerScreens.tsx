/**
 * Screens customers look at, with no rail and no sign-in.
 *
 * - The customer display (#/display?register=...): a second window on the
 *   screen facing the customer. It follows its register (BroadcastChannel,
 *   same browser): a welcome when idle, the items and total as they are
 *   rung up, the amount due and the QR code to scan when paying, then the
 *   change and a thank-you.
 * - The order board (#/board): order numbers being made and ready to
 *   collect, live from the kitchen screen; for a TV over the counter.
 *
 * Both sit on the canvas in one rounded shell with the business on top, are
 * laid out on the app's type scale and zoomed up to fill a large screen, so
 * the hierarchy stays the same at any size.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BellRing, Check, ChefHat, QrCode, Store } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { listenDisplay } from '../lib/display.ts';
import type { DisplayLine, DisplayMessage } from '../lib/display.ts';
import { money } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { Mark } from '../components/Shell.tsx';
import { Empty, IconBadge, rowCls } from '../components/ui.tsx';

/** Zoom the screen so the type scale fills a large display (1x at 900px tall, up to 3x). */
function useZoom(): number {
  const calc = (): number => Math.max(1, Math.min(3, Math.min(window.innerHeight / 640, window.innerWidth / 960)));
  const [zoom, setZoom] = useState(calc);
  useEffect(() => {
    const on = (): void => setZoom(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return zoom;
}

const HEADLINE = 'num text-[26px] font-extrabold leading-[34px] tracking-[-0.01em]';

/** The whole screen: the canvas, one rounded shell, the business on top. */
function Screen({ zoom, business, children }: { zoom: number; business: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--ps-canvas)] text-[var(--ps-ink)]">
      <div style={{ zoom }} className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
        <div className="flex min-h-0 flex-1 flex-col gap-4 rounded-[36px] bg-[var(--ps-shell)] p-4 sm:gap-5 sm:p-6">
          <header className="flex min-h-9 shrink-0 items-center gap-3 px-1">
            <Mark size={36} />
            <p className="min-w-0 truncate text-[15px] font-bold">{business}</p>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The items as they are rung up; the newest stays in view. */
function Lines({ lines, currency, exp }: { lines: DisplayLine[]; currency: string; exp: number }): React.JSX.Element {
  const list = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const el = list.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <ul ref={list} className="ps-no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[18px]">
      {lines.slice(-12).map((l, i) => (
        <li key={i} className={cn(rowCls, 'flex items-start gap-3 px-3 py-2.5')}>
          <span className="num flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ps-card)] px-1.5 text-[13px] font-bold">{l.qty}</span>
          <span className="min-w-0 flex-1 py-[5px]">
            <span className="block text-[15px] font-bold leading-[22px]">{l.label}</span>
            {l.detail !== '' && <span className="block text-[13px] leading-[18px] text-[var(--ps-ink-2)]">{l.detail}</span>}
          </span>
          <span className="num shrink-0 py-[5px] text-[15px] font-bold leading-[22px]">{money(l.total, currency, exp)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One sum on the dark card. */
function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-full bg-[var(--ps-dark-2)] px-4 py-2">
      <span className="min-w-0 truncate text-[14px] text-[var(--ps-muted)]">{label}</span>
      <span className="num shrink-0 text-[15px] font-semibold">{value}</span>
    </div>
  );
}

export function DisplayPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const register = query.get('register') ?? '';
  const [msg, setMsg] = useState<DisplayMessage>({ type: 'idle', business: '' });
  const zoom = useZoom();
  useEffect(() => listenDisplay(register, setMsg), [register]);
  return (
    <Screen zoom={zoom} business={msg.type === 'hello' ? '' : msg.business}>
      {msg.type === 'idle' || msg.type === 'hello' ? (
        <section className="ps-rise ps-on-sand flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-[28px] bg-[var(--ps-sand)] p-6 text-center">
          <IconBadge icon={Store} size={56} tone="card" />
          <p className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Welcome</p>
          {msg.type === 'idle' && msg.business !== '' && <p className="text-[15px] text-[var(--ps-ink-2)]">{msg.business}</p>}
        </section>
      ) : msg.type === 'cart' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-4 sm:gap-5 md:grid-cols-[minmax(0,1fr)_320px] md:grid-rows-1">
          <section className="ps-rise ps-on-card flex min-h-0 min-w-0 flex-col rounded-[28px] bg-[var(--ps-card)] p-4 sm:p-6">
            <Lines lines={msg.lines} currency={msg.currency} exp={msg.exp} />
          </section>
          <section className="ps-rise ps-d1 ps-on-dark flex min-w-0 flex-col gap-4 rounded-[28px] bg-[var(--ps-dark)] p-5 text-[var(--ps-on-dark)] sm:p-6">
            <div>
              <p className="text-[15px] font-bold text-[var(--ps-muted)]">{msg.total < 0 ? 'Refund' : 'Total'}</p>
              <p className={cn(HEADLINE, 'mt-1 text-[var(--ps-accent)]')}>{money(Math.abs(msg.total), msg.currency, msg.exp)}</p>
            </div>
            <div className="mt-auto flex flex-col gap-2">
              <Row label="Subtotal" value={money(msg.subtotal, msg.currency, msg.exp)} />
              {msg.discount !== 0 && <Row label="Discounts" value={money(-msg.discount, msg.currency, msg.exp)} />}
              {msg.service !== 0 && <Row label="Service charge" value={money(msg.service, msg.currency, msg.exp)} />}
              {msg.tax !== 0 && <Row label={msg.taxIncluded ? 'Tax included' : 'Tax'} value={money(msg.tax, msg.currency, msg.exp)} />}
            </div>
          </section>
        </div>
      ) : msg.type === 'pay' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <section className="ps-pop ps-on-dark flex max-h-full w-full max-w-[420px] flex-col items-center gap-4 rounded-[28px] bg-[var(--ps-dark)] p-6 text-center text-[var(--ps-on-dark)]">
            <div className="shrink-0">
              <p className="text-[15px] font-bold text-[var(--ps-muted)]">Amount due</p>
              <p className={cn(HEADLINE, 'mt-1')}>{money(msg.due, msg.currency, msg.exp)}</p>
            </div>
            {msg.qr !== '' ? (
              <div className="flex min-h-0 w-full flex-col items-center gap-3 rounded-[22px] bg-[var(--ps-paper)] p-4">
                {/* The code gives way first when the screen is short. */}
                <img src={msg.qr} alt={`${msg.tender} QR code`} className="max-h-[240px] min-h-0 max-w-full object-contain" />
                <p className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-[var(--ps-paper-ink)]">
                  <QrCode size={14} aria-hidden /> Scan to pay with {msg.tender}
                </p>
              </div>
            ) : msg.tender !== '' ? (
              <p className="max-w-full truncate rounded-full bg-[var(--ps-dark-2)] px-5 py-2.5 text-[15px] font-semibold">{msg.tender}</p>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <section className="ps-pop ps-on-dark flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[28px] bg-[var(--ps-dark)] p-6 text-center text-[var(--ps-on-dark)]">
            <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-[var(--ps-dot)] text-[var(--ps-on-dot)]">
              <Check size={26} strokeWidth={2.6} />
            </span>
            <p className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Thank you</p>
            {(msg.change > 0 || msg.orderNo > 0) && (
              <div className="flex w-full flex-col gap-2">
                {msg.change > 0 && (
                  <p className="flex items-center justify-between gap-3 rounded-full bg-[var(--ps-dark-2)] py-2 pl-5 pr-5">
                    <span className="text-[15px] font-semibold text-[var(--ps-muted)]">Your change:</span>
                    <span className={cn(HEADLINE, 'text-[var(--ps-accent)]')}>{money(msg.change, msg.currency, msg.exp)}</span>
                  </p>
                )}
                {msg.orderNo > 0 && (
                  <p className="flex items-center justify-between gap-3 rounded-full bg-[var(--ps-dark-2)] py-2 pl-5 pr-5">
                    <span className="text-[15px] font-semibold text-[var(--ps-muted)]">Order</span>
                    <span className={HEADLINE}>{msg.orderNo}</span>
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </Screen>
  );
}

export function BoardPage(): React.JSX.Element {
  const d = useLive(() => api.board(), ['tickets'], []);
  const settings = useLive(() => api.settings(), ['settings'], []);
  const zoom = useZoom();
  const preparing = d.data?.preparing ?? [];
  const ready = d.data?.ready ?? [];
  return (
    <Screen zoom={zoom} business={settings.data?.business_name ?? ''}>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-4 sm:grid-cols-2 sm:grid-rows-1 sm:gap-5">
        <section className="ps-rise ps-on-card flex min-h-0 min-w-0 flex-col rounded-[28px] bg-[var(--ps-card)] p-5 sm:p-6">
          <div className="mb-4 flex shrink-0 items-center gap-2">
            <h2 className="text-[15px] font-bold">Preparing</h2>
            {preparing.length > 0 && <span className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--ps-row)] px-2 text-[12px] font-bold text-[var(--ps-ink-2)]">{preparing.length}</span>}
          </div>
          {d.data !== null && preparing.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <Empty icon={ChefHat} title="No orders in the kitchen" compact />
            </div>
          ) : (
            <ul className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-hidden">
              {preparing.map((t) => (
                <li key={t.id} className={cn(HEADLINE, 'flex h-14 items-center justify-center rounded-full bg-[var(--ps-row)]')}>
                  {t.order_no}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ps-rise ps-d1 ps-on-dark flex min-h-0 min-w-0 flex-col rounded-[28px] bg-[var(--ps-dark)] p-5 text-[var(--ps-on-dark)] sm:p-6">
          <div className="mb-4 flex shrink-0 items-center gap-2">
            <h2 className="text-[15px] font-bold text-[var(--ps-accent)]">Ready to collect</h2>
            {ready.length > 0 && <span className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--ps-dark-2)] px-2 text-[12px] font-bold">{ready.length}</span>}
          </div>
          {d.data !== null && ready.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <Empty icon={BellRing} title="No orders ready yet" dark compact />
            </div>
          ) : (
            <ul className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-hidden">
              {ready.map((t) => (
                <li key={t.id} className="ps-pop flex min-h-14 min-w-0 flex-col items-center justify-center rounded-[28px] bg-[var(--ps-dark-2)] px-2 py-1.5">
                  <span className={cn(HEADLINE, 'text-[var(--ps-accent)]')}>{t.order_no}</span>
                  {t.name !== '' && <span className="max-w-full truncate px-1 text-[12px] leading-4 text-[var(--ps-muted)]">{t.name}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Screen>
  );
}
