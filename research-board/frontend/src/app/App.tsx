/**
 * Research Board: a sidebar of boards and the board, edge to edge. An AI
 * agent operates the same operations through the agent-app CLI, summarizes
 * cards and reviews boards.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { useEffect, useState } from 'react';
import { LayoutGrid, PanelLeft, Plus } from 'lucide-react';
import { getPbClient } from '../kit/index.ts';
import { BoardPage } from './board/BoardPage.tsx';
import { AddProvider } from './components/AddCard.tsx';
import { Sidebar, SidebarProvider, useSidebar } from './components/Sidebar.tsx';
import { CircleButton, Empty, PillButton, pillInput } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { AppDataProvider, useApp } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { lastBoard, navigate, replaceQuery, useRoute } from './lib/router.ts';
import { startThemeColors } from './lib/themeColors.ts';

// Views legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// All realtime subscriptions in one tick, before any view mounts (see live.ts).
startLive();

function FirstBoard(): React.JSX.Element {
  const side = useSidebar();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const r = await api.createBoard({ name: name.trim() });
      navigate('board', { id: r.board.id });
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-[var(--rb-line)] px-2">{!side.open && <CircleButton icon={PanelLeft} label="Show the boards" onClick={side.toggle} />}</div>
      <div className="rb-canvas flex flex-1 items-center justify-center p-6" style={{ backgroundSize: '24px 24px' }}>
        <div className="rb-pop w-full max-w-sm rounded-[10px] border border-[var(--rb-line)] bg-[var(--rb-card)]">
          <Empty icon={LayoutGrid} title="Create your first board">
            One board per question or project: notes, links, videos, documents and quotes, laid out and linked.
          </Empty>
          <div className="-mt-4 flex gap-2 px-5 pb-5">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} placeholder="Board name" aria-label="Board name" className={pillInput} />
            <PillButton icon={Plus} loading={busy} disabled={name.trim() === ''} onClick={() => void create()}>
              Create
            </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Root(): React.JSX.Element {
  const { ready, boards } = useApp();
  const route = useRoute();
  const known = boards.some((b) => b.id === route.id);

  // No board in the address (or a deleted one): open the last one used, else
  // the first. A board just created is not in the live list for a moment, so
  // an unknown id gets a grace period before it is replaced.
  useEffect(() => {
    if (!ready || boards.length === 0 || known) return;
    const go = (): void => {
      const last = lastBoard();
      const id = boards.some((b) => b.id === last) ? last : (boards[0]?.id ?? '');
      if (id !== '') replaceQuery('board', { id });
    };
    if (route.id === '') {
      go();
      return;
    }
    const t = setTimeout(go, 2000);
    return () => clearTimeout(t);
  }, [ready, boards, known, route.id]);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[var(--rb-card)] text-[var(--rb-ink)]">
      <Sidebar current={route.id} />
      <main className="flex min-w-0 flex-1 flex-col">
        {!ready ? (
          <div className="flex flex-1 items-center justify-center">
            <span aria-label="Loading" className="size-6 animate-spin rounded-full border-2 border-[var(--rb-ink)] border-t-transparent" />
          </div>
        ) : boards.length === 0 ? (
          <FirstBoard />
        ) : known ? (
          <BoardPage key={route.id} id={route.id} focus={route.card} />
        ) : null}
      </main>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppDataProvider>
      <SidebarProvider>
        <AddProvider>
          <Root />
        </AddProvider>
      </SidebarProvider>
    </AppDataProvider>
  );
}
