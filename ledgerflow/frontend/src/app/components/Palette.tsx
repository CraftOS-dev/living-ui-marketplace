/**
 * Ctrl+K: go anywhere, start anything, find any entry, document, contact or
 * account (words or an amount).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownToLine, BookOpen, ChartColumn, CircleCheckBig, FileInput, FileOutput, FileText, History, Inbox, Landmark, LayoutDashboard, Plus, Scale, Search, Settings, User } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { DOC_LABEL, day, money } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import { useApp } from '../lib/store.tsx';
import type { Doc, TxnRow } from '../lib/types.ts';
import { useDialogs } from './dialogs.tsx';
import { Modal } from './ui.tsx';

interface Item {
  key: string;
  group: string;
  label: string;
  hint?: string | undefined;
  icon: LucideIcon;
  run: () => void;
}

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const app = useApp();
  const d = useDialogs();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const list = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQ('');
      setTxns([]);
      setDocs([]);
    }
  }, [open]);

  useEffect(() => {
    const t = q.trim();
    if (!open || t.length < 2) {
      setTxns([]);
      setDocs([]);
      return;
    }
    const h = setTimeout(() => {
      api
        .transactions({ q: t, limit: 8, status: 'all' })
        .then((r) => setTxns(r.transactions))
        .catch(() => setTxns([]));
      api
        .docs({ q: t, limit: 6, state: 'all' })
        .then((r) => setDocs(r.docs))
        .catch(() => setDocs([]));
    }, 180);
    return () => clearTimeout(h);
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase();
    const match = (s: string): boolean => t === '' || t.split(/\s+/).every((w) => s.toLowerCase().includes(w));
    const cmds: Item[] = [
      { key: 'v-home', group: 'Go to', label: 'Home dashboard', icon: LayoutDashboard, run: () => go('home') },
      { key: 'v-inbox', group: 'Go to', label: 'Inbox', icon: Inbox, run: () => go('inbox') },
      { key: 'v-ledger', group: 'Go to', label: 'Ledger', icon: BookOpen, run: () => go('ledger') },
      { key: 'v-rec', group: 'Go to', label: 'Reconcile', icon: Scale, run: () => go('reconcile') },
      { key: 'v-sales', group: 'Go to', label: 'Sales: invoices', icon: FileOutput, run: () => go('sales') },
      { key: 'v-purch', group: 'Go to', label: 'Purchases: bills', icon: FileInput, run: () => go('purchases') },
      { key: 'v-pnl', group: 'Go to', label: 'Profit and loss', icon: ChartColumn, run: () => go('reports', { r: 'pnl' }) },
      { key: 'v-bs', group: 'Go to', label: 'Balance sheet', icon: ChartColumn, run: () => go('reports', { r: 'balance' }) },
      { key: 'v-tax', group: 'Go to', label: 'Tax summary', icon: ChartColumn, run: () => go('reports', { r: 'tax' }) },
      { key: 'v-close', group: 'Go to', label: 'Close the month', icon: CircleCheckBig, run: () => go('close') },
      { key: 'v-act', group: 'Go to', label: 'Activity and AI runs', icon: History, run: () => go('activity') },
      { key: 'v-rules', group: 'Go to', label: 'Rules', icon: Settings, run: () => go('setup', { tab: 'rules' }) },
      { key: 'v-chart', group: 'Go to', label: 'Chart of accounts', icon: Settings, run: () => go('setup', { tab: 'accounts' }) },
      { key: 'v-ai', group: 'Go to', label: 'AI agent policy', icon: Settings, run: () => go('setup', { tab: 'agent' }) },
      { key: 'n-imp', group: 'New', label: 'Import bank statement', icon: ArrowDownToLine, run: () => d.openImport() },
      { key: 'n-exp', group: 'New', label: 'Expense', icon: Plus, run: () => d.openEntry('expense') },
      { key: 'n-inc', group: 'New', label: 'Income', icon: Plus, run: () => d.openEntry('income') },
      { key: 'n-tr', group: 'New', label: 'Transfer', icon: Plus, run: () => d.openEntry('transfer') },
      { key: 'n-jr', group: 'New', label: 'Journal entry', icon: Plus, run: () => d.openEntry('journal') },
      { key: 'n-inv', group: 'New', label: 'Invoice', icon: Plus, run: () => go('sales', { doc: 'new', kind: 'invoice' }) },
      { key: 'n-bill', group: 'New', label: 'Bill', icon: Plus, run: () => go('purchases', { doc: 'new', kind: 'bill' }) },
      { key: 'n-up', group: 'New', label: 'Add receipts', icon: FileInput, run: () => d.openUpload() },
    ].filter((c) => match(c.label));
    if (t === '') return cmds;
    const out: Item[] = [...cmds];
    for (const a of app.accounts) if (match(a.name + ' ' + a.code)) out.push({ key: 'a' + a.id, group: 'Accounts', label: a.name, hint: a.code, icon: Landmark, run: () => go('ledger', { account: a.id }) });
    for (const c of app.contacts) if (match(c.name + ' ' + c.aliases.join(' '))) out.push({ key: 'c' + c.id, group: 'Contacts', label: c.name, hint: c.email, icon: User, run: () => go('setup', { tab: 'contacts', contact: c.id }) });
    for (const x of docs)
      out.push({
        key: 'd' + x.id,
        group: 'Documents',
        label: DOC_LABEL[x.kind] + ' ' + (x.number || '(draft)') + ' · ' + x.contact_name,
        hint: money(x.total, x.currency),
        icon: FileText,
        run: () => go(x.kind === 'bill' || x.kind === 'vendor_credit' ? 'purchases' : 'sales', { doc: x.id }),
      });
    for (const x of txns) out.push({ key: 't' + x.id, group: 'Entries', label: (x.narration || x.kind) + ' · ' + day(x.date), hint: money(x.total, app.home), icon: BookOpen, run: () => go('ledger', { txn: x.id }) });
    return out.slice(0, 60);
  }, [q, app, d, txns, docs]);

  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  if (!open) return null;
  const run = (it: Item | undefined): void => {
    if (it === undefined) return;
    onClose();
    it.run();
  };
  let lastGroup = '';
  return (
    <Modal open onClose={onClose} title="Search and commands" bare top width="lg">
      <div className="flex items-center gap-2 border-b border-[var(--lf-hair)] px-3">
        <Search size={15} className="shrink-0 text-[var(--lf-muted)]" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(items.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(items[hi]);
            }
          }}
          placeholder="Go to, create, or find an entry, invoice, contact or amount"
          className="h-11 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
        />
      </div>
      <div ref={list} className="max-h-[56vh] overflow-y-auto p-1">
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          const Icon = it.icon;
          return (
            <div key={it.key}>
              {head !== null && <div className="px-2 pb-0.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--lf-muted)]">{head}</div>}
              <button type="button" data-i={i} onMouseEnter={() => setHi(i)} onClick={() => run(it)} className={cn('flex h-8 w-full items-center gap-2.5 rounded-[5px] px-2 text-left text-[13px]', i === hi && 'bg-[var(--lf-row-hover)]')}>
                <Icon size={14} className="shrink-0 text-[var(--lf-ink-2)]" />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint !== undefined && it.hint !== '' && <span className="num shrink-0 text-[12px] text-[var(--lf-muted)]">{it.hint}</span>}
              </button>
            </div>
          );
        })}
        {items.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-[var(--lf-muted)]">Nothing found</p>}
      </div>
    </Modal>
  );
}
