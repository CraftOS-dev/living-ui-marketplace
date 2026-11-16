/**
 * Search everything at once (Ctrl K): people, pay runs, requests,
 * candidates, the app's pages, and "Ask your AI agent" with what was typed.
 * Arrow keys move, Enter opens.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Banknote, Building2, CalendarDays, FileText, Receipt, Search, Sparkle, User, UserPlus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { useRoute } from '../../lib/router.ts';
import { places } from '../../routes.tsx';
import { Avatar, ItemFacts, Kbd, Spinner } from '../ui.tsx';
import type { ItemFact } from '../ui.tsx';
import { askAgent } from './AgentPanel.tsx';

export interface SearchHit {
  group: string;
  id: string;
  title: string;
  subtitle: string;
  /** Structured facts; the subtitle (plain text) shows only when there are none. */
  facts?: ItemFact[] | undefined;
  link: string;
}

const GROUP_ICON: Record<string, LucideIcon> = { people: User, departments: Building2, entities: Building2, payruns: Banknote, leave: CalendarDays, claims: Receipt, candidates: UserPlus };

let opener: (() => void) | null = null;
export function openSearch(): void {
  opener?.();
}

interface Row {
  key: string;
  group: string;
  icon: LucideIcon;
  title: string;
  sub: React.ReactNode;
  run: () => void;
  photo?: string | undefined;
  person?: boolean | undefined;
  agent?: boolean | undefined;
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
    const go = (link: string) => (): void => {
      window.location.hash = link.startsWith('#') ? link.slice(1) : link;
      setOpen(false);
    };
    const pageRows: Row[] = places()
      .filter((p) => allowed(me, p.perm) && (n === '' || p.label.toLowerCase().includes(n)))
      .map((p) => ({ key: 'p' + p.module, group: t('search.pages'), icon: p.icon, title: p.label, sub: '', run: go(p.to) }));
    const found: Row[] = (hits ?? []).map((h) => ({
      key: h.group + h.id,
      group: t(`search.group.${h.group}`),
      icon: GROUP_ICON[h.group] ?? FileText,
      title: h.title,
      sub: (h.facts ?? []).length > 0 ? <ItemFacts facts={h.facts ?? []} /> : h.subtitle,
      run: go(h.link),
      person: h.group === 'people' || h.group === 'candidates',
    }));
    const ask: Row[] =
      n.length >= 3
        ? [
            {
              key: 'ask',
              group: t('agent.name'),
              icon: Sparkle,
              title: t('search.ask', { q: q.trim() }),
              sub: t('search.ask_sub'),
              agent: true,
              run: () => {
                void askAgent(q, path);
                setOpen(false);
              },
            },
          ]
        : [];
    return [...found, ...(n === '' ? pageRows : pageRows.slice(0, 4)), ...ask];
  }, [hits, q, me, path]);

  if (!open) return null;
  let lastGroup = '';
  return createPortal(
    <div className="hr-scrim fixed inset-0 z-[85] flex justify-center p-3 pt-[10vh] sm:p-4 sm:pt-[12vh]" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label={t('search.open')} className="hr-dialog flex h-fit max-h-[72vh] w-[min(96vw,620px)] flex-col overflow-hidden rounded-[calc(var(--hr-radius)*1.5)] border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink)] shadow-[var(--hr-shadow-lg)]">
        <div className="flex items-center gap-3 border-b border-[var(--hr-line)] px-4">
          {loading ? <Spinner size={16} className="text-[var(--hr-muted)]" /> : <Search size={16} className="text-[var(--hr-muted)]" aria-hidden />}
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
            placeholder={t('search.placeholder')}
            aria-label={t('search.open')}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--hr-muted)]"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="hr-scroll min-h-0 overflow-y-auto p-1.5">
          {q.trim().length >= 2 && hits !== null && hits.length === 0 && !loading && <p className="px-3 py-3 text-[12px] text-[var(--hr-muted)]">{t('search.nothing', { q: q.trim() })}</p>}
          {rows.map((r, i) => {
            const head = r.group !== lastGroup;
            lastGroup = r.group;
            const Icon = r.icon;
            return (
              <div key={r.key}>
                {head && <div className="hr-label px-2.5 pb-1 pt-2.5">{r.group}</div>}
                <button type="button" onMouseEnter={() => setAt(i)} onClick={r.run} className={cn('hr-focus flex w-full items-center gap-3 rounded-[var(--hr-radius-sm)] px-2.5 py-1.5 text-left', i === at ? 'bg-[var(--hr-hover)]' : '')}>
                  {r.person === true ? (
                    <Avatar name={r.title} photo={r.photo} size={26} />
                  ) : (
                    <span className={cn('flex size-[26px] shrink-0 items-center justify-center rounded-[6px]', r.agent === true ? 'bg-[var(--hr-agent)] text-[var(--hr-agent-ink)]' : 'border border-[var(--hr-line)] bg-[var(--hr-sunk)] text-[var(--hr-ink-2)]')}>
                      <Icon size={14} aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="hr-wrap block text-[13px]">{r.title}</span>
                    {r.sub !== '' && <span className="block truncate text-[12px] text-[var(--hr-muted)]">{r.sub}</span>}
                  </span>
                  {i === at && <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />}
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
