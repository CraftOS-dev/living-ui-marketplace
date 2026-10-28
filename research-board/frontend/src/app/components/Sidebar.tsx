/**
 * The sidebar: every board, to switch to and to manage (new, rename,
 * describe, duplicate, export, delete), and the workspace settings behind
 * one button. It collapses to give the board the whole window.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Download, FileText, Pencil, Plus, Search, Settings, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, download, errMessage } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { navigate } from '../lib/router.ts';
import type { Board } from '../lib/types.ts';
import { BoardForm } from './BoardForm.tsx';
import { CircleButton, MoreMenu, Popover, Toggle, pillInput, useConfirm } from './ui.tsx';

/* --------------------------------------------------------- open / closed */

const SideCtx = createContext<{ open: boolean; toggle: () => void; close: () => void }>({ open: true, toggle: () => undefined, close: () => undefined });

export function useSidebar(): { open: boolean; toggle: () => void; close: () => void } {
  return useContext(SideCtx);
}

const narrow = (): boolean => window.innerWidth < 768;

export function SidebarProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(() => {
    if (narrow()) return false;
    try {
      return localStorage.getItem('rb_sidebar') !== '0';
    } catch {
      return true;
    }
  });
  const set = useCallback((v: boolean) => {
    setOpen(v);
    if (narrow()) return;
    try {
      localStorage.setItem('rb_sidebar', v ? '1' : '0');
    } catch {
      /* a convenience */
    }
  }, []);
  const value = useMemo(() => ({ open, toggle: () => set(!open), close: () => set(false) }), [open, set]);
  return <SideCtx.Provider value={value}>{children}</SideCtx.Provider>;
}

/* ------------------------------------------------------------------ rows */

function BoardRow({ b, active, onPicked }: { b: Board; active: boolean; onPicked: () => void }): React.JSX.Element {
  const { boards } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(b.name);
  const [details, setDetails] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  useEffect(() => setName(b.name), [b.name]);

  const rename = async (): Promise<void> => {
    setRenaming(false);
    const n = name.trim();
    if (n === '' || n === b.name) {
      setName(b.name);
      return;
    }
    try {
      await api.updateBoard(b.id, { name: n });
    } catch {
      setName(b.name);
    }
  };
  const duplicate = async (): Promise<void> => {
    try {
      const r = await api.duplicateBoard(b.id);
      navigate('board', { id: r.board.id });
      toast.success('Board duplicated');
    } catch {
      /* toasted */
    }
  };
  const exportMd = async (): Promise<void> => {
    try {
      const r = await api.exportBoard(b.id);
      download(r.filename, r.content);
    } catch {
      /* toasted */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(`"${b.name}" and its ${b.cards} ${b.cards === 1 ? 'card' : 'cards'} will be deleted for good.`, 'Delete this board?', 'Delete board'))) return;
    try {
      await api.deleteBoard(b.id);
      if (active) {
        const next = boards.find((x) => x.id !== b.id);
        navigate('board', next !== undefined ? { id: next.id } : {});
      }
      toast.success('Board deleted');
    } catch {
      /* toasted */
    }
  };

  if (renaming) {
    return (
      <li className="px-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void rename();
            if (e.key === 'Escape') {
              setName(b.name);
              setRenaming(false);
            }
          }}
          aria-label="Board name"
          maxLength={120}
          className={pillInput}
        />
      </li>
    );
  }
  return (
    <li className="group relative px-2">
      <button
        type="button"
        onClick={() => {
          navigate('board', { id: b.id });
          onPicked();
        }}
        onDoubleClick={() => setRenaming(true)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-[6px] pl-2.5 pr-9 text-left text-[13px] transition-colors',
          active ? 'bg-[var(--rb-row-hover)] font-semibold text-[var(--rb-ink)]' : 'text-[var(--rb-ink-2)] hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]',
        )}
        title={b.description !== '' ? b.description : b.name}
      >
        <span className="min-w-0 flex-1 truncate">{b.name}</span>
        {(b.review_state === 'waiting' || b.review_state === 'working') && <span className="rb-pulse size-1.5 shrink-0 rounded-full bg-[var(--rb-accent)]" title="Your AI agent is reviewing it" />}
      </button>
      <span className="num pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--rb-muted)] group-hover:opacity-0">{b.cards}</span>
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <MoreMenu
          label={`${b.name} options`}
          size={24}
          align="left"
          items={[
            { label: 'Rename', icon: Pencil, onClick: () => setRenaming(true) },
            { label: 'Description', icon: FileText, onClick: () => setDetails(true) },
            { label: 'Duplicate', icon: Copy, onClick: () => void duplicate() },
            { label: 'Export as Markdown', icon: Download, onClick: () => void exportMd() },
            'divider',
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove() },
          ]}
        />
      </span>
      {details && <BoardForm board={b} onClose={() => setDetails(false)} />}
      {confirmEl}
    </li>
  );
}

/* -------------------------------------------------------------- settings */

function SettingsMenu(): React.JSX.Element {
  const { settings } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(settings?.title ?? '');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => setTitle(settings?.title ?? ''), [settings?.title]);
  const saveTitle = async (): Promise<void> => {
    const t = title.trim();
    if (t === '' || t === settings?.title) {
      setTitle(settings?.title ?? '');
      return;
    }
    try {
      await api.updateSettings({ title: t });
    } catch (err) {
      toast.error(errMessage(err));
    }
  };
  return (
    <div ref={ref} className="relative">
      <CircleButton icon={Settings} label="Settings" size={28} active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} keep={ref} align="left" className="w-72 p-3">
        <p className="mb-1.5 text-[12px] font-bold text-[var(--rb-ink-2)]">Workspace name</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveTitle()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} maxLength={120} aria-label="Workspace name" className={pillInput} />
        <div className="mt-3 flex items-start gap-3 border-t border-[var(--rb-line)] pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Link previews</p>
            <p className="mt-0.5 text-[12px] leading-[17px] text-[var(--rb-ink-2)]">Read a link's title and picture when it is added. Local addresses are never opened.</p>
          </div>
          <Toggle checked={settings?.link_previews ?? true} label="Link previews" onChange={(v) => void api.updateSettings({ link_previews: v }).catch(() => undefined)} />
        </div>
      </Popover>
    </div>
  );
}

/* --------------------------------------------------------------- sidebar */

export function Sidebar({ current }: { current: string }): React.JSX.Element | null {
  const { boards, title } = useApp();
  const side = useSidebar();
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const create = async (): Promise<void> => {
    const n = name.trim();
    setMaking(false);
    setName('');
    if (n === '') return;
    try {
      const r = await api.createBoard({ name: n });
      navigate('board', { id: r.board.id });
    } catch {
      /* toasted */
    }
  };
  const picked = (): void => {
    if (narrow()) side.close();
  };
  if (!side.open) return null;
  const needle = q.trim().toLowerCase();
  const shown = needle === '' ? boards : boards.filter((b) => b.name.toLowerCase().includes(needle));
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={side.close} aria-hidden />
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border-r border-[var(--rb-line)] bg-[var(--rb-card)] md:static md:z-auto" aria-label="Boards">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--rb-line)] pl-3 pr-2">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="shrink-0">
            <rect width="20" height="20" rx="5" fill="var(--rb-ink)" />
            <rect x="4.5" y="4.5" width="5" height="5" rx="1.2" fill="var(--rb-card)" />
            <rect x="11" y="10.5" width="5" height="5" rx="1.2" fill="var(--rb-card)" />
            <path d="M9.5 7 C 12 7, 13.5 8, 13.5 10.5" fill="none" stroke="var(--rb-card)" strokeWidth="1.2" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{title}</span>
          <SettingsMenu />
          <CircleButton icon={X} label="Close the sidebar" size={28} className="md:hidden" onClick={side.close} />
        </div>
        <div className="flex flex-col gap-2 p-2">
          <button type="button" onClick={() => setMaking(true)} className="flex h-8 items-center gap-2 rounded-[7px] border border-[var(--rb-line)] px-2.5 text-[13px] font-semibold hover:bg-[var(--rb-row)]">
            <Plus size={15} /> New board
          </button>
          {boards.length > 7 && (
            <label className="relative">
              <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--rb-ink-2)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a board" aria-label="Find a board" className={`${pillInput} pl-8`} />
            </label>
          )}
        </div>
        <p className="px-4 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--rb-muted)]">Boards</p>
        <ul data-scroll className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-3">
          {making && (
            <li className="px-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void create()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                  if (e.key === 'Escape') {
                    setName('');
                    setMaking(false);
                  }
                }}
                placeholder="Board name"
                aria-label="New board name"
                maxLength={120}
                className={pillInput}
              />
            </li>
          )}
          {shown.map((b) => (
            <BoardRow key={b.id} b={b} active={b.id === current} onPicked={picked} />
          ))}
          {boards.length === 0 && !making && <li className="px-4 py-2 text-[12px] leading-[17px] text-[var(--rb-ink-2)]">No boards yet.</li>}
        </ul>
      </aside>
    </>
  );
}
