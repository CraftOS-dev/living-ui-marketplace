/**
 * Two things reachable from anywhere: quick add (Q) and find (Ctrl K).
 *
 * Quick add takes a task as typed, one per line, to Today or the Inbox.
 * Find searches goals, habits, cards, people, books, projects and the
 * journal, and jumps to the pages and common actions.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { AREA_NAMES, AREA_KINDS, AreaArt, Avatar, HabitArt } from './art.tsx';
import type { AreaKind } from './art.tsx';
import { ColumnArt, NavArt, ThingArt } from './art2.tsx';
import type { NavKind } from './art2.tsx';
import { Chip } from './bits.tsx';
import { useGoalPanel } from './goals.tsx';
import { useHabitPanel } from './habits.tsx';
import { usePersonPanel } from './people.tsx';
import { snack } from './snack.tsx';
import { addTask, useTaskPanel } from './tasks.tsx';
import { Button, Kbd, Modal } from './ui.tsx';

/* --------------------------------------------------------------- capture */

const CaptureCtx = createContext<(text?: string | undefined) => void>(() => undefined);

export function useCapture(): (text?: string | undefined) => void {
  return useContext(CaptureCtx);
}

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t === null) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || document.querySelector('[role="dialog"]') !== null;
}

export function CaptureProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const show = useCallback((text?: string | undefined) => setOpen(text ?? ''), []);
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e)) {
        e.preventDefault();
        setOpen('');
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  return (
    <CaptureCtx.Provider value={show}>
      {children}
      {open !== null && <CaptureDialog initial={open} onClose={() => setOpen(null)} />}
    </CaptureCtx.Provider>
  );
}

function CaptureDialog({ initial, onClose }: { initial: string; onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState(initial);
  const [to, setTo] = useState<'today' | 'inbox'>('today');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    const lines = text
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x !== '');
    if (lines.length === 0) return;
    setBusy(true);
    try {
      for (const l of lines) await addTask(l, { column: to });
      snack(lines.length === 1 ? `Added to ${to === 'today' ? 'Today' : 'the Inbox'}` : `${lines.length} cards added to ${to === 'today' ? 'Today' : 'the Inbox'}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add to your board"
      width={540}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <Chip active={to === 'today'} art={<ColumnArt kind="today" size={18} />} onClick={() => setTo('today')}>
              Today
            </Chip>
            <Chip active={to === 'inbox'} art={<ColumnArt kind="inbox" size={18} />} onClick={() => setTo('inbox')}>
              Inbox
            </Chip>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={text.trim() === ''} onClick={() => void save()}>
              Add
            </Button>
          </div>
        </div>
      }
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !text.includes('\n')) {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
        }}
        rows={3}
        placeholder="Call the dentist"
        aria-label="What to do (one per line)"
        className="lo-autosize min-h-20 w-full resize-none bg-transparent pb-2 text-[15px] leading-6 outline-none placeholder:text-[var(--lo-muted)]"
      />
    </Modal>
  );
}

/* --------------------------------------------------------------- palette */

interface Found {
  goals: { id: string; title: string; area: AreaKind; progress: number }[];
  habits: { id: string; name: string; art: string }[];
  tasks: { id: string; title: string; state: string; do_date: string; area: string }[];
  people: { id: string; name: string; look: number; circle: string }[];
  projects: { id: string; title: string; state: string }[];
  books: { id: string; title: string; status: string }[];
  journal: { id: string; date: string; excerpt: string }[];
}

interface Row {
  key: string;
  group: string;
  label: string;
  hint?: string | undefined;
  icon: ReactNode;
  run: () => void;
}

const PaletteCtx = createContext<() => void>(() => undefined);

export function usePalette(): () => void {
  return useContext(PaletteCtx);
}

export function PaletteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  return (
    <PaletteCtx.Provider value={() => setOpen(true)}>
      {children}
      {open && <Palette onClose={() => setOpen(false)} />}
    </PaletteCtx.Provider>
  );
}

const PAGES: { page: Page; label: string; art: NavKind }[] = [
  { page: 'home', label: 'Home', art: 'home' },
  { page: 'board', label: 'Board', art: 'board' },
  { page: 'habits', label: 'Habits', art: 'habits' },
  { page: 'life', label: 'My life', art: 'life' },
  { page: 'projects', label: 'Projects', art: 'projects' },
  { page: 'journal', label: 'Journal', art: 'journal' },
  { page: 'agent', label: 'Your AI agent', art: 'agent' },
];

function Palette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [sel, setSel] = useState(0);
  const capture = useCapture();
  const task = useTaskPanel();
  const goal = useGoalPanel();
  const habit = useHabitPanel();
  const person = usePersonPanel();
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setFound(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void op<Found>('find.all', { q: t, limit: 5 }, { quiet: true, signal: ctrl.signal })
        .then(setFound)
        .catch(() => undefined);
    }, 140);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);
  const rows = useMemo<Row[]>(() => {
    const go = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const t = q.trim().toLowerCase();
    const out: Row[] = [];
    const actions: Row[] = [
      { key: 'a:add', group: 'Do', label: 'Add a task', hint: 'Q', icon: <ColumnArt kind="today" size={20} />, run: go(() => capture(q.trim())) },
      { key: 'a:goal', group: 'Do', label: 'New goal', icon: <ThingArt kind="flag" size={20} />, run: go(() => goal.create()) },
      { key: 'a:journal', group: 'Do', label: 'Write in the journal', icon: <NavArt kind="journal" size={20} />, run: go(() => navigate('journal')) },
      { key: 'a:week', group: 'Do', label: 'See the week', icon: <ColumnArt kind="coming" size={20} />, run: go(() => navigate('board', { view: 'week' })) },
    ];
    out.push(...actions.filter((a) => t === '' || a.label.toLowerCase().includes(t)));
    out.push(...PAGES.filter((p) => t === '' || p.label.toLowerCase().includes(t)).map((p) => ({ key: 'p:' + p.page, group: 'Go to', label: p.label, icon: <NavArt kind={p.art} size={20} />, run: go(() => navigate(p.page)) })));
    out.push(...AREA_KINDS.filter((k) => t !== '' && AREA_NAMES[k].toLowerCase().includes(t)).map((k) => ({ key: 'k:' + k, group: 'Go to', label: AREA_NAMES[k], icon: <AreaArt kind={k} size={20} />, run: go(() => navigate('area', { kind: k })) })));
    if (found !== null) {
      found.goals.forEach((g) => out.push({ key: 'g' + g.id, group: 'Goals', label: g.title, hint: Math.round(g.progress * 100) + '%', icon: <AreaArt kind={g.area} size={20} />, run: go(() => goal.open(g.id)) }));
      found.habits.forEach((h) => out.push({ key: 'h' + h.id, group: 'Habits', label: h.name, icon: <HabitArt art={h.art} size={20} />, run: go(() => habit(h.id)) }));
      found.tasks.forEach((x) => out.push({ key: 't' + x.id, group: 'Cards', label: x.title, hint: x.state === 'done' ? 'Done' : x.do_date, icon: <ColumnArt kind={x.state === 'done' ? 'done' : 'inbox'} size={20} />, run: go(() => task(x.id)) }));
      found.people.forEach((x) => out.push({ key: 'pe' + x.id, group: 'People', label: x.name, icon: <Avatar look={x.look} size={20} />, run: go(() => person.open(x.id)) }));
      found.projects.forEach((x) => out.push({ key: 'pr' + x.id, group: 'Projects', label: x.title, icon: <NavArt kind="projects" size={20} />, run: go(() => navigate('project', { id: x.id })) }));
      found.books.forEach((x) => out.push({ key: 'b' + x.id, group: 'Books', label: x.title, icon: <HabitArt art="read" size={20} />, run: go(() => navigate('area', { kind: 'growth' })) }));
      found.journal.forEach((j) => out.push({ key: 'j' + j.id, group: 'Journal', label: j.excerpt !== '' ? j.excerpt : 'An entry', hint: j.date, icon: <NavArt kind="journal" size={20} />, run: go(() => navigate('journal', { entry: j.id })) }));
    }
    return out;
  }, [q, found, onClose, capture, goal, habit, person, task]);
  useEffect(() => setSel(0), [q, found]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  let lastGroup = '';
  return (
    <Modal open onClose={onClose} title="Find" width={600}>
      <div className="flex items-center gap-2 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3">
        <Search size={16} className="text-[var(--lo-muted)]" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(rows.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') rows[sel]?.run();
          }}
          placeholder="Goals, habits, cards, people, books"
          aria-label="Search"
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={list} className="mt-2 max-h-[52vh] overflow-y-auto pb-2">
        {rows.map((r, i) => {
          const head = r.group !== lastGroup ? r.group : null;
          lastGroup = r.group;
          return (
            <div key={r.key}>
              {head !== null && <p className="px-3 pb-1 pt-3 text-[12px] font-bold text-[var(--lo-muted)]">{head}</p>}
              <button type="button" data-i={i} onMouseEnter={() => setSel(i)} onClick={r.run} className={cn('flex h-10 w-full items-center gap-3 rounded-[var(--lo-r-sm)] px-3 text-left text-[14px] font-semibold', i === sel ? 'bg-[var(--lo-sunk)]' : '')}>
                {r.icon}
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {r.hint !== undefined && r.hint !== '' && <span className="shrink-0 text-[12px] font-semibold text-[var(--lo-muted)]">{r.hint}</span>}
              </button>
            </div>
          );
        })}
        {rows.length === 0 && <p className="px-3 py-6 text-center text-[14px] text-[var(--lo-muted)]">Nothing found.</p>}
      </div>
    </Modal>
  );
}
