/**
 * Ctrl K: find a person, company or deal; go to any view; create anything;
 * ask the AI agent. Arrow keys move, Enter picks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, FileUp, Kanban, ListTodo, Mail, MessageSquarePlus, Search, Sparkles, UserPlus, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { compact, money } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import { useApp } from '../lib/store.tsx';
import { useDialogs } from './dialogs.tsx';
import { NAV } from './Shell.tsx';
import { Avatar, CompanyMark } from './controls.tsx';
import { Kbd, Modal } from './ui.tsx';

interface Item {
  key: string;
  label: string;
  hint?: string | undefined;
  group: string;
  icon?: LucideIcon | undefined;
  lead?: React.ReactNode | undefined;
  run: () => void;
}


export function Palette({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const app = useApp();
  const d = useDialogs();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [found, setFound] = useState<Item[]>([]);
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) {
      setQ('');
      setFound([]);
    }
  }, [open]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return setFound([]);
    const tm = setTimeout(() => {
      api
        .search(t, 6)
        .then((r) =>
          setFound([
            ...r.people.map((p) => ({ key: 'p' + p.id, label: p.name, hint: [p.title, p.company_name].filter(Boolean).join(' · ') || p.email, group: 'People', lead: <Avatar name={p.name} size={18} />, run: () => go('people', { id: p.id }) })),
            ...r.companies.map((c) => ({ key: 'c' + c.id, label: c.name, hint: c.domain, group: 'Companies', lead: <CompanyMark name={c.name} size={18} />, run: () => go('companies', { id: c.id }) })),
            ...r.deals.map((x) => ({ key: 'd' + x.id, label: x.name, hint: x.stage_name + ' · ' + (x.home_value !== null ? compact(x.home_value, app.home) : money(x.value, x.currency)), group: 'Deals', icon: Kanban, run: () => go('deals', { id: x.id }) })),
          ]),
        )
        .catch(() => setFound([]));
    }, 150);
    return () => clearTimeout(tm);
  }, [q, app.home]);
  const actions: Item[] = useMemo(
    () => [
      { key: 'np', label: 'New person', group: 'Create', icon: UserPlus, hint: 'P', run: () => d.openNew('person') },
      { key: 'nc', label: 'New company', group: 'Create', icon: Building2, run: () => d.openNew('company') },
      { key: 'nd', label: 'New deal', group: 'Create', icon: Kanban, hint: 'D', run: () => d.openNew('deal') },
      { key: 'nl', label: 'Log an interaction', group: 'Create', icon: MessageSquarePlus, hint: 'L', run: () => d.openLog() },
      { key: 'nt', label: 'New task', group: 'Create', icon: ListTodo, hint: 'T', run: () => d.openTask() },
      { key: 'ne', label: 'New email', group: 'Create', icon: Mail, run: () => d.openEmail() },
      { key: 'ni', label: 'Import from CSV', group: 'Create', icon: FileUp, run: () => d.openImport() },
      ...NAV.map((v) => ({ key: 'v' + v.view, label: 'Go to ' + v.label, group: 'Go to', icon: v.icon, run: () => go(v.view) })),
      ...app.pipelines.map((p) => ({ key: 'pl' + p.id, label: p.name + ' board', group: 'Go to', icon: Kanban, run: () => go('deals', { pipeline: p.id }) })),
      ...app.lists.map((l) => ({ key: 'l' + l.id, label: l.name, hint: l.count + ' ' + l.object, group: 'Lists', icon: Users, run: () => go(l.object, { list: l.id }) })),
    ],
    [d, app.pipelines, app.lists],
  );
  const t = q.trim().toLowerCase();
  const shown = [...found, ...actions.filter((a) => t === '' || a.label.toLowerCase().includes(t))];
  if (t.length >= 2)
    shown.push({
      key: 'ask',
      label: 'Ask your AI agent: "' + q.trim() + '"',
      group: 'AI',
      icon: Sparkles,
      run: () =>
        void api
          .ask(q.trim())
          .then(() => toast.success('Asked; the answer appears under Ask AI'))
          .catch((err: unknown) => toast.error(errMessage(err))),
    });
  useEffect(() => setHi(0), [q, found.length]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);
  if (!open) return null;
  const pick = (i: number): void => {
    const it = shown[i];
    if (!it) return;
    onClose();
    it.run();
  };
  let group = '';
  return (
    <Modal open onClose={onClose} title="Search and commands" bare top width="lg">
      <div className="flex items-center gap-2 border-b border-[var(--cr-line)] px-3">
        <Search size={15} className="text-[var(--cr-muted)]" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(shown.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(hi);
            }
          }}
          placeholder="Find people, companies, deals, or type a command"
          className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={list} className="max-h-[60vh] overflow-y-auto p-1.5">
        {shown.map((it, i) => {
          const head = it.group !== group ? it.group : null;
          group = it.group;
          const Icon = it.icon;
          return (
            <div key={it.key}>
              {head !== null && <p className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">{head}</p>}
              <button type="button" data-i={i} onMouseEnter={() => setHi(i)} onClick={() => pick(i)} className={cn('flex h-9 w-full items-center gap-2.5 px-2 text-left text-[13px]', i === hi && 'bg-[var(--cr-row-hover)]')}>
                {it.lead ?? (Icon ? <Icon size={15} className={cn('shrink-0', it.group === 'AI' ? 'text-[var(--cr-accent-text)]' : 'text-[var(--cr-ink-2)]')} /> : null)}
                <span className="min-w-0 flex-1 truncate font-semibold">{it.label}</span>
                {it.hint && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-[var(--cr-muted)]">{it.hint}</span>}
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-[var(--cr-muted)]">Nothing matches</p>}
      </div>
    </Modal>
  );
}
