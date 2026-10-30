/**
 * Kanban Board: boards one person shares with their AI agent. Columns are
 * contracts (a column the agent works takes the cards that enter it, WIP
 * limits bind the agent, gates and review decide what moves on), the agent
 * holds cards with leases and hands work back with evidence, and the person
 * keeps the decisions: reviews, Done, and the pause switch. Everything the
 * agent does through the CLI shows up live.
 *
 * Layout: CraftBot's own. A sidebar (views, boards, the agent with its
 * switch, settings), the page on the surface, a card docked on the right.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Eye, MessageCircleQuestion, SquareKanban, X } from 'lucide-react';
import { cn, toast } from '../kit/index.ts';
import { BoardView } from './components/board/BoardView.tsx';
import { CardPanel } from './components/card/CardPanel.tsx';
import { Composer } from './components/Composer.tsx';
import { NewBoard } from './components/NewBoard.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Button, Empty, Spinner } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { AppProvider, useApp } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { navigate, useRoute } from './lib/router.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { InboxPage } from './pages/Inbox.tsx';
import { InsightsPage } from './pages/Insights.tsx';
import { ReviewPage } from './pages/Review.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import './theme.css';

const COLLAPSE = 'kb.sidebar';

export function App(): React.JSX.Element {
  useEffect(() => startLive(), []);
  return (
    <AppProvider>
      <Layout />
    </AppProvider>
  );
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function Layout(): React.JSX.Element {
  const app = useApp();
  const { page, query } = useRoute();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE) === '1';
    } catch {
      return false;
    }
  });
  const [newBoard, setNewBoard] = useState(false);
  const collapse = (v: boolean): void => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSE, v ? '1' : '0');
    } catch {
      /* a convenience */
    }
  };

  // A phone's menu drawer closes whenever you go somewhere.
  const { setMenu } = app;
  const where = page + '|' + query.toString();
  useEffect(() => setMenu(false), [where, setMenu]);

  // The board to show: the one asked for, else the last one, else the first.
  const asked = query.get('id') ?? '';
  const boardId = page === 'board' ? (asked !== '' ? asked : app.boards.some((b) => b.id === app.lastBoard) ? app.lastBoard : (app.boards[0]?.id ?? '')) : app.lastBoard;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e.target)) return;
      const dialog = document.querySelector('[role="dialog"]') !== null;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !dialog) {
        e.preventDefault();
        api
          .undo()
          .then((r) => toast.info(`Undone: ${r.undone}`))
          .catch((err: unknown) => toast.info((err as { message?: string }).message ?? 'Nothing to undo'));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || dialog) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        app.setCompose({ board: boardId });
      } else if (e.key === '/') {
        e.preventDefault();
        if (page !== 'board') navigate('board', boardId !== '' ? { id: boardId } : {});
        setTimeout(() => window.dispatchEvent(new Event('kb-search')), 30);
      } else if (e.key === 'Escape' && app.openCard !== null && document.querySelector('[data-kb-popover]') === null) {
        app.setOpenCard(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, boardId, page]);

  let body: React.JSX.Element;
  if (page === 'inbox') body = <InboxPage />;
  else if (page === 'review') body = <ReviewPage />;
  else if (page === 'insights') body = <InsightsPage />;
  else if (page === 'activity') body = <ActivityPage />;
  else if (page === 'settings') body = <SettingsPage />;
  else if (boardId !== '') body = <BoardView key={boardId} id={boardId} />;
  else if (app.boards.length === 0 && app.settings === null)
    body = (
      <div className="flex h-full items-center justify-center text-[var(--kb-muted)]">
        <Spinner size={18} />
      </div>
    );
  else
    body = (
      <div className="flex h-full items-center justify-center">
        <Empty icon={SquareKanban} title="No board yet" action={<Button variant="primary" onClick={() => setNewBoard(true)}>New board</Button>}>
          Create a board, then let the agent work a column or assign it a card.
        </Empty>
      </div>
    );

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[var(--kb-main)] text-[13px] text-[var(--kb-ink)]" style={{ fontFamily: 'var(--kb-font)' }}>
      <div className="hidden h-full md:flex">
        <Sidebar page={page} boardId={boardId} collapsed={collapsed} onCollapse={collapse} onNewBoard={() => setNewBoard(true)} />
      </div>
      <main className="min-w-0 flex-1">{body}</main>
      {app.menu && (
        <div className="kb-scrim fixed inset-0 z-[66] md:hidden" onPointerDown={(e) => e.target === e.currentTarget && app.setMenu(false)}>
          <div role="dialog" aria-modal="true" aria-label="Menu" className="kb-drawer h-full w-[min(300px,86vw)] border-r border-[var(--kb-line)] shadow-[var(--kb-shadow-lg)]">
            <Sidebar page={page} boardId={boardId} collapsed={false} onCollapse={() => app.setMenu(false)} onNewBoard={() => (app.setMenu(false), setNewBoard(true))} drawer />
          </div>
        </div>
      )}
      {app.openCard !== null && <CardPanel key={app.openCard} id={app.openCard} onClose={() => app.setOpenCard(null)} />}
      <Composer />
      <NewBoard open={newBoard} onClose={() => setNewBoard(false)} />
      <Notices />
    </div>
  );
}

/** The interruptions you asked for: the agent asks, a card needs you, work is ready. */
function Notices(): React.JSX.Element | null {
  const app = useApp();
  if (app.notices.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[85] flex flex-col gap-2 sm:left-auto sm:w-[340px]">
      {app.notices.map((n) => {
        const Icon = n.tone === 'red' ? AlertTriangle : n.tone === 'blue' ? Eye : MessageCircleQuestion;
        return (
          <div key={n.id} className="kb-in pointer-events-auto flex items-start gap-3 rounded-[var(--kb-radius-lg)] border border-[var(--kb-line)] bg-[var(--kb-main)] p-3 shadow-[var(--kb-shadow-lg)]">
            <Icon size={16} aria-hidden className={cn('mt-0.5 shrink-0', n.tone === 'red' ? 'text-[var(--kb-red)]' : n.tone === 'blue' ? 'text-[var(--kb-blue)]' : 'text-[var(--kb-amber)]')} />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (n.card !== undefined) app.setOpenCard(n.card);
                app.dismiss(n.id);
              }}
            >
              <div className="text-[13px] font-semibold">{n.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--kb-ink-2)]">{n.body}</div>
            </button>
            <button type="button" aria-label="Dismiss" onClick={() => app.dismiss(n.id)} className="text-[var(--kb-muted)] hover:text-[var(--kb-ink)]">
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
