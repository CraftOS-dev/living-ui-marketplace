/**
 * App-wide state: you, the workspace, boards, the team (people and agents),
 * what needs you, the open card, the new-card composer, and notices (the
 * interruptions you chose to get: an agent asks you something, a card of
 * yours needs attention, work you asked for is ready).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../../kit/index.ts';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { useLive } from './live.ts';
import type { Agent, AppState, AssigneeKey, Board, Me, Person, Settings } from './types.ts';

export interface Notice {
  id: number;
  title: string;
  body: string;
  card?: string | undefined;
  /** A page to open instead of a card (#/team for someone waiting to join). */
  to?: string | undefined;
  tone: 'amber' | 'red' | 'blue' | 'green';
}

export interface ComposeOptions {
  board?: string | undefined;
  column?: string | undefined;
  assignee?: AssigneeKey | undefined;
}

interface Ctx {
  me: Me | null;
  admin: boolean;
  settings: Settings | null;
  boards: Board[];
  people: Person[];
  agents: Agent[];
  state: AppState | null;
  needsYou: number;
  reviews: number;
  team: { count: number; reviews: number };
  pendingPeople: number;
  reload: () => void;
  openCard: string | null;
  setOpenCard: (id: string | null) => void;
  compose: ComposeOptions | null;
  setCompose: (o: ComposeOptions | null) => void;
  notices: Notice[];
  dismiss: (id: number) => void;
  lastBoard: string;
  setLastBoard: (id: string) => void;
  /** Every agent paused (anyone may pull this brake). */
  paused: boolean;
  setPaused: (v: boolean) => void;
  /** Pause or resume one agent. */
  pauseAgent: (agent: Agent, v: boolean) => void;
  /** On a phone the sidebar is a drawer: open or not. */
  menu: boolean;
  setMenu: (v: boolean) => void;
}

const AppContext = createContext<Ctx | null>(null);

const LAST_BOARD = 'kb.board';

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const live = useLive(() => api.state(), ['settings', 'users', 'agents', 'boards', 'cards'], [], 400, 1500);
  const st = live.data;
  const reload = live.reload;
  // People's presence lives outside the collections: look again every minute.
  useEffect(() => {
    const t = setInterval(reload, 60000);
    return () => clearInterval(t);
  }, [reload]);
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

  // Interruptions: new questions and cards needing you, as you chose in Settings.
  const seen = useRef<Set<string> | null>(null);
  const nextId = useRef(1);
  useEffect(() => {
    if (st === null || st.me === null) return;
    const d = st;
    const prefs = st.me.prefs.attention;
    const keys = new Map<string, Notice>();
    for (const c of d.needs.questions) {
      const who = c.question?.by_party?.name ?? 'An agent';
      keys.set('q' + c.id + c.question?.at, { id: 0, title: c.question?.kind === 'plan' ? `${who} needs a plan approved` : c.question?.kind === 'criteria' ? 'A card needs acceptance criteria' : `${who} asks`, body: `${c.key} · ${c.question?.text ?? c.title}`, card: c.id, tone: 'amber' });
    }
    for (const c of d.needs.attention) keys.set('a' + c.id + c.updated, { id: 0, title: 'A card needs your attention', body: `${c.key} · ${c.attention || c.title}`, card: c.id, tone: 'red' });
    // Admins hear at once when someone asks to join: nobody should wait on a badge nobody sees.
    for (const p of d.waiting ?? []) keys.set('j' + p.id, { id: 0, title: `${p.name} asked to join`, body: `${p.email} · let them in on the Team page`, to: '#/team', tone: 'amber' });
    for (const c of d.needs.reviews) keys.set('r' + c.id + c.column_at, { id: 0, title: c.requester === st.me.id ? 'Work you asked for is ready' : 'Ready for review', body: `${c.key} · ${c.title}`, card: c.id, tone: 'blue' });
    if (seen.current === null) {
      seen.current = new Set(keys.keys());
      return;
    }
    const fresh: Notice[] = [];
    for (const [k, n] of keys) {
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      const kind = k[0] === 'q' ? 'questions' : k[0] === 'a' ? 'attention' : 'reviews';
      if (k[0] === 'j' || (prefs[kind] ?? 'inbox') === 'interrupt') fresh.push({ ...n, id: nextId.current++ });
    }
    if (fresh.length > 0) setNotices((cur) => [...cur, ...fresh].slice(-4));
  }, [st]);
  const dismiss = useCallback((id: number) => setNotices((cur) => cur.filter((n) => n.id !== id)), []);
  // Pausing shows at once; the server's answer confirms it.
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
          toast.info(v ? 'Every agent is paused' : 'Agents may work again');
          reload();
        })
        .catch((err: unknown) => {
          setPausedWant(null);
          toast.error((err as { message?: string }).message ?? 'Could not change it');
        });
    },
    [reload],
  );
  const [agentWant, setAgentWant] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (st === null) return;
    setAgentWant((cur) => {
      const next = { ...cur };
      let changed = false;
      for (const a of st.agents) {
        if (next[a.id] !== undefined && next[a.id] === a.paused) {
          delete next[a.id];
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [st]);
  const pauseAgent = useCallback(
    (agent: Agent, v: boolean) => {
      setAgentWant((cur) => ({ ...cur, [agent.id]: v }));
      api
        .updateAgent(agent.id, { paused: v })
        .then(() => {
          toast.info(v ? `${agent.name} is paused` : `${agent.name} may work again`);
          reload();
        })
        .catch((err: unknown) => {
          setAgentWant((cur) => {
            const next = { ...cur };
            delete next[agent.id];
            return next;
          });
          toast.error((err as { message?: string }).message ?? 'Could not change it');
        });
    },
    [reload],
  );
  useEffect(() => {
    if (notices.length === 0) return;
    const t = setTimeout(() => setNotices((cur) => cur.slice(1)), 9000);
    return () => clearTimeout(t);
  }, [notices]);

  const value = useMemo<Ctx>(() => {
    const paused = pausedWant ?? st?.settings.paused ?? false;
    const agents = (st?.agents ?? []).map((a) => {
      const want = agentWant[a.id];
      const own = want ?? a.paused;
      return want === undefined && !paused ? a : { ...a, paused: own, status: own || paused ? ('paused' as const) : a.status === 'paused' ? ('idle' as const) : a.status };
    });
    return {
      me: st?.me ?? null,
      admin: st?.me?.role === 'admin',
      settings: st?.settings ?? null,
      boards: st?.boards ?? [],
      people: st?.people ?? [],
      agents,
      state: st,
      needsYou: st?.count ?? 0,
      reviews: st?.reviews ?? 0,
      team: st?.team ?? { count: 0, reviews: 0 },
      pendingPeople: st?.pending_people ?? 0,
      reload,
      openCard,
      setOpenCard,
      compose,
      setCompose,
      notices,
      dismiss,
      lastBoard,
      setLastBoard,
      paused,
      setPaused,
      pauseAgent,
      menu,
      setMenu,
    };
  }, [st, agentWant, reload, openCard, compose, notices, dismiss, lastBoard, setLastBoard, pausedWant, setPaused, pauseAgent, menu]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const v = useContext(AppContext);
  if (v === null) throw new Error('useApp outside AppProvider');
  return v;
}
