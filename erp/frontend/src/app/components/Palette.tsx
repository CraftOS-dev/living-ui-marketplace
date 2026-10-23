/**
 * Search everything (Ctrl K or the Search button): documents by number,
 * customer or reference; customers and suppliers; items by name, SKU or
 * barcode; people, projects, accounts, journals and payments; and the
 * app's own pages ("bills", "payroll"). Arrow keys move, Enter opens.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BookOpen, Building2, FileText, FolderKanban, Package, Receipt, Search, User } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { useMe } from '../lib/me.ts';
import { SETTINGS_ENTRY, buildNav } from '../lib/nav.ts';
import { navigate } from '../lib/router.ts';
import type { Page, Query } from '../lib/router.ts';
import type { SearchResult } from '../lib/types.ts';
import { useDebounced } from './controls.tsx';
import { docTypeLabel } from './status.ts';

interface Hit {
  key: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  right?: string | undefined;
  page: Page;
  query?: Query | undefined;
  group: string;
}

const Ctx = createContext<{ open: () => void } | null>(null);

export function usePalette(): { open: () => void } {
  const v = useContext(Ctx);
  if (v === null) throw new Error('usePalette outside PaletteProvider');
  return v;
}

function hitOf(r: SearchResult & Record<string, unknown>): Hit | null {
  const amount = typeof r.amount === 'number' && typeof r.currency === 'string' && r.currency !== '' ? money(r.amount, r.currency) : undefined;
  switch (r.kind) {
    case 'document':
      return { key: `d${r.id}`, icon: FileText, title: r.title !== '' ? r.title : `Draft ${docTypeLabel(String(r.type ?? '')).toLowerCase()}`, sub: [docTypeLabel(String(r.type ?? '')), r.subtitle].filter((x) => x !== '').join(' · '), right: amount, page: 'doc', query: { id: r.id }, group: 'Documents' };
    case 'party':
      return { key: `p${r.id}`, icon: Building2, title: r.title, sub: [r.is_customer === true ? 'Customer' : '', r.is_supplier === true ? 'Supplier' : '', r.subtitle].filter((x) => x !== '').join(' · '), page: 'party', query: { id: r.id, role: r.is_customer === true ? 'customer' : 'supplier' }, group: 'Customers and suppliers' };
    case 'item':
      return { key: `i${r.id}`, icon: Package, title: r.title, sub: r.subtitle, page: 'item', query: { id: r.id }, group: 'Items' };
    case 'employee':
      return { key: `e${r.id}`, icon: User, title: r.title, sub: r.subtitle, page: 'employee', query: { id: r.id }, group: 'People' };
    case 'project':
      return { key: `j${r.id}`, icon: FolderKanban, title: r.title, sub: r.subtitle, page: 'project', query: { id: r.id }, group: 'Projects' };
    case 'account':
      return { key: `a${r.id}`, icon: BookOpen, title: `${r.subtitle} ${r.title}`, sub: 'Account', page: 'account', query: { id: r.id }, group: 'Accounts' };
    case 'journal':
      return { key: `n${r.id}`, icon: BookOpen, title: r.title, sub: r.subtitle, page: 'journal', query: { id: r.id }, group: 'Journal entries' };
    case 'payment':
      return { key: `y${r.id}`, icon: Receipt, title: r.title, sub: [r.direction === 'in' ? 'Money in' : 'Money out', r.subtitle].filter((x) => x !== '').join(' · '), right: amount, page: 'payment', query: { id: r.id }, group: 'Payments' };
    default:
      return null;
  }
}

function PaletteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 160);
  const [found, setFound] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement | null>(null);

  const pages = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    for (const n of buildNav(me, [])) {
      if (n.kind === 'single') out.push({ key: `g${n.item.key}`, icon: n.item.icon, title: n.item.label, sub: 'Page', page: n.item.page, query: n.item.query, group: 'Pages' });
      else for (const x of n.group.entries) out.push({ key: `g${x.key}`, icon: n.group.icon, title: x.label, sub: n.group.label, page: x.page, query: x.query, group: 'Pages' });
    }
    out.push({ key: 'gsettings', icon: SETTINGS_ENTRY.icon, title: 'Settings', sub: 'Page', page: 'settings', group: 'Pages' });
    return out;
  }, [me]);

  useEffect(() => {
    if (dq.length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    op<{ results: (SearchResult & Record<string, unknown>)[] }>('search.global', { q: dq, limit: 6 }, { quiet: true })
      .then((r) => {
        if (live) setFound(r.results.map(hitOf).filter((h): h is Hit => h !== null));
      })
      .catch(() => {
        if (live) setFound([]);
      });
    return () => {
      live = false;
    };
  }, [dq]);

  const lower = q.trim().toLowerCase();
  const pageHits = lower === '' ? pages.slice(0, 8) : pages.filter((p) => p.title.toLowerCase().includes(lower) || p.sub.toLowerCase().includes(lower)).slice(0, 6);
  const hits = [...found, ...pageHits];
  useEffect(() => setCursor(0), [q, found.length]);

  const openHit = useCallback(
    (h: Hit) => {
      onClose();
      navigate(h.page, h.query);
    },
    [onClose],
  );

  useEffect(() => {
    list.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastGroup = '';
  return (
    <RadixDialog.Root open onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px]" />
        <RadixDialog.Content className="@container erp-pop fixed left-1/2 top-[10vh] z-[81] w-[min(94vw,40rem)] -translate-x-1/2 overflow-hidden rounded-[28px] bg-[var(--erp-shell)] text-[var(--erp-ink)] shadow-2xl">
          <RadixDialog.Title className="sr-only">Search</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Search documents, customers, items, people and pages</RadixDialog.Description>
          <div className="relative border-b border-[var(--erp-line)]">
            <Search size={18} aria-hidden className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search"
              placeholder="Search invoices, customers, items, people..."
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(hits.length - 1, c + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const h = hits[cursor];
                  if (h !== undefined) openHit(h);
                }
              }}
              className="h-16 w-full bg-transparent pl-14 pr-6 text-[15px] font-semibold outline-none placeholder:font-medium"
            />
          </div>
          <div ref={list} className="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Results">
            {hits.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-[var(--erp-muted)]">{dq.length < 2 ? 'Type a number, a name or a page' : 'Nothing matches'}</p>}
            {hits.map((h, i) => {
              const head = h.group !== lastGroup ? h.group : null;
              lastGroup = h.group;
              const Icon = h.icon;
              return (
                <div key={h.key}>
                  {head !== null && <p className="px-3 pb-1 pt-3 text-[12px] font-bold text-[var(--erp-muted)]">{head}</p>}
                  <button
                    type="button"
                    role="option"
                    data-i={i}
                    aria-selected={cursor === i}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => openHit(h)}
                    className={cn('flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left', cursor === i && 'bg-[var(--erp-card)]')}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">
                      <Icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{h.title}</span>
                      {h.sub !== '' && <span className="block truncate text-[12px] text-[var(--erp-muted)]">{h.sub}</span>}
                    </span>
                    {h.right !== undefined && <span className="num shrink-0 text-[13px] font-bold">{h.right}</span>}
                    {cursor === i && <ArrowRight size={15} className="shrink-0 text-[var(--erp-muted)]" aria-hidden />}
                  </button>
                </div>
              );
            })}
          </div>
          <div aria-hidden className="flex items-center gap-4 border-t border-[var(--erp-line)] px-6 py-3 text-[12px] font-semibold text-[var(--erp-muted)]">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-[6px] bg-[var(--erp-row)] px-1.5 font-sans text-[var(--erp-ink-2)]">Enter</kbd> open
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-[6px] bg-[var(--erp-row)] px-1.5 font-sans text-[var(--erp-ink-2)]">Up</kbd>
              <kbd className="rounded-[6px] bg-[var(--erp-row)] px-1.5 font-sans text-[var(--erp-ink-2)]">Down</kbd> move
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-[6px] bg-[var(--erp-row)] px-1.5 font-sans text-[var(--erp-ink-2)]">Esc</kbd> close
            </span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function PaletteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !open) {
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, select, [contenteditable="true"]') === null) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && <PaletteDialog onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}
