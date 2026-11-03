/**
 * Buyers across every shop: someone buying on Shopee and on your own store
 * is one customer when the email or phone matches.
 *
 *   all customers or repeat buyers, newest order first
 *   a buyer's panel (#/customers/<filter>/<customer id>): details edited in
 *   place, tags, every order on every shop and the conversations
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Mail, MessageSquare, Phone, Plus, ShoppingBag, UserRound, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDebounce } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { ago, dayShort, money, num, plural } from '../lib/format.ts';
import { go, href } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { useBase, useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { CustomerDetail, CustomerRow } from '../lib/types.ts';
import { OrderStatus } from '../components/badges.tsx';
import { InlineInput } from '../components/OrderDialogs.tsx';
import { PlatformMark, ShopChip } from '../components/PlatformMark.tsx';
import { Avatar, Button, Card, CardHeader, Drawer, Empty, IconBadge, PageHeader, PhoneList, PhoneRow, Pill, SearchField, Skeleton, TableCard, Tabs, Td, TextArea, Th, Tr } from '../components/ui.tsx';
import type { TabItem } from '../components/ui.tsx';

type Filter = 'all' | 'repeat';

interface CustomerList {
  total: number;
  repeat: number;
  customers: CustomerRow[];
}

const READS: Collection[] = ['customers', 'orders', 'threads'];
const PAGE = 100;
const SERVER_MAX = 500;

async function loadCustomers(params: Record<string, unknown>, limit: number, signal: AbortSignal): Promise<CustomerList> {
  const calls = Math.max(1, Math.ceil(limit / SERVER_MAX));
  const pages = await Promise.all(Array.from({ length: calls }, (_, i) => op<CustomerList>('customers.list', { ...params, limit: Math.min(SERVER_MAX, limit - i * SERVER_MAX), offset: i * SERVER_MAX }, { signal, quiet: true })));
  const first = pages[0];
  if (first === undefined) throw new Error('No answer from the app');
  return { ...first, customers: pages.flatMap((p) => p.customers) };
}

/* -------------------------------------------------------------------- page */

export function CustomersPage({ route }: { route: Route }): React.JSX.Element {
  const filter: Filter = route.sub === 'repeat' ? 'repeat' : 'all';
  const base = useBase();
  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim(), 250);
  const asked = filter + '|' + dq;
  const [paging, setPaging] = useState({ asked, limit: PAGE });
  const limit = paging.asked === asked ? paging.limit : PAGE;

  const list = useLive<CustomerList & { asked: string; everyone: number }>(
    'customers:' + asked,
    async (signal) => {
      const qp = dq === '' ? undefined : dq;
      const [res, all] = await Promise.all([
        loadCustomers({ filter, q: qp }, limit, signal),
        // The repeat list's total counts repeat buyers only; one row of the full list gives everyone.
        filter === 'repeat' ? op<CustomerList>('customers.list', { q: qp, limit: 1 }, { signal, quiet: true }) : Promise.resolve(null),
      ]);
      return { ...res, asked, everyone: all?.total ?? res.total };
    },
    READS,
    [asked, limit],
  );
  const data = list.data !== null && list.data.asked === asked ? list.data : null;
  const last = list.data;
  const rows = data?.customers ?? [];

  const more = data !== null && rows.length < data.total && rows.length >= limit;
  const loadMore = useCallback(() => setPaging({ asked, limit: limit + PAGE }), [asked, limit]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!more || el === null) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loadMore]);

  const tabs: TabItem<Filter>[] = [
    { key: 'all', label: 'All', count: last?.everyone },
    { key: 'repeat', label: 'Repeat buyers', count: last?.repeat },
  ];
  const subtitle = last === null ? undefined : last.everyone === 0 && dq === '' ? 'Buyers from every shop, in one list' : plural(last.everyone, 'customer') + ', ' + num(last.repeat) + ' bought more than once';

  return (
    <div>
      <PageHeader title="Customers" subtitle={subtitle} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs items={tabs} value={filter} onChange={(k) => go('customers', k)} className="so-rise" />
        <SearchField value={q} onChange={setQ} placeholder="Name, email or phone" onCard={false} className="w-full sm:w-72" />
      </div>

      <TableCard
        foot={
          data !== null && rows.length > 0 ? (
            <p className="text-[12px] text-[var(--so-muted)]">{rows.length < data.total ? 'Showing ' + num(rows.length) + ' of ' + num(data.total) : plural(data.total, filter === 'repeat' ? 'repeat buyer' : 'customer')}</p>
          ) : undefined
        }
      >
        {data === null && list.error !== null && !list.loading ? (
          <Empty icon={Users} title="Customers did not load" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>
            {list.error}
          </Empty>
        ) : data !== null && rows.length === 0 ? (
          dq !== '' ? (
            <Empty icon={Users} title={'No customers match "' + dq + '"'} action={<Button variant="secondary" onClick={() => setQ('')}>Clear search</Button>} />
          ) : filter === 'repeat' && data.everyone > 0 ? (
            <Empty icon={Users} title="No repeat buyers yet" action={<Button variant="secondary" onClick={() => go('customers', 'all')}>See all customers</Button>}>
              Buyers with more than one order show here.
            </Empty>
          ) : (
            <Empty icon={Users} title="No customers yet" action={<Button icon={ShoppingBag} onClick={() => go('orders', 'to_ship')}>Go to orders</Button>}>
              Customers appear when orders come in.
            </Empty>
          )
        ) : (
          <>
          <PhoneList label="Customers" wide>
            {data === null
              ? Array.from({ length: 6 }, (_, i) => (
                  <li key={i} className="flex items-center gap-3 border-t border-[var(--so-line)] px-3 py-3 first:border-t-0">
                    <Skeleton className="size-9 rounded-full" />
                    <div className="grid flex-1 gap-2">
                      <Skeleton className="h-3 w-1/2 rounded-full" />
                      <Skeleton className="h-3 w-3/4 rounded-full" />
                    </div>
                  </li>
                ))
              : rows.map((c) => (
                  <PhoneRow key={c.id} on={route.id === c.id} onClick={() => go('customers', filter, c.id)} lead={<Avatar name={c.name || c.email || '?'} size={36} />}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px] font-semibold">{c.name || 'No name'}</span>
                      <span className="num shrink-0 text-[14px] font-semibold">{money(c.spent, c.currency || base)}</span>
                    </span>
                    <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-[var(--so-muted)]">
                      <span className="min-w-0 truncate">{c.email || c.phone || 'No contact'}</span>
                      <span className="shrink-0">{plural(c.orders, 'order')}{c.last_order !== '' ? ', ' + ago(c.last_order) : ''}</span>
                    </span>
                    {c.tags.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <Pill key={t}>{t}</Pill>
                        ))}
                        {c.tags.length > 3 && <Pill>+{c.tags.length - 3}</Pill>}
                      </span>
                    )}
                  </PhoneRow>
                ))}
          </PhoneList>
          <table className="hidden w-full min-w-[760px] border-collapse text-left lg:table">
            <thead>
              <tr>
                <Th className="pl-4">Customer</Th>
                <Th>Contact</Th>
                <Th align="right">Orders</Th>
                <Th align="right">Spent</Th>
                <Th>Last order</Th>
              </tr>
            </thead>
            <tbody>
              {data === null
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} className="border-t border-[var(--so-line)]">
                      <td className="h-16 pl-4">
                        <div className="flex items-center gap-3">
                          <Skeleton className="size-9 rounded-full" />
                          <Skeleton className="h-3 w-32 rounded-full" />
                        </div>
                      </td>
                      {[160, 40, 72, 80].map((w, j) => (
                        <td key={j} className="px-3">
                          <div style={{ width: w }}>
                            <Skeleton className="h-3 rounded-full" />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((c) => (
                    <Tr key={c.id} on={route.id === c.id} onClick={() => go('customers', filter, c.id)}>
                      <Td className="py-2 pl-4">
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar name={c.name || c.email || '?'} size={36} />
                          <span className="min-w-0">
                            <span className="block max-w-[240px] truncate text-[14px] font-semibold">{c.name || 'No name'}</span>
                            {c.tags.length > 0 && (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {c.tags.slice(0, 3).map((t) => (
                                  <Pill key={t}>{t}</Pill>
                                ))}
                                {c.tags.length > 3 && <Pill>+{c.tags.length - 3}</Pill>}
                              </span>
                            )}
                          </span>
                        </span>
                      </Td>
                      <Td className="max-w-[260px] py-2">
                        {c.email !== '' && <span className="block truncate">{c.email}</span>}
                        {c.phone !== '' && <span className="num block truncate text-[12px] text-[var(--so-muted)]">{c.phone}</span>}
                        {c.email === '' && c.phone === '' && <span className="text-[12px] text-[var(--so-muted)]">Not given</span>}
                      </Td>
                      <Td align="right" className="font-semibold">
                        {num(c.orders)}
                      </Td>
                      <Td align="right" className="font-semibold">
                        {money(c.spent, c.currency || base)}
                      </Td>
                      <Td className="whitespace-nowrap text-[var(--so-ink-2)]">{c.last_order !== '' ? ago(c.last_order) : <span className="text-[var(--so-muted)]">No orders</span>}</Td>
                    </Tr>
                  ))}
            </tbody>
          </table>
          </>
        )}
        <div ref={sentinel} aria-hidden />
      </TableCard>

      <CustomerDrawer id={route.id} onClose={() => go('customers', filter)} />
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

const PANEL_READS: Collection[] = ['customers', 'orders', 'threads', 'shops', 'shipments', 'order_lines'];

/** A buyer in a right-hand panel; nothing when the id is empty. */
export function CustomerDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element | null {
  const live = useLive<{ customer: CustomerDetail; asked: string } | null>(
    'customer:' + id,
    (signal) => (id === '' ? Promise.resolve(null) : op<{ customer: CustomerDetail }>('customers.get', { customer: id }, { signal, quiet: true }).then((r) => ({ customer: r.customer, asked: id }))),
    PANEL_READS,
    [id],
  );
  const c = live.data !== null && live.data.asked === id ? live.data.customer : null;
  return (
    <Drawer
      open={id !== ''}
      onClose={onClose}
      width={600}
      title={c !== null ? c.name || 'No name' : 'Customer'}
      subtitle={c !== null ? (c.orders > 1 ? 'Repeat buyer, ' + plural(c.orders, 'order') : c.orders === 1 ? 'One order' : 'No orders yet') : undefined}
    >
      {c !== null ? (
        <CustomerBody c={c} />
      ) : live.error !== null && !live.loading ? (
        <Card>
          <Empty icon={UserRound} title="This customer is not here" action={<Button variant="secondary" onClick={onClose}>Close</Button>}>
            {live.error}
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="h-36 rounded-[20px] bg-[var(--so-card)]" />
          <Skeleton className="h-44 rounded-[20px] bg-[var(--so-card)]" />
          <Skeleton className="h-56 rounded-[20px] bg-[var(--so-card)]" />
        </div>
      )}
    </Drawer>
  );
}

function CustomerBody({ c }: { c: CustomerDetail }): React.JSX.Element {
  const base = useBase();
  const { shops } = useStore();
  const save = async (params: Record<string, unknown>, done: string): Promise<void> => {
    await op('customers.update', { customer: c.id, ...params });
    notify.info(done);
    changed('customers', 'orders');
  };
  const saveEmail = (v: string): Promise<void> => {
    if (v !== '' && !/^[^\s@]+@[^\s@]+$/.test(v)) {
      notify.error('That email does not look right');
      return Promise.reject(new Error('invalid'));
    }
    return save({ email: v }, 'Email saved');
  };
  return (
    <div className="grid gap-3">
      <Card>
        <div className="flex items-center gap-3">
          <Avatar name={c.name || c.email || '?'} size={48} />
          <div className="min-w-0 flex-1">
            <InlineInput label="Name" value={c.name} placeholder="Add a name" strong className="-ml-2" onSave={(v) => save({ name: v }, 'Name saved')} />
            {c.shops.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {c.shops.map((name) => {
                  const s = shops.find((x) => x.name === name);
                  return s !== undefined ? <ShopChip key={name} name={name} platform={s.platform} /> : <Pill key={name}>{name}</Pill>;
                })}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Orders" value={num(c.orders)} />
          <Stat label="Spent" value={money(c.spent, c.currency || base)} />
          <Stat label="Last order" value={c.last_order !== '' ? ago(c.last_order) : 'None'} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Details" subtitle="Changes save when you leave a field" />
        <div className="grid gap-2">
          <DetailRow icon={Mail} label="Email">
            <InlineInput label="Email" type="email" inputMode="email" value={c.email} placeholder="Add an email" onSave={saveEmail} />
          </DetailRow>
          <DetailRow icon={Phone} label="Phone">
            <InlineInput label="Phone" type="tel" inputMode="tel" value={c.phone} placeholder="Add a phone number" onSave={(v) => save({ phone: v }, 'Phone saved')} />
          </DetailRow>
        </div>
        <p className="mb-2 mt-4 text-[12px] font-semibold text-[var(--so-ink-2)]">Tags</p>
        <Tags c={c} onSave={(tags) => save({ tags }, 'Tags saved')} />
        <p className="mb-2 mt-4 text-[12px] font-semibold text-[var(--so-ink-2)]">Note</p>
        <NoteField c={c} onSave={(note) => save({ note }, 'Note saved')} />
      </Card>

      <Card>
        <CardHeader title="Orders" subtitle={c.order_list.length > 0 ? 'Every shop, newest first' : undefined} />
        {c.order_list.length === 0 ? (
          <Empty icon={ShoppingBag} title="No orders yet" className="py-6" action={<Button variant="secondary" size="sm" onClick={() => go('orders', 'all')}>All orders</Button>} />
        ) : (
          <div className="-mx-2 grid">
            {c.order_list.map((o) => (
              <a key={o.id} href={href('orders', 'all', o.id)} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-[var(--so-row-hover)]">
                <PlatformMark platform={o.shop.platform} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">
                    {o.number}
                    <span className="font-normal text-[var(--so-muted)]"> on {o.shop.name}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--so-muted)]">
                    <span>{dayShort(o.placed_at)}</span>
                    <OrderStatus status={o.status} health={o.health} />
                  </span>
                </span>
                <span className="num text-[13px] font-semibold">{money(o.total, o.currency)}</span>
              </a>
            ))}
          </div>
        )}
      </Card>

      {c.threads.length > 0 && (
        <Card>
          <CardHeader title="Conversations" subtitle={plural(c.threads.length, 'conversation')} />
          <div className="-mx-2 grid">
            {c.threads.map((t) => (
              <a key={t.id} href={href('inbox', 'all', t.id)} className="flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-[var(--so-row-hover)]">
                <IconBadge icon={MessageSquare} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{t.subject || 'Conversation'}</span>
                  <span className="block text-[12px] text-[var(--so-muted)]">{ago(t.last_at)}</span>
                </span>
                <Pill tone={t.status === 'open' ? 'accent' : t.status === 'waiting' ? 'info' : 'neutral'}>{t.status === 'open' ? 'Open' : t.status === 'waiting' ? 'Waiting' : 'Closed'}</Pill>
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[14px] bg-[var(--so-tile)] px-3 py-2">
      <p className="text-[12px] font-semibold text-[var(--so-muted)]">{label}</p>
      <p className="num mt-1 truncate text-[15px] font-semibold">{value}</p>
    </div>
  );
}

function DetailRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[20px_64px_minmax(0,1fr)] items-center gap-2">
      <Icon size={16} strokeWidth={2} className="text-[var(--so-muted)]" aria-hidden />
      <span className="text-[13px] text-[var(--so-muted)]">{label}</span>
      {children}
    </div>
  );
}

function Tags({ c, onSave }: { c: CustomerDetail; onSave: (tags: string[]) => Promise<void> }): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [tags, setTags] = useState(c.tags);
  useEffect(() => setTags(c.tags), [c.tags]);
  const commit = async (next: string[]): Promise<void> => {
    const before = tags;
    setTags(next);
    try {
      await onSave(next);
    } catch {
      setTags(before);
    }
  };
  const add = (): void => {
    const t = draft.trim();
    if (t === '') return;
    setDraft('');
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    void commit([...tags, t.slice(0, 40)]);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Escape' && draft !== '') {
      e.stopPropagation();
      setDraft('');
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      void commit(tags.slice(0, -1));
    }
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-[12px] bg-[var(--so-tile)] p-2 ring-[var(--so-ink)] focus-within:ring-2">
      {tags.map((t) => (
        <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--so-card)] pl-3 pr-1 text-[12px] font-semibold">
          {t}
          <button type="button" aria-label={'Remove tag ' + t} onClick={() => void commit(tags.filter((x) => x !== t))} className="hit flex size-5 items-center justify-center rounded-full text-[var(--so-muted)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)]">
            <X size={12} strokeWidth={2.4} aria-hidden />
          </button>
        </span>
      ))}
      <span className="flex min-w-[120px] flex-1 items-center gap-1 pl-1">
        <Plus size={14} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder="Add tag" aria-label="Add tag" className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--so-ink)] outline-none" />
      </span>
    </div>
  );
}

function NoteField({ c, onSave }: { c: CustomerDetail; onSave: (note: string) => Promise<void> }): React.JSX.Element {
  const [draft, setDraft] = useState(c.note);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setDraft(c.note);
  }, [c.note, focus]);
  const commit = async (): Promise<void> => {
    setFocus(false);
    if (draft.trim() === c.note.trim()) return;
    try {
      await onSave(draft.trim());
    } catch {
      setDraft(c.note);
    }
  };
  return (
    <TextArea
      aria-label="Note"
      rows={3}
      value={draft}
      placeholder="Sizes, preferences, how they like to be contacted"
      onFocus={() => setFocus(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        // Escape saves and leaves the field; the panel stays open.
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
