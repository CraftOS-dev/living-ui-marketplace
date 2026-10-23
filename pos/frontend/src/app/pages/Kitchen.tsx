/**
 * The kitchen screen: one card per paid order with what the kitchen makes,
 * oldest first, each with its order number, name, how it is served and how
 * long it has waited (the wait turns amber, then red, and says so in
 * words). "Ready" calls the order (it shows on the order board and its card
 * turns sand); "Collected" clears it; anything can be brought back. The
 * dark all-day card adds up what is still to make across every ticket.
 */
import { useEffect, useRef, useState } from 'react';
import { ChefHat, Check, ExternalLink, StickyNote, Undo2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { ORDER_TYPE_LABEL, ago, minutesSince, time } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { absolute } from '../lib/router.ts';
import { beep } from '../lib/sound.ts';
import type { KitchenTicket } from '../lib/types.ts';
import { Badge, Button, Card, CardHeader, Count, Empty, IconButton, PageHeader, Segmented, Spinner } from '../components/ui.tsx';

const WARN_MIN = 5;
const LATE_MIN = 10;

const TICKET_GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3';

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function TicketCard({ t, now, busy, onBump, onRecall }: { t: KitchenTicket; now: number; busy: boolean; onBump: () => void; onRecall: () => void }): React.JSX.Element {
  const waited = minutesSince(t.created, now);
  const age = t.status !== 'new' ? 'ok' : waited >= LATE_MIN ? 'late' : waited >= WARN_MIN ? 'warn' : 'ok';
  const ready = t.status === 'ready';
  // Soft blocks are gray on a white card; on the sand card of a ready order they are white, and the quantity sits on sand.
  const soft = ready ? 'ps-on-card bg-[var(--ps-card)]' : 'bg-[var(--ps-row)]';
  const dot = ready ? 'bg-[var(--ps-sand)]' : 'bg-[var(--ps-card)]';
  // The name and how it is served; without either, the receipt number (unless it is the headline already).
  const named = [t.name, t.order_type !== '' ? (ORDER_TYPE_LABEL[t.order_type] ?? t.order_type) : ''].filter((x) => x !== '');
  const tags = named.length > 0 ? named : t.order_no > 0 ? [t.number] : [];
  return (
    <article className={cn('ps-rise flex min-w-0 flex-col gap-4 rounded-[24px] p-5 text-[var(--ps-ink)]', ready ? 'ps-on-sand bg-[var(--ps-sand)]' : 'ps-on-card bg-[var(--ps-card)]')}>
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <p className="num min-w-0 truncate text-[26px] font-extrabold leading-[34px] tracking-[-0.01em]">{t.order_no > 0 ? t.order_no : t.number}</p>
          <Badge tone={age === 'late' ? 'bad' : age === 'warn' ? 'warn' : ready ? 'good' : 'neutral'} className="num mt-1">
            {ready ? `Ready ${time(t.ready_at)}` : `${ago(t.created, now)}${age === 'late' ? ', late' : ''}`}
          </Badge>
        </div>
        {(tags.length > 0 || t.training) && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className={cn('inline-flex h-7 min-w-0 max-w-full items-center rounded-full px-3 text-[12px] font-semibold text-[var(--ps-ink-2)]', soft)}>
                <span className="truncate">{tag}</span>
              </span>
            ))}
            {t.training && <Badge tone="warn">Training</Badge>}
          </div>
        )}
      </header>
      <ul className="flex flex-1 flex-col gap-2">
        {t.items.map((it, i) => (
          <li key={i} className={cn('flex items-start gap-3 rounded-[18px] px-3 py-2.5', soft)}>
            <span className={cn('num flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1.5 text-[13px] font-bold', dot)}>{it.qty}</span>
            <span className="min-w-0 flex-1 py-1">
              <span className="block text-[15px] font-bold leading-[22px]">
                {it.name}
                {it.variant !== '' && <span className="font-semibold text-[var(--ps-ink-2)]"> {it.variant}</span>}
              </span>
              {it.modifiers.length > 0 && <span className="block text-[13px] leading-[18px] text-[var(--ps-ink-2)]">{it.modifiers.join(', ')}</span>}
              {it.note !== '' && <span className="mt-0.5 block text-[13px] font-semibold italic leading-[18px] text-[var(--ps-amber-text)]">{it.note}</span>}
            </span>
          </li>
        ))}
        {t.note !== '' && (
          <li className={cn('flex items-start gap-2 rounded-[18px] px-4 py-2.5 text-[13px] italic leading-[18px]', soft)}>
            <StickyNote size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--ps-muted)]" />
            <span className="min-w-0 flex-1">{t.note}</span>
          </li>
        )}
      </ul>
      <footer className="flex gap-2">
        {t.status === 'done' ? (
          <Button size="lg" className="flex-1" icon={Undo2} disabled={busy} onClick={onRecall}>
            Back to ready
          </Button>
        ) : (
          <>
            {ready && <IconButton icon={Undo2} label="Back to the kitchen" variant="light" size={56} disabled={busy} onClick={onRecall} />}
            <Button variant="primary" size="lg" className="min-w-0 flex-1" icon={Check} dot disabled={busy} onClick={onBump}>
              {t.status === 'new' ? 'Ready' : 'Collected'}
            </Button>
          </>
        )}
      </footer>
    </article>
  );
}

export function KitchenPage(): React.JSX.Element {
  const [view, setView] = useState<'active' | 'done'>('active');
  const d = useLive(() => api.kitchen(view), ['tickets'], [view]);
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  // A new order chimes once.
  useEffect(() => {
    if (d.data === null || view !== 'active') return;
    const ids = new Set(d.data.tickets.map((t) => t.id));
    if (seen.current !== null && d.data.tickets.some((t) => t.status === 'new' && !seen.current?.has(t.id))) beep('ok');
    seen.current = ids;
  }, [d.data, view]);

  const act = async (t: KitchenTicket, fn: (id: string) => Promise<unknown>): Promise<void> => {
    setBusy(t.id);
    try {
      await fn(t.id);
    } catch {
      /* toasted */
    } finally {
      setBusy(null);
    }
  };

  const tickets = d.data?.tickets ?? [];
  const making = tickets.filter((t) => t.status === 'new');
  const ready = tickets.filter((t) => t.status === 'ready');
  const allDay = d.data?.all_day ?? [];
  const toMake = allDay.reduce((s, a) => s + a.qty, 0);
  const card = (t: KitchenTicket): React.JSX.Element => <TicketCard key={t.id} t={t} now={now} busy={busy === t.id} onBump={() => void act(t, api.bump)} onRecall={() => void act(t, api.recall)} />;
  return (
    <div>
      <PageHeader
        title="Kitchen"
        subtitle={d.data !== null ? `${d.data.counts.new} to make · ${d.data.counts.ready} ready` : undefined}
        actions={
          <>
            <Segmented
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: 'active', label: 'Open' },
                { value: 'done', label: 'Collected' },
              ]}
              className="bg-[var(--ps-card)]"
            />
            <a href={absolute('board')} target="_blank" rel="noreferrer" className="ps-press inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--ps-card)] px-5 text-[14px] font-semibold text-[var(--ps-ink)] hover:bg-[var(--ps-row)]">
              <ExternalLink size={16} aria-hidden /> Order board
            </a>
          </>
        }
      />
      {d.data === null ? (
        <Card>
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        </Card>
      ) : view === 'active' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-8 xl:col-span-9">
            {making.length === 0 && ready.length === 0 ? (
              <Card>
                <Empty icon={ChefHat} title="Nothing to make" />
              </Card>
            ) : (
              <>
                {making.length > 0 && <div className={TICKET_GRID}>{making.map(card)}</div>}
                {ready.length > 0 && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 px-1">
                      <h2 className="text-[15px] font-bold">Ready to collect</h2>
                      <Count n={ready.length} />
                    </div>
                    <div className={TICKET_GRID}>{ready.map(card)}</div>
                  </section>
                )}
              </>
            )}
          </div>
          <Card tone="dark" delay={1} className="lg:sticky lg:top-8 lg:col-span-4 xl:col-span-3">
            <CardHeader title="All day" subtitle="Still to make" action={allDay.length > 0 ? <span className="num text-[26px] font-extrabold leading-[34px] tracking-[-0.01em] text-[var(--ps-accent)]">{toMake}</span> : undefined} />
            {allDay.length === 0 ? (
              <p className="rounded-full bg-[var(--ps-dark-2)] px-4 py-3 text-[13px] text-[var(--ps-muted)]">Nothing waiting</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {allDay.map((a) => (
                  <li key={a.name} className="flex min-h-11 items-center justify-between gap-3 rounded-full bg-[var(--ps-dark-2)] py-1.5 pl-4 pr-1.5">
                    <span className="min-w-0 truncate text-[13px] font-semibold">{a.name}</span>
                    <span className="num flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ps-dark)] px-2 text-[15px] font-bold text-[var(--ps-accent)]">{a.qty}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : tickets.length === 0 ? (
        <Card>
          <Empty icon={ChefHat} title="Nothing collected yet" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{tickets.map(card)}</div>
      )}
    </div>
  );
}
