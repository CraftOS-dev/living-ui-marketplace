/**
 * App frame: a full-height app. On wide screens a slim icon rail on the left
 * (labels appear on hover, counts sit on the icons that have something
 * waiting); on phones a bottom bar with the add button in the middle. Some
 * pages (the library, the reader, a project) fill the whole page area.
 *
 * PDFs dropped anywhere are added to the library (and to the project or
 * collection the page is showing).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileUp, FolderKanban, History, House, Library, Menu, NotebookPen, Plus, Settings, Sparkles, Telescope } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { opForm } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { changed } from '../lib/live.ts';
import { SECTION, navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { useAddPapers } from './AddPapers.tsx';
import { Count, Popover, menuItem } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

const MAIN: NavItem[] = [
  { page: 'home', label: 'Home', icon: House },
  { page: 'library', label: 'Library', icon: Library },
  { page: 'projects', label: 'Projects', icon: FolderKanban },
  { page: 'discover', label: 'Discover', icon: Telescope },
  { page: 'notes', label: 'Notes', icon: NotebookPen },
];
const SECOND: NavItem[] = [
  { page: 'agent', label: 'Your AI agent', icon: Sparkles },
  { page: 'activity', label: 'Activity', icon: History },
];
const SETUP: NavItem[] = [{ page: 'settings', label: 'Settings', icon: Settings }];

/** The app's mark: an open book with an accent ribbon, on an ink tile. */
export function Mark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="ro-on-ink shrink-0">
      <rect width="40" height="40" rx="9" fill="var(--ro-ink)" />
      <path d="M8.5 12.5 C 12.5 11 16.5 11.3 19.4 13.2 L 19.4 29 C 16.5 27.2 12.5 26.9 8.5 28.3 Z" fill="var(--ro-shell)" />
      <path d="M31.5 12.5 C 27.5 11 23.5 11.3 20.6 13.2 L 20.6 29 C 23.5 27.2 27.5 26.9 31.5 28.3 Z" fill="var(--ro-track)" />
      <path d="M25 11.4 L 28.6 11.4 L 28.6 19.6 L 26.8 18.1 L 25 19.6 Z" fill="var(--ro-accent)" />
    </svg>
  );
}

/* --------------------------------------------------- where drops land */

interface DropTarget {
  project?: string | undefined;
  collection?: string | undefined;
}

const DropCtx = createContext<{ set: (t: DropTarget) => void; get: () => DropTarget }>({ set: () => undefined, get: () => ({}) });

/** A page says where dropped PDFs go while it is shown. */
export function useDropTarget(t: DropTarget): void {
  const ctx = useContext(DropCtx);
  const key = (t.project ?? '') + '|' + (t.collection ?? '');
  useEffect(() => {
    ctx.set(t);
    return () => ctx.set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function useBadges(): Partial<Record<Page, number>> {
  const { status } = useApp();
  if (status === null) return {};
  return { agent: status.needs_you, discover: status.new_candidates };
}

function RailButton({ item, active, badge }: { item: NavItem; active: boolean; badge: number | undefined }): React.JSX.Element {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => navigate(item.page)}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn('group relative flex size-9 shrink-0 items-center justify-center rounded-[var(--ro-r)] transition-colors', active ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-muted)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]')}
    >
      {active && <span aria-hidden className="absolute -left-2 bottom-2 top-2 w-0.5 rounded-r bg-[var(--ro-accent)]" />}
      <Icon size={18} strokeWidth={active ? 2.2 : 1.9} />
      <Count n={badge} className="absolute -right-1 -top-1 ring-2 ring-[var(--ro-card)]" />
      <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-[var(--ro-r)] bg-[var(--ro-ink)] px-2 py-1 text-[12px] font-semibold text-[var(--ro-shell)] opacity-0 shadow-[var(--ro-shadow)] transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </button>
  );
}

function Rail({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const section = SECTION[page];
  const add = useAddPapers();
  return (
    <aside className="ro-noprint sticky top-0 z-30 hidden h-dvh w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--ro-line)] bg-[var(--ro-card)] py-2 md:flex">
      <button type="button" onClick={() => navigate('home')} className="mb-1 flex size-9 items-center justify-center" aria-label="Home" title="Research OS">
        <Mark size={28} />
      </button>
      <button type="button" aria-label="Add papers" title="Add papers" onClick={() => add.open({})} className="group relative flex size-9 shrink-0 items-center justify-center rounded-[var(--ro-r)] bg-[var(--ro-accent)] text-[var(--ro-on-accent)] transition-opacity hover:opacity-90">
        <Plus size={18} strokeWidth={2.4} />
      </button>
      <nav className="flex flex-col items-center gap-1 border-t border-[var(--ro-hair)] pt-1" aria-label="Main">
        {MAIN.map((it) => (
          <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
        ))}
      </nav>
      <nav className="flex flex-col items-center gap-1 border-t border-[var(--ro-hair)] pt-1" aria-label="Your AI agent">
        {SECOND.map((it) => (
          <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
        ))}
      </nav>
      <span className="flex-1" />
      <nav className="flex flex-col items-center gap-1" aria-label="Setup">
        {SETUP.map((it) => (
          <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
        ))}
      </nav>
    </aside>
  );
}

function MobileBar({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const add = useAddPapers();
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const section = SECTION[page];
  const pinned: Page[] = ['home', 'library', 'projects'];
  const rest = [...MAIN, ...SECOND, ...SETUP].filter((it) => !pinned.includes(it.page));
  const tab = (it: NavItem): React.JSX.Element => {
    const Icon = it.icon;
    const active = it.page === section;
    return (
      <button key={it.page} type="button" onClick={() => navigate(it.page)} aria-label={it.label} aria-current={active ? 'page' : undefined} className={cn('relative flex size-10 items-center justify-center rounded-[var(--ro-r)]', active ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-muted)]')}>
        <Icon size={19} />
        <Count n={badges[it.page]} className="absolute -right-0.5 -top-0.5 ring-2 ring-[var(--ro-card)]" />
      </button>
    );
  };
  const restBadge = rest.reduce((a, it) => a + (badges[it.page] ?? 0), 0);
  return (
    <div className="ro-noprint fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-[var(--ro-line)] bg-[var(--ro-card)] px-2 md:hidden">
      {tab(MAIN[0] as NavItem)}
      {tab(MAIN[1] as NavItem)}
      <button type="button" aria-label="Add papers" onClick={() => add.open({})} className="flex size-10 items-center justify-center rounded-[var(--ro-r-md)] bg-[var(--ro-accent)] text-[var(--ro-on-accent)] active:opacity-90">
        <Plus size={20} strokeWidth={2.4} />
      </button>
      {tab(MAIN[2] as NavItem)}
      <button ref={moreRef} type="button" aria-label="More pages" onClick={() => setMore((m) => !m)} className={cn('relative flex size-10 items-center justify-center rounded-[var(--ro-r)]', !pinned.includes(section) ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-muted)]')}>
        <Menu size={19} />
        <Count n={restBadge} className="absolute -right-0.5 -top-0.5 ring-2 ring-[var(--ro-card)]" />
      </button>
      <Popover open={more} onClose={() => setMore(false)} anchor={moreRef} align="right" side="top" className="w-56">
        {rest.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.page}
              type="button"
              onClick={() => {
                setMore(false);
                navigate(it.page);
              }}
              className={cn(menuItem, it.page === section && 'bg-[var(--ro-row)]')}
            >
              <Icon size={15} />
              <span className="flex-1">{it.label}</span>
              <Count n={badges[it.page]} />
            </button>
          );
        })}
      </Popover>
    </div>
  );
}

/** The whole-window drop zone for PDFs. */
function DropZone({ target }: { target: () => DropTarget }): React.JSX.Element | null {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const upload = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (pdfs.length === 0) {
        toast.error('Only PDF files can be added this way.');
        return;
      }
      const t = target();
      try {
        for (let i = 0; i < pdfs.length; i += 10) {
          await opForm('files.upload', { project: t.project, collection: t.collection }, { file: pdfs.slice(i, i + 10) });
        }
        toast.success(pdfs.length === 1 ? 'Added ' + pdfs[0]?.name : 'Added ' + pdfs.length + ' PDFs');
        changed('works', 'files');
      } catch {
        /* toasted */
      }
    },
    [target],
  );
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setOver(true);
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overFn = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      if (document.querySelector('[data-own-drop="true"]:hover') !== null) return;
      void upload(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, [upload]);
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-[var(--ro-ink)]/20 p-6">
      <div className="ro-pop flex flex-col items-center gap-2 rounded-[var(--ro-r-lg)] border-2 border-dashed border-[var(--ro-accent)] bg-[var(--ro-card)] px-10 py-8 shadow-[var(--ro-shadow)]">
        <FileUp size={28} className="text-[var(--ro-accent-text)]" />
        <span className="text-[14px] font-bold">Drop PDFs to add them</span>
      </div>
    </div>
  );
}

export function Frame({ page, children, wide = false }: { page: Page; children: ReactNode; wide?: boolean }): React.JSX.Element {
  const badges = useBadges();
  const target = useRef<DropTarget>({});
  const ctx = useRef({ set: (t: DropTarget) => (target.current = t), get: () => target.current });
  return (
    <DropCtx.Provider value={ctx.current}>
      <div className="flex min-h-dvh bg-[var(--ro-shell)]">
        <Rail page={page} badges={badges} />
        <main className={cn('min-w-0 flex-1 @container', wide ? 'h-[calc(100dvh-56px)] overflow-hidden md:h-dvh' : 'px-3 pb-20 pt-4 @min-[640px]:px-6 md:pb-8 md:pt-5')}>{wide ? children : <div className="mx-auto w-full max-w-[1400px]">{children}</div>}</main>
        <MobileBar page={page} badges={badges} />
        <DropZone target={ctx.current.get} />
      </div>
    </DropCtx.Provider>
  );
}
