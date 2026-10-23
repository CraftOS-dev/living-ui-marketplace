/**
 * The palette (Ctrl+K, or "/" outside a field): find a page, a paper, a
 * project, a note or a claim, or run an action, from the keyboard.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { CornerDownLeft, FileText, FolderKanban, FolderPlus, History, House, Import, Library, Lightbulb, NotebookPen, Plus, Search, Settings, Sparkles, Telescope } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { byline } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { WorkRow } from '../lib/types.ts';
import { useAddPapers } from './AddPapers.tsx';
import { openPaper } from './paper.tsx';
import { Kbd } from './ui.tsx';

interface Entry {
  key: string;
  group: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  run: () => void;
}

const Ctx = createContext<{ open: () => void }>({ open: () => undefined });

export function usePalette(): { open: () => void } {
  return useContext(Ctx);
}

export function PaletteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && <PaletteDialog onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

interface Found {
  works: WorkRow[];
  projects: { id: string; name: string; question: string }[];
  notes: { id: string; title: string; kind: string }[];
  nodes: { id: string; title: string; kind: string; status: string; project: string }[];
}

function PaletteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const add = useAddPapers();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement | null>(null);
  const go = useCallback(
    (fn: () => void) => {
      onClose();
      setTimeout(fn, 0);
    },
    [onClose],
  );
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound(null);
      return;
    }
    const c = new AbortController();
    const t = setTimeout(() => {
      op<Found>('find.all', { q, limit: 6 }, { quiet: true, signal: c.signal })
        .then(setFound)
        .catch(() => undefined);
    }, 140);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q]);

  const entries = useMemo<Entry[]>(() => {
    const ql = q.trim().toLowerCase();
    const statics: Entry[] = [
      { key: 'a-add', group: 'Actions', label: 'Add papers', sub: 'DOI, arXiv ID, PDF or a file', icon: Plus, run: () => go(() => add.open({})) },
      { key: 'a-import', group: 'Actions', label: 'Import a BibTeX, RIS or CSL-JSON file', icon: Import, run: () => go(() => add.open({ tab: 'import' })) },
      { key: 'a-find', group: 'Actions', label: 'Find papers by title', icon: Search, run: () => go(() => add.open({ tab: 'find' })) },
      { key: 'a-project', group: 'Actions', label: 'New project', icon: FolderPlus, run: () => go(() => navigate('projects', { new: '1' })) },
      { key: 'a-note', group: 'Actions', label: 'New note', icon: NotebookPen, run: () => go(() => navigate('notes', { new: '1' })) },
      { key: 'p-home', group: 'Pages', label: 'Home', icon: House, run: () => go(() => navigate('home')) },
      { key: 'p-library', group: 'Pages', label: 'Library', icon: Library, run: () => go(() => navigate('library')) },
      { key: 'p-projects', group: 'Pages', label: 'Projects', icon: FolderKanban, run: () => go(() => navigate('projects')) },
      { key: 'p-discover', group: 'Pages', label: 'Discover', icon: Telescope, run: () => go(() => navigate('discover')) },
      { key: 'p-notes', group: 'Pages', label: 'Notes', icon: NotebookPen, run: () => go(() => navigate('notes')) },
      { key: 'p-agent', group: 'Pages', label: 'Your AI agent', icon: Sparkles, run: () => go(() => navigate('agent')) },
      { key: 'p-activity', group: 'Pages', label: 'Activity', icon: History, run: () => go(() => navigate('activity')) },
      { key: 'p-settings', group: 'Pages', label: 'Settings', icon: Settings, run: () => go(() => navigate('settings')) },
    ].filter((e) => ql === '' || e.label.toLowerCase().includes(ql));
    const out: Entry[] = [];
    if (found !== null) {
      for (const w of found.works) out.push({ key: 'w' + w.id, group: 'Papers', label: w.title, sub: byline(w), icon: FileText, run: () => go(() => openPaper(w)) });
      for (const p of found.projects) out.push({ key: 'pr' + p.id, group: 'Projects', label: p.name, sub: p.question, icon: FolderKanban, run: () => go(() => navigate('project', { id: p.id })) });
      for (const n of found.nodes) out.push({ key: 'n' + n.id, group: 'Claims and evidence', label: n.title, sub: n.kind, icon: Lightbulb, run: () => go(() => navigate('project', { id: n.project, view: 'map', node: n.id })) });
      for (const n of found.notes) out.push({ key: 'no' + n.id, group: 'Notes', label: n.title || 'Untitled note', sub: n.kind, icon: NotebookPen, run: () => go(() => navigate('notes', { note: n.id })) });
    }
    if (ql.length >= 2) out.push({ key: 'lib-search', group: 'Search', label: 'Search the library for "' + q.trim() + '"', icon: Search, run: () => go(() => navigate('library', { q: q.trim() })) });
    return [...out, ...statics];
  }, [found, q, go, add]);

  useEffect(() => setCursor(0), [q, found]);
  useEffect(() => {
    list.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastGroup = '';
  return (
    <RadixDialog.Root open onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <RadixDialog.Content className="ro-pop fixed left-1/2 top-[12vh] z-[71] flex max-h-[70vh] w-[min(94vw,36rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--ro-r-lg)] border border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink)] shadow-[var(--ro-shadow)]">
          <RadixDialog.Title className="sr-only">Find anything</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Papers, projects, notes, claims and actions</RadixDialog.Description>
          <div className="flex items-center gap-2 border-b border-[var(--ro-line)] px-3">
            <Search size={16} className="text-[var(--ro-muted)]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(entries.length - 1, c + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  entries[cursor]?.run();
                }
              }}
              placeholder="Find papers, projects, notes, claims, pages"
              className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              aria-label="Find anything"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1">
            {entries.map((e, i) => {
              const head = e.group !== lastGroup;
              lastGroup = e.group;
              const Icon = e.icon;
              return (
                <div key={e.key}>
                  {head && <div className="px-2 pb-1 pt-2 text-[12px] font-bold text-[var(--ro-muted)]">{e.group}</div>}
                  <button
                    type="button"
                    data-cursor={i === cursor}
                    onMouseMove={() => setCursor(i)}
                    onClick={e.run}
                    className={cn('flex w-full items-center gap-2.5 rounded-[var(--ro-r)] px-2 py-1.5 text-left', i === cursor && 'bg-[var(--ro-row)]')}
                  >
                    <Icon size={15} className="shrink-0 text-[var(--ro-ink-2)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{e.label}</span>
                      {e.sub !== undefined && e.sub !== '' && <span className="block truncate text-[12px] text-[var(--ro-muted)]">{e.sub}</span>}
                    </span>
                    {i === cursor && <CornerDownLeft size={13} className="shrink-0 text-[var(--ro-muted)]" />}
                  </button>
                </div>
              );
            })}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
