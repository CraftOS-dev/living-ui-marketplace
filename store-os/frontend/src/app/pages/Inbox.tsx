/**
 * One inbox for buyers on every shop: the conversations (by what is due), the
 * open conversation with your AI agent's draft and the ways to send it, and
 * the buyer with their order and the shop's policies. On a phone one pane
 * shows at a time; under a wide screen the buyer panel opens in a drawer.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Inbox as InboxIcon, Link2, MessageSquare, MessageSquarePlus, PanelRight, Plus, Search, Sparkles, StickyNote, Unlink } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Clock, ShopFilter } from '../components/badges.tsx';
import { BuyerPanel, buyerName, Composer, LinkOrderDialog, LogMessageDialog, MessageItem, NoteDialog, PillSelect, ThreadItem } from '../components/InboxParts.tsx';
import { ShopChip } from '../components/PlatformMark.tsx';
import { Avatar, Button, Card, Drawer, Empty, IconButton, Menu, Segmented, SearchField, Skeleton, TaskBadge, Tabs, Tip } from '../components/ui.tsx';
import type { MenuItem } from '../components/ui.tsx';
import { op } from '../lib/api.ts';
import { INTENT_LABEL, plural } from '../lib/format.ts';
import { changed, useLive } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { ThreadDetail, ThreadList } from '../lib/types.ts';

const VIEWS = ['due', 'drafted', 'waiting', 'closed'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { due: 'Due', drafted: 'Drafted', waiting: 'Waiting', closed: 'Closed' };
const READS: Collection[] = ['threads', 'messages', 'orders', 'shipments', 'customers', 'shops', 'tasks'];
const STATUSES: { key: ThreadDetail['status']; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'closed', label: 'Closed' },
];

/* The panes fill the height under the top bar; the frame's padding differs on wide screens. */
const PANES = 'flex h-[calc(100dvh-112px)] min-h-[520px] gap-3 lg:h-[calc(100dvh-136px)]';
const PANE = 'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px] bg-[var(--so-card)] text-[var(--so-ink)]';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function InboxPage({ route }: { route: Route }): React.JSX.Element {
  const view: View = (VIEWS as readonly string[]).includes(route.sub) ? (route.sub as View) : 'due';
  const id = route.id;
  const [logOpen, setLogOpen] = useState(false);
  const openLog = useCallback(() => setLogOpen(true), []);

  return (
    <div className="@container">
      <div className={PANES}>
        <ListPane view={view} id={id} onLog={openLog} className={id !== '' ? 'hidden @min-[700px]:flex' : 'flex'} />
        {id === '' ? (
          <section className={cn(PANE, 'hidden flex-1 items-center justify-center @min-[700px]:flex')}>
            <Empty icon={InboxIcon} title="Pick a conversation">
              The buyer, their order and your AI agent&apos;s draft open here.
            </Empty>
          </section>
        ) : (
          <Conversation key={id} id={id} view={view} />
        )}
      </div>
      <LogMessageDialog open={logOpen} onClose={() => setLogOpen(false)} onLogged={(tid) => go('inbox', 'due', tid)} />
    </div>
  );
}

/* ------------------------------------------------------------- list pane */

function ListPane({ view, id, onLog, className }: { view: View; id: string; onLog: () => void; className: string }): React.JSX.Element {
  const { attention } = useStore();
  const [shop, setShop] = useState('');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const [asking, setAsking] = useState(false);
  const list = useLive<ThreadList>(
    'inbox-list:' + view + ':' + shop + ':' + query,
    (signal) => op<ThreadList>('inbox.list', { view, shop: shop || undefined, q: query || undefined }, { signal, quiet: true }),
    READS,
    [view, shop, query],
  );
  const counts = list.data?.counts;
  const rows = list.data?.threads ?? [];
  const undrafted = counts !== undefined ? counts.open - counts.drafted : 0;
  const filtered = shop !== '' || query !== '';

  const askAll = async (): Promise<void> => {
    setAsking(true);
    try {
      const r = await op<{ asked: number }>('inbox.ask-draft-all');
      notify.info(r.asked === 0 ? 'Nothing left to draft' : 'Asked your AI agent for ' + plural(r.asked, 'draft'));
      changed('tasks', 'threads');
    } catch {
      /* op showed why */
    } finally {
      setAsking(false);
    }
  };

  return (
    <Card flush className={cn(PANE, 'w-full @min-[700px]:w-[340px] @min-[700px]:shrink-0', className)}>
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">Inbox</h1>
          <IconButton icon={Plus} label="Log a message" variant="primary" onClick={onLog} />
        </div>
        <Tabs
          size="sm"
          fit
          className="mt-3 bg-[var(--so-tile)]"
          value={view}
          onChange={(k) => go('inbox', k, id)}
          items={VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v], count: counts?.[v], alert: v === 'due' && (attention?.messages_overdue ?? 0) > 0 }))}
        />
        <ShopFilter value={shop} onChange={setShop} className="mt-3 sm:flex-wrap" />
        <SearchField value={q} onChange={setQ} placeholder="Search buyers, orders, text" className="mt-3" />
        {undrafted > 0 && (
          <Button variant="secondary" size="sm" icon={Sparkles} loading={asking} onClick={() => void askAll()} className="mt-3">
            Draft all with your AI agent
          </Button>
        )}
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.data === null && list.loading && (
          <div className="space-y-2 p-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[84px]" />
            ))}
          </div>
        )}
        {list.error !== null && list.data === null && <p className="px-3 py-4 text-[13px] text-[var(--so-red-text)]">{list.error}</p>}
        {list.data !== null && rows.length === 0 && <ListEmpty view={view} all={counts?.all ?? 0} filtered={filtered} query={query} onLog={onLog} onClear={() => setQ('')} />}
        {rows.map((r) => (
          <ThreadItem key={r.id} row={r} on={r.id === id} view={view} />
        ))}
      </div>
    </Card>
  );
}

const EMPTY_LINE: Record<View, [string, string]> = {
  due: ['Nothing due', 'Every buyer has an answer.'],
  drafted: ['No drafts', 'Replies your AI agent writes wait here.'],
  waiting: ['No one waiting', 'Answered conversations wait here for the buyer.'],
  closed: ['Nothing closed', 'Closed conversations land here.'],
};

function ListEmpty({ view, all, filtered, query, onLog, onClear }: { view: View; all: number; filtered: boolean; query: string; onLog: () => void; onClear: () => void }): React.JSX.Element {
  if (query !== '') {
    return (
      <Empty
        icon={Search}
        title="No matches"
        action={
          <Button variant="tile" size="sm" onClick={onClear}>
            Clear search
          </Button>
        }
      >
        Nothing matches &quot;{query}&quot;.
      </Empty>
    );
  }
  if (all === 0 && !filtered) {
    return (
      <Empty
        icon={MessageSquare}
        title="No buyer messages yet"
        action={
          <Button size="sm" icon={Plus} onClick={onLog}>
            Log a message
          </Button>
        }
      >
        Messages from every shop land here.
      </Empty>
    );
  }
  const [title, line] = EMPTY_LINE[view];
  return (
    <Empty
      icon={InboxIcon}
      title={title}
      action={
        view !== 'due' ? (
          <Button variant="tile" size="sm" onClick={() => go('inbox', 'due')}>
            Show due
          </Button>
        ) : (
          <Button size="sm" icon={Plus} onClick={onLog}>
            Log a message
          </Button>
        )
      }
    >
      {line}
    </Empty>
  );
}

/* ---------------------------------------------------------- conversation */

function Conversation({ id, view }: { id: string; view: View }): React.JSX.Element {
  const detail = useLive<{ thread: ThreadDetail }>('inbox-thread:' + id, (signal) => op<{ thread: ThreadDetail }>('inbox.get', { thread: id }, { signal, quiet: true }), READS, [id]);
  const t = detail.data?.thread ?? null;
  const back = (
    <IconButton icon={ArrowLeft} label="Back to conversations" variant="ghost" className="@min-[700px]:hidden" onClick={() => go('inbox', view)} />
  );

  if (t === null) {
    return (
      <section className={cn(PANE, 'flex-1')}>
        {detail.loading ? (
          <div className="flex flex-1 flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              {back}
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-10 flex-1" />
            </div>
            <Skeleton className="h-16 w-2/3" />
            <Skeleton className="ml-auto h-16 w-1/2" />
            <Skeleton className="mt-auto h-28" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col p-4">
            <div>{back}</div>
            <Empty
              icon={AlertTriangle}
              title="Could not open this conversation"
              action={
                <Button variant="tile" size="sm" onClick={() => go('inbox', view)}>
                  Back to the list
                </Button>
              }
            >
              {detail.error ?? 'It may have been removed.'}
            </Empty>
          </div>
        )}
      </section>
    );
  }
  return <ConversationView thread={t} view={view} back={back} />;
}

function ConversationView({ thread: t, view, back }: { thread: ThreadDetail; view: View; back: React.ReactNode }): React.JSX.Element {
  const [panel, setPanel] = useState(false);
  const [dialog, setDialog] = useState<'link' | 'note' | 'log' | null>(null);
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const [status, setStatus] = useState<ThreadDetail['status'] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const buyer = buyerName(t);
  const count = t.messages.length;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const update = async (params: Record<string, unknown>, done: string): Promise<boolean> => {
    try {
      await op('inbox.update', { thread: t.id, ...params });
      if (done !== '') notify.info(done);
      changed('threads');
      return true;
    } catch {
      return false;
    }
  };

  // The control shows the new status at once and follows the server once it reloads.
  useEffect(() => setStatus(null), [t.status]);
  const changeStatus = async (s: ThreadDetail['status']): Promise<void> => {
    setStatus(s);
    if (!(await update({ status: s }, s === 'closed' ? 'Closed' : ''))) setStatus(null);
  };

  const menu: MenuItem[] = [
    { label: t.order !== null ? 'Link another order' : 'Link to an order', icon: Link2, onSelect: () => setDialog('link') },
    ...(t.order !== null ? [{ label: 'Unlink order ' + t.order.number, icon: Unlink, onSelect: () => void update({ order: '' }, 'Order unlinked') }] : []),
    { label: 'Add private note', icon: StickyNote, onSelect: () => setDialog('note') },
    { label: 'Log a buyer message', icon: MessageSquarePlus, onSelect: () => setDialog('log') },
  ];

  return (
    <>
      <section className={cn(PANE, 'flex-1')}>
        <header className="shrink-0 border-b border-[var(--so-line)] px-4 py-3">
          <div className="flex items-center gap-3">
            {back}
            <Avatar name={buyer} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold leading-[22px]">{buyer}</h2>
                {t.shop !== null && <ShopChip name={t.shop.name} platform={t.shop.platform} className="hidden shrink-0 @min-[480px]:inline-flex" />}
              </div>
              <p className="truncate text-[13px] text-[var(--so-muted)]">{t.subject || 'No subject'}</p>
            </div>
            <IconButton icon={PanelRight} label="Buyer and order" className="@min-[1040px]:hidden" onClick={() => setPanel(true)} />
            <Menu items={menu} label="Conversation actions" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Segmented items={STATUSES} value={status ?? t.status} onChange={(s) => void changeStatus(s)} />
            <PillSelect value={t.intent} onChange={(v) => void update({ intent: v }, '')} label="Topic" className="max-w-[200px]">
              <option value="">No topic</option>
              {Object.entries(INTENT_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </PillSelect>
            {t.hours_left !== null && (
              <Tip text="Time left to reply" className="px-1">
                <Clock hours={t.hours_left} />
              </Tip>
            )}
            <TaskBadge task={t.task} />
          </div>
        </header>
        <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {count === 0 && <p className="py-8 text-center text-[13px] text-[var(--so-muted)]">No messages yet</p>}
          {t.messages.map((m) => (
            <MessageItem key={m.id} m={m} onRetry={(text) => setSeed({ text, n: Date.now() })} />
          ))}
        </div>
        <Composer thread={t} seed={seed} />
      </section>
      <aside className="hidden min-h-0 w-[320px] shrink-0 flex-col overflow-y-auto rounded-[20px] bg-[var(--so-card)] text-[var(--so-ink)] @min-[1040px]:flex">
        <BuyerPanel thread={t} onLinkOrder={() => setDialog('link')} />
      </aside>
      <Drawer open={panel} onClose={() => setPanel(false)} title={buyer} subtitle="Buyer, order and policies" width={420}>
        <Card flush className="overflow-hidden">
          <BuyerPanel thread={t} onLinkOrder={() => setDialog('link')} />
        </Card>
      </Drawer>
      <LinkOrderDialog open={dialog === 'link'} thread={t} onClose={() => setDialog(null)} />
      <NoteDialog open={dialog === 'note'} threadId={t.id} onClose={() => setDialog(null)} />
      <LogMessageDialog open={dialog === 'log'} onClose={() => setDialog(null)} thread={{ id: t.id, buyer }} onLogged={() => undefined} />
    </>
  );
}
