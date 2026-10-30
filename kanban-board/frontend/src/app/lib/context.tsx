/**
 * App-wide state: settings, boards, the agent, what needs you, the open
 * card, the new-card composer, and notices (the interruptions you chose to
 * get: the agent asks you something, a card needs your attention).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../../kit/index.ts';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { useLive } from './live.ts';
import type { AgentNow, AppState, Assignee, Board, Settings } from './types.ts';

export interface Notice {
  id: number;
  title: string;
  body: string;
  card?: string | undefined;
  tone: 'amber' | 'red' | 'blue' | 'green';
}

export interface ComposeOptions {
  board?: string | undefined;
  column?: string | undefined;
  assignee?: Assignee | undefined;
}

interface Ctx {
  settings: Settings | null;
  you: string;
  boards: Board[];
  agent: AgentNow | null;
  state: AppState | null;
  needsYou: number;
  reviews: number;
  openCard: string | null;
  setOpenCard: (id: string | null) => void;
  compose: ComposeOptions | null;
  setCompose: (o: ComposeOptions | null) => void;
  notices: Notice[];
  dismiss: (id: number) => void;
  lastBoard: string;
  setLastBoard: (id: string) => void;
  paused: boolean;
  setPaused: (v: boolean) => void;
  /** On a phone the sidebar is a drawer: open or not. */
  menu: boolean;
  setMenu: (v: boolean) => void;
}

const AppContext = createContext<Ctx | null>(null);

const LAST_BOARD = 'kb.board';

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const live = useLive(() => api.state(), ['settings', 'boards', 'cards'], [], 400, 1500);
  const st = live.data;
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeOptions | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [menu, setMenu] = useState(false);
  const [lastBoard, setLastBoardState] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_BOARD) ?? '';
    } catch {
      return '';
    }
  });
  const setLastBoard = useCallback((id: string) => {
    setLastBoardState(id);
    try {
      localStorage.setItem(LAST_BOARD, id);
    } catch {
      /* a convenience */
    }
  }, []);

  // Interruptions: new questions and cards needing attention, as you chose in Settings.
  const seen = useRef<Set<string> | null>(null);
  const nextId = useRef(1);
  useEffect(() => {
    if (st === null) return;
    const d = st;
    const s = st.settings;
    const keys = new Map<string, Notice>();
    for (const c of d.needs.questions) keys.set('q' + c.id + c.question?.at, { id: 0, title: c.question?.kind === 'plan' ? 'A plan waits for your approval' : c.question?.kind === 'criteria' ? 'A card needs acceptance criteria' : 'The agent asks', body: `${c.key} · ${c.question?.text ?? c.title}`, card: c.id, tone: 'amber' });
    for (const c of d.needs.attention) keys.set('a' + c.id + c.updated, { id: 0, title: 'A card needs your attention', body: `${c.key} · ${c.attention || c.title}`, card: c.id, tone: 'red' });
    for (const c of d.needs.reviews) keys.set('r' + c.id + c.column_at, { id: 0, title: 'Ready for your review', body: `${c.key} · ${c.title}`, card: c.id, tone: 'blue' });
    if (seen.current === null) {
      seen.current = new Set(keys.keys());
      return;
    }
    const fresh: Notice[] = [];
    for (const [k, n] of keys) {
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      const kind = k[0] === 'q' ? 'questions' : k[0] === 'a' ? 'attention' : 'reviews';
      if ((s.attention[kind] ?? 'inbox') === 'interrupt') fresh.push({ ...n, id: nextId.current++ });
    }
    if (fresh.length > 0) setNotices((cur) => [...cur, ...fresh].slice(-4));
  }, [st]);
  const dismiss = useCallback((id: number) => setNotices((cur) => cur.filter((n) => n.id !== id)), []);
  // Pausing the agent shows at once; the server's answer confirms it.
  const [pausedWant, setPausedWant] = useState<boolean | null>(null);
  useEffect(() => {
    if (pausedWant !== null && st !== null && st.settings.paused === pausedWant) setPausedWant(null);
  }, [st, pausedWant]);
  const setPaused = useCallback(
    (v: boolean) => {
      setPausedWant(v);
      api
        .saveSettings({ paused: v })
        .then(() => {
          toast.info(v ? 'The agent is paused' : 'The agent may work again');
          live.reload();
        })
        .catch((err: unknown) => {
          setPausedWant(null);
          toast.error((err as { message?: string }).message ?? 'Could not change it');
        });
    },
    [live],
  );
  useEffect(() => {
    if (notices.length === 0) return;
    const t = setTimeout(() => setNotices((cur) => cur.slice(1)), 9000);
    return () => clearTimeout(t);
  }, [notices]);

  const value = useMemo<Ctx>(
    () => ({
      settings: st?.settings ?? null,
      you: st?.settings.name || 'You',
      boards: st?.boards ?? [],
      agent: st?.agent ?? null,
      state: st,
      needsYou: st?.count ?? 0,
      reviews: st?.reviews ?? 0,
      openCard,
      setOpenCard,
      compose,
      setCompose,
      notices,
      dismiss,
      lastBoard,
      setLastBoard,
      paused: pausedWant ?? st?.settings.paused ?? false,
      setPaused,
      menu,
      setMenu,
    }),
    [st, openCard, compose, notices, dismiss, lastBoard, setLastBoard, pausedWant, setPaused, menu],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const v = useContext(AppContext);
  if (v === null) throw new Error('useApp outside AppProvider');
  return v;
}
