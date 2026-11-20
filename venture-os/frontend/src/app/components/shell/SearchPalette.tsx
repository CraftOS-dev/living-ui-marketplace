/**
 * Ctrl K: search people, companies, deals, LPs, funds and files at once
 * (search.query), jump to a place, run a module's command, or tell your AI
 * agent what was typed. Arrow keys move, Enter opens.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Briefcase, Building2, CalendarDays, File, FileText, Landmark, Mail, Search, Sparkle, User, Users, Zap } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { go, useRoute } from '../../lib/router.ts';
import type { SearchHit } from '../../lib/types.ts';
import { commands, navItems } from '../../registry.ts';
import { Avatar, Kbd, Spinner } from '../ui.tsx';
import { askAgent } from './AgentPanel.tsx';

const GROUP: Record<string, { label: string; icon: LucideIcon; avatar?: 'person' | 'company' }> = {
  people: { label: 'People', icon: User, avatar: 'person' },
  companies: { label: 'Companies', icon: Building2, avatar: 'company' },
  deals: { label: 'Deals', icon: Briefcase },
  lps: { label: 'LPs', icon: Landmark },
  funds: { label: 'Funds', icon: Landmark },
  files: { label: 'Files', icon: File },
};

let opener: (() => void) | null = null;
export function openSearch(): void {
  opener?.();
}

interface Row {
  key: string;
  group: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  run: () => void;
  avatar?: 'person' | 'company' | undefined;
  agent?: boolean | undefined;
}

/** The lucide names a search result may carry (search.query `icon`). */
const ICONS: Record<string, LucideIcon> = { Building2, Briefcase, User, Users, Landmark, File, FileText, CalendarDays, Mail };

function iconByName(name: string | undefined): LucideIcon | null {
  if (name === undefined || name === '') return null;
  return ICONS[name] ?? null;
}

export function SearchPalette(): React.JSX.Element | null {
  const me = useMe();
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(0);
  useEffect(() => {
    opener = () => setOpen(true);
    const k = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', k);
    return () => {
      opener = null;
      window.removeEventListener('keydown', k);
    };
  }, []);
  useEffect(() => {
    if (!open) {
      setQ('');
      setHits(null);
      setAt(0);
      return;
    }
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      op<{ results: SearchHit[] }>('search.query', { q: q.trim() }, { signal: ctrl.signal, quiet: true })
        .then((r) => {
          setHits(r.results);
          setAt(0);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const n = q.trim().toLowerCase();
    const close = (fn: () => void) => (): void => {
      setOpen(false);
      fn();
    };
    const found: Row[] = (hits ?? []).map((h) => {
      const g = GROUP[h.kind];
      return { key: h.kind + h.id, group: g?.label ?? 'Results', icon: iconByName(h.icon) ?? g?.icon ?? FileText, title: h.title, sub: h.subtitle, run: close(() => go(h.href)), avatar: g?.avatar };
    });
    const places: Row[] = navItems()
      .filter((p) => allowed(me, p.perm) && (n === '' || p.label.toLowerCase().includes(n)))
      .map((p) => ({ key: 'p' + p.key, group: 'Go to', icon: p.icon, title: p.label, sub: '', run: close(() => go(p.path)) }));
    const cmds: Row[] = commands()
      .filter((c) => allowed(me, c.perm) && (n === '' || `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(n)))
      .map((c) => ({ key: 'c' + c.key, group: 'Actions', icon: c.icon ?? Zap, title: c.label, sub: '', run: close(c.run) }));
    const ask: Row[] =
      n.length >= 3
        ? [{ key: 'ask', group: 'Your AI agent', icon: Sparkle, title: q.trim(), sub: '', agent: true, run: close(() => void askAgent(q, path)) }]
        : [];
    return [...found, ...cmds.slice(0, n === '' ? 6 : 4), ...(n === '' ? places : places.slice(0, 4)), ...ask];
  }, [hits, q, me, path]);

  if (!open) return null;
  let last = '';
  return createPortal(
    <div className="vo-scrim fixed inset-0 z-[85] flex justify-center p-3 pt-[10vh] sm:p-4 sm:pt-[12vh]" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="vo-fade flex h-fit max-h-[72vh] w-[min(96vw,620px)] flex-col overflow-hidden rounded-[calc(var(--vo-radius)*1.5)] border border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink)] shadow-[var(--vo-shadow-lg)]">
        <div className="flex items-center gap-3 border-b border-[var(--vo-line)] px-4">
          {loading ? <Spinner size={16} className="text-[var(--vo-muted)]" /> : <Search size={16} className="text-[var(--vo-muted)]" aria-hidden />}
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAt((i) => Math.min(rows.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') rows[at]?.run();
            }}
            placeholder="Search or ask"
            aria-label="Search or ask"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--vo-muted)]"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="vo-scroll min-h-0 overflow-y-auto p-1.5">
          {q.trim().length >= 2 && hits !== null && hits.length === 0 && !loading && <p className="px-3 py-3 text-[12px] text-[var(--vo-muted)]">Nothing found</p>}
          {rows.map((r, i) => {
            const head = r.group !== last;
            last = r.group;
            const Icon = r.icon;
            return (
              <div key={r.key}>
                {head && <div className="vo-label px-2.5 pb-1 pt-2.5">{r.group}</div>}
                <button type="button" onMouseEnter={() => setAt(i)} onClick={r.run} className={cn('vo-focus flex w-full items-center gap-3 rounded-[var(--vo-radius-sm)] px-2.5 py-1.5 text-left transition-colors duration-150', i === at ? 'bg-[var(--vo-hover)]' : '')}>
                  {r.avatar !== undefined ? (
                    <Avatar name={r.title} size={26} square={r.avatar === 'company'} />
                  ) : (
                    <span className={cn('flex size-[26px] shrink-0 items-center justify-center rounded-[6px]', r.agent === true ? 'bg-[var(--vo-agent)] text-[var(--vo-agent-ink)]' : 'border border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]')}>
                      <Icon size={14} aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="vo-wrap block text-[13px]">{r.title}</span>
                    {r.sub !== '' && <span className="block truncate text-[12px] text-[var(--vo-muted)]">{r.sub}</span>}
                  </span>
                  {i === at && <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
