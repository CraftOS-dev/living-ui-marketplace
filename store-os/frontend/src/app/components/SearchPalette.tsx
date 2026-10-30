/**
 * Search everything at once (Ctrl K): orders, products, buyers and
 * conversations. Arrow keys move, Enter opens.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Package, Search, Tag, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { STATUS_LABEL } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import type { SearchResult } from '../lib/types.ts';
import { useOpenSignal } from './Shell.tsx';

interface Hit {
  key: string;
  group: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  to: string;
  image?: string;
}

export function SearchPalette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [at, setAt] = useState(0);
  useOpenSignal(
    'search',
    useCallback(() => setOpen(true), []),
  );
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (!open) {
      setQ('');
      setRes(null);
      return;
    }
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      op<SearchResult>('app.search', { q: q.trim() }, { signal: ctrl.signal, quiet: true })
        .then((r) => {
          setRes(r);
          setAt(0);
        })
        .catch(() => undefined);
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);
  const hits = useMemo<Hit[]>(() => {
    if (res === null) return [];
    return [
      ...res.orders.map((o) => ({ key: 'o' + o.id, group: 'Orders', icon: Package, title: 'Order ' + o.number, sub: [o.buyer, STATUS_LABEL[o.status]].filter(Boolean).join(', '), to: href('orders', 'all', o.id) })),
      ...res.products.map((p) => ({ key: 'p' + p.id, group: 'Products', icon: Tag, title: p.title, sub: 'Product', to: href('product', p.id), image: p.image })),
      ...res.customers.map((c) => ({ key: 'c' + c.id, group: 'Buyers', icon: User, title: c.name || c.email, sub: c.email, to: href('customers', 'all', c.id) })),
      ...res.threads.map((t) => ({ key: 't' + t.id, group: 'Conversations', icon: MessageSquare, title: t.subject, sub: t.status, to: href('inbox', 'all', t.id) })),
    ];
  }, [res]);
  if (!open) return null;
  const choose = (h: Hit | undefined): void => {
    if (!h) return;
    window.location.hash = h.to;
    setOpen(false);
  };
  let lastGroup = '';
  return createPortal(
    <div className="so-portal fixed inset-0 z-[85] flex justify-center bg-[var(--so-overlay)] p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="so-zoom flex h-fit max-h-[70vh] w-[min(94vw,600px)] flex-col overflow-hidden rounded-[24px] bg-[var(--so-card)] text-[var(--so-ink)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--so-line)] px-5">
          <Search size={18} className="text-[var(--so-muted)]" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAt((i) => Math.min(hits.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') choose(hits[at]);
            }}
            placeholder="Order number, product, SKU, buyer..."
            aria-label="Search"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none"
          />
          <kbd className="rounded-[6px] bg-[var(--so-tile)] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-[var(--so-muted)]">Esc</kbd>
        </div>
        <div className="min-h-0 overflow-y-auto p-2">
          {q.trim().length >= 2 && res !== null && hits.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-[var(--so-muted)]">Nothing found for "{q.trim()}"</p>}
          {hits.map((h, i) => {
            const head = h.group !== lastGroup;
            lastGroup = h.group;
            const Icon = h.icon;
            return (
              <div key={h.key}>
                {head && <p className="px-3 pb-1 pt-2 text-[12px] font-semibold text-[var(--so-muted)]">{h.group}</p>}
                <button type="button" onMouseEnter={() => setAt(i)} onClick={() => choose(h)} className={cn('flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left', i === at ? 'bg-[var(--so-tile)]' : 'hover:bg-[var(--so-row-hover)]')}>
                  {h.image ? <img src={h.image} alt="" className="size-9 rounded-[10px] object-cover" /> : <span className="flex size-9 items-center justify-center rounded-full bg-[var(--so-tile)]"><Icon size={16} /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{h.title}</span>
                    {h.sub !== '' && <span className="block truncate text-[12px] text-[var(--so-muted)]">{h.sub}</span>}
                  </span>
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
