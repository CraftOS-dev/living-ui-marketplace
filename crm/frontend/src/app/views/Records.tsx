/**
 * People and companies: a sidebar of built-in views, lists and saved views;
 * a toolbar with search, filters, columns and saving the view; the table
 * (inline editing, sorting, selection, bulk actions); the peek on the right.
 * #/people?id=.. opens a person's page. Keys: J/K move, Enter opens, X
 * selects, / searches.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bookmark, Building2, Cake, Clock, Copy, Download, FileUp, Flame, ListPlus, Plus, Search, Snowflake, Sparkles, Tag as TagIcon, Trash2, UserX, Users, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { compact, relDay, since, stageColor } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { AppState } from '../lib/store.tsx';
import type { Company, Filter, Person } from '../lib/types.ts';
import { useDialogs } from '../components/dialogs.tsx';
import { Avatar, CompanyMark, Dot, ProvMark, StrengthBars } from '../components/controls.tsx';
import { Peek, RecordPage } from '../components/RecordView.tsx';
import { ColumnChooser, FilterBar, RecordTable, cell } from '../components/Table.tsx';
import type { Column, FilterField } from '../components/Table.tsx';
import { specsOf } from '../components/fields.tsx';
import { Btn, Empty, IconBtn, Menu, Modal, Spinner, input, useConfirm } from '../components/ui.tsx';

type O = 'people' | 'companies';
type Row = Person | Company;

/* ---------------------------------------------------------------- columns */

function peopleColumns(app: AppState): Column<Person>[] {
  const spec = (k: string) => specsOf(app, 'people').find((s) => s.key === k);
  const cols: Column<Person>[] = [
    {
      key: 'name',
      label: 'Name',
      width: 220,
      sortKey: 'name',
      render: (p) => (
        <>
          <Avatar name={p.name} size={20} />
          <span className="truncate font-semibold">{p.name}</span>
          <ProvMark prov={p.prov['first_name']} />
          {p.pending > 0 && <Sparkles size={11} className="shrink-0 text-[var(--cr-accent-text)]" aria-label="An AI proposal waits" />}
          {(p.agent_state === 'waiting' || p.agent_state === 'working') && <span className="cr-pulse size-1.5 shrink-0 rounded-full bg-[var(--cr-accent)]" title="AI researching" />}
        </>
      ),
    },
    { key: 'company', label: 'Company', width: 160, sortKey: 'company', spec: spec('company'), render: (p) => (p.company ? <><CompanyMark name={p.company_name} size={16} /><span className="truncate">{p.company_name}</span></> : null) },
    { key: 'title', label: 'Title', width: 160, sortKey: 'title', spec: spec('title'), render: cell(app, spec('title')!) },
    { key: 'emails', label: 'Email', width: 200, sortKey: 'email', spec: spec('emails'), render: (p) => <span className="truncate text-[var(--cr-ink-2)]">{p.email}</span> },
    { key: 'strength', label: 'Strength', width: 96, sortKey: 'strength', render: (p) => <StrengthBars value={p.strength} /> },
    { key: 'last_interaction', label: 'Last contact', width: 110, sortKey: 'last_interaction', render: (p) => <span className="text-[var(--cr-ink-2)]">{p.last_interaction ? since(p.last_interaction) : ''}</span> },
    {
      key: 'next_touch',
      label: 'Keep in touch',
      width: 120,
      sortKey: 'next_touch',
      spec: spec('keep_in_touch'),
      render: (p) => (p.keep_in_touch > 0 ? <span className={cn(p.next_touch !== '' && p.next_touch <= new Date().toISOString().slice(0, 10) ? 'font-semibold text-[var(--cr-warn-text)]' : 'text-[var(--cr-ink-2)]')}>{relDay(p.next_touch)}</span> : null),
    },
    { key: 'phones', label: 'Phone', width: 130, spec: spec('phones'), render: (p) => <span className="num truncate">{p.phones[0] ?? ''}</span> },
    { key: 'location', label: 'Location', width: 130, sortKey: 'location', spec: spec('location'), render: cell(app, spec('location')!) },
    { key: 'open_deals', label: 'Deals', width: 64, sortKey: 'open_deals', align: 'right', render: (p) => (p.open_deals > 0 ? <span className="num">{p.open_deals}</span> : null) },
    { key: 'tags', label: 'Tags', width: 160, spec: spec('tags'), render: cell(app, spec('tags')!) },
    { key: 'source', label: 'Source', width: 110, sortKey: 'source', spec: spec('source'), render: cell(app, spec('source')!) },
    { key: 'linkedin', label: 'LinkedIn', width: 150, spec: spec('linkedin'), render: cell(app, spec('linkedin')!) },
    { key: 'birthday', label: 'Birthday', width: 96, spec: spec('birthday'), render: cell(app, spec('birthday')!) },
    { key: 'created', label: 'Added', width: 96, sortKey: 'created', render: (p) => <span className="text-[var(--cr-muted)]">{since(p.created)}</span> },
  ];
  for (const f of app.fieldsOf('people')) {
    const s = specsOf(app, 'people').find((x) => x.key === 'custom.' + f.key)!;
    cols.push({ key: s.key, label: f.label, width: 130, sortKey: s.key, spec: s, render: cell(app, s) });
  }
  return cols;
}

function companyColumns(app: AppState): Column<Company>[] {
  const spec = (k: string) => specsOf(app, 'companies').find((s) => s.key === k);
  const cols: Column<Company>[] = [
    {
      key: 'name',
      label: 'Name',
      width: 220,
      sortKey: 'name',
      render: (c) => (
        <>
          <CompanyMark name={c.name} size={20} />
          <span className="truncate font-semibold">{c.name}</span>
          <ProvMark prov={c.prov['name']} />
          {c.pending > 0 && <Sparkles size={11} className="shrink-0 text-[var(--cr-accent-text)]" aria-label="An AI proposal waits" />}
          {(c.agent_state === 'waiting' || c.agent_state === 'working') && <span className="cr-pulse size-1.5 shrink-0 rounded-full bg-[var(--cr-accent)]" title="AI researching" />}
        </>
      ),
    },
    { key: 'domains', label: 'Domain', width: 150, sortKey: 'domain', spec: spec('domains'), render: (c) => <span className="truncate text-[var(--cr-ink-2)]">{c.domain}</span> },
    { key: 'industry', label: 'Industry', width: 130, sortKey: 'industry', spec: spec('industry'), render: cell(app, spec('industry')!) },
    { key: 'size', label: 'Size', width: 90, sortKey: 'size', spec: spec('size'), render: cell(app, spec('size')!) },
    { key: 'people', label: 'People', width: 70, sortKey: 'people', align: 'right', render: (c) => (c.people > 0 ? <span className="num">{c.people}</span> : null) },
    { key: 'open_deals', label: 'Open pipeline', width: 120, sortKey: 'pipeline_value', align: 'right', render: (c) => (c.open_deals > 0 ? <span className="num">{compact(c.pipeline_value, app.home)}</span> : null), footer: (rows) => <span className="num">{compact(rows.reduce((t, c) => t + c.pipeline_value, 0), app.home)}</span> },
    { key: 'strength', label: 'Strength', width: 96, sortKey: 'strength', render: (c) => <StrengthBars value={c.strength} /> },
    { key: 'last_interaction', label: 'Last contact', width: 110, sortKey: 'last_interaction', render: (c) => <span className="text-[var(--cr-ink-2)]">{c.last_interaction ? since(c.last_interaction) : ''}</span> },
    { key: 'location', label: 'Location', width: 130, sortKey: 'location', spec: spec('location'), render: cell(app, spec('location')!) },
    { key: 'tags', label: 'Tags', width: 160, spec: spec('tags'), render: cell(app, spec('tags')!) },
    { key: 'source', label: 'Source', width: 110, sortKey: 'source', spec: spec('source'), render: cell(app, spec('source')!) },
    { key: 'linkedin', label: 'LinkedIn', width: 150, spec: spec('linkedin'), render: cell(app, spec('linkedin')!) },
    { key: 'created', label: 'Added', width: 96, sortKey: 'created', render: (c) => <span className="text-[var(--cr-muted)]">{since(c.created)}</span> },
  ];
  for (const f of app.fieldsOf('companies')) {
    const s = specsOf(app, 'companies').find((x) => x.key === 'custom.' + f.key)!;
    cols.push({ key: s.key, label: f.label, width: 130, sortKey: s.key, spec: s, render: cell(app, s) });
  }
  return cols;
}

const DEFAULT_COLS: Record<O, string[]> = {
  people: ['name', 'company', 'title', 'emails', 'strength', 'last_interaction', 'next_touch', 'tags'],
  companies: ['name', 'domains', 'industry', 'size', 'people', 'open_deals', 'strength', 'last_interaction'],
};

export function filterFields(app: AppState, object: O | 'deals'): FilterField[] {
  const lists = app.lists.filter((l) => l.object === object).map((l) => ({ value: l.id, label: l.name }));
  const custom = app.fieldsOf(object).map(
    (f): FilterField => ({
      key: 'custom.' + f.key,
      label: f.label,
      kind: f.type === 'number' || f.type === 'rating' ? 'number' : f.type === 'currency' ? 'money' : f.type === 'date' ? 'date' : f.type === 'select' ? 'select' : f.type === 'multi_select' ? 'select' : f.type === 'checkbox' ? 'bool' : 'text',
      options: f.type === 'select' || f.type === 'multi_select' ? f.options.map((o) => ({ value: o, label: o })) : f.type === 'checkbox' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : undefined,
    }),
  );
  if (object === 'people')
    return [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'email', label: 'Email', kind: 'text' },
      { key: 'company', label: 'Company', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'source', label: 'Source', kind: 'text' },
      { key: 'tags', label: 'Tag', kind: 'tag' },
      { key: 'strength', label: 'Strength (0-100)', kind: 'number' },
      { key: 'touches', label: 'Interactions this year', kind: 'number' },
      { key: 'last_interaction', label: 'Last contact', kind: 'date' },
      { key: 'next_touch', label: 'Next keep-in-touch', kind: 'future' },
      { key: 'birthday', label: 'Birthday', kind: 'future' },
      { key: 'open_deals', label: 'Open deals', kind: 'number' },
      { key: 'created', label: 'Added', kind: 'date' },
      ...(lists.length > 0 ? [{ key: 'in_list', label: 'List', kind: 'list' as const, options: lists }] : []),
      ...custom,
    ];
  if (object === 'companies')
    return [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'domain', label: 'Domain', kind: 'text' },
      { key: 'industry', label: 'Industry', kind: 'text' },
      { key: 'size', label: 'Size', kind: 'select', options: ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'].map((s) => ({ value: s, label: s })) },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'source', label: 'Source', kind: 'text' },
      { key: 'tags', label: 'Tag', kind: 'tag' },
      { key: 'strength', label: 'Strength (0-100)', kind: 'number' },
      { key: 'people', label: 'People', kind: 'number' },
      { key: 'open_deals', label: 'Open deals', kind: 'number' },
      { key: 'pipeline_value', label: 'Open pipeline', kind: 'money' },
      { key: 'last_interaction', label: 'Last contact', kind: 'date' },
      { key: 'created', label: 'Added', kind: 'date' },
      ...(lists.length > 0 ? [{ key: 'in_list', label: 'List', kind: 'list' as const, options: lists }] : []),
      ...custom,
    ];
  const stages = [...new Set(app.pipelines.flatMap((p) => p.stages.map((s) => s.name)))].map((n) => ({ value: n, label: n }));
  return [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'company', label: 'Company', kind: 'text' },
    { key: 'people', label: 'Person', kind: 'text' },
    { key: 'stage', label: 'Stage', kind: 'select', options: stages },
    { key: 'status', label: 'Status', kind: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] },
    { key: 'home_value', label: 'Value', kind: 'money' },
    { key: 'probability', label: 'Probability', kind: 'number' },
    { key: 'expected_close', label: 'Expected close', kind: 'future' },
    { key: 'closed_at', label: 'Closed', kind: 'date' },
    { key: 'next_step_date', label: 'Next step date', kind: 'future' },
    { key: 'days_in_stage', label: 'Days in stage', kind: 'number' },
    { key: 'idle_days', label: 'Days without activity', kind: 'number' },
    { key: 'rotting', label: 'Rotting', kind: 'bool', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
    { key: 'source', label: 'Source', kind: 'text' },
    { key: 'tags', label: 'Tag', kind: 'tag' },
    { key: 'created', label: 'Added', kind: 'date' },
    ...custom,
  ];
}

/* ---------------------------------------------------------------- sidebar */

const PRESETS: Record<O, { id: string; label: string; icon: LucideIcon }[]> = {
  people: [
    { id: 'keep_in_touch', label: 'Keep in touch due', icon: Clock },
    { id: 'recent', label: 'Recently added', icon: Plus },
    { id: 'strong', label: 'Strong relationships', icon: Flame },
    { id: 'cold', label: 'Going cold', icon: Snowflake },
    { id: 'birthdays', label: 'Birthdays soon', icon: Cake },
    { id: 'no_company', label: 'No company', icon: UserX },
  ],
  companies: [
    { id: 'with_deals', label: 'With open deals', icon: Flame },
    { id: 'recent', label: 'Recently added', icon: Plus },
    { id: 'cold', label: 'Going cold', icon: Snowflake },
  ],
};

function SideItem({ icon: Icon, label, active, onClick, count, color }: { icon?: LucideIcon | undefined; label: string; active: boolean; onClick: () => void; count?: number | undefined; color?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined} className={cn('relative flex h-7 w-full items-center gap-2 px-3 text-left text-[12.5px] transition-colors', active ? 'bg-[var(--cr-row-hover)] font-semibold' : 'hover:bg-[var(--cr-row)]')}>
      {active && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 bg-[var(--cr-accent)]" />}
      {color !== undefined ? <Dot color={color} /> : Icon !== undefined ? <Icon size={14} className={active ? 'text-[var(--cr-ink)]' : 'text-[var(--cr-muted)]'} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && <span className="num text-[11px] text-[var(--cr-muted)]">{count}</span>}
    </button>
  );
}

function Sidebar({ object, q, total }: { object: O; q: Record<string, string>; total: number | undefined }): React.JSX.Element {
  const app = useApp();
  const [newList, setNewList] = useState(false);
  const [name, setName] = useState('');
  const lists = app.lists.filter((l) => l.object === object);
  const views = app.views.filter((v) => v.object === object);
  const pick = (p: Record<string, string | undefined>): void => setQuery({ preset: undefined, list: undefined, view: undefined, peek: undefined, ...p }, true);
  const none = !q['preset'] && !q['list'] && !q['view'];
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[var(--cr-line)] py-1.5 lg:flex">
      <SideItem icon={object === 'people' ? Users : Building2} label={object === 'people' ? 'All people' : 'All companies'} active={none} onClick={() => pick({})} count={none ? total : undefined} />
      {PRESETS[object].map((p) => (
        <SideItem key={p.id} icon={p.icon} label={p.label} active={q['preset'] === p.id} onClick={() => pick({ preset: p.id })} count={p.id === 'keep_in_touch' ? app.summary?.keep_in_touch : undefined} />
      ))}
      <p className="mt-3 flex items-center px-3 pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">
        <span className="flex-1">Lists</span>
        <IconBtn icon={Plus} label="New list" size={20} onClick={() => setNewList(true)} />
      </p>
      {lists.map((l) => (
        <SideItem key={l.id} label={l.name} color={stageColor(l.color)} active={q['list'] === l.id} onClick={() => pick({ list: l.id })} count={l.count} />
      ))}
      {lists.length === 0 && <p className="px-3 py-1 text-[11.5px] text-[var(--cr-muted)]">Group {object} for a process: investors, community, targets.</p>}
      {views.length > 0 && (
        <>
          <p className="mt-3 px-3 pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">Saved views</p>
          {views.map((v) => (
            <SideItem key={v.id} icon={Bookmark} label={v.name} active={q['view'] === v.id} onClick={() => pick({ view: v.id })} />
          ))}
        </>
      )}
      <span className="flex-1" />
      <div className="mt-3 border-t border-[var(--cr-hair)] pt-1.5">
        <SideItem icon={Copy} label="Duplicates" active={false} onClick={() => go('setup', { tab: 'duplicates', object })} />
        <SideItem icon={Trash2} label="Trash" active={false} onClick={() => go('setup', { tab: 'trash' })} />
      </div>
      {newList && (
        <Modal
          open
          width="sm"
          onClose={() => setNewList(false)}
          title="New list"
          footer={
            <>
              <Btn onClick={() => setNewList(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() =>
                  void api
                    .createList({ name, object })
                    .then((r) => {
                      setNewList(false);
                      setName('');
                      pick({ list: r.list.id });
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Create
              </Btn>
            </>
          }
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={object === 'people' ? 'Investors, Community, Advisors ...' : 'Targets, Partners ...'} className={input} />
        </Modal>
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------- the list */

function useColumns(object: O, all: string[]): [string[], (v: string[]) => void] {
  const key = 'cr_cols_' + object;
  const [cols, setCols] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null') as string[] | null;
      if (Array.isArray(v) && v.length > 0) return v;
    } catch {
      /* first visit */
    }
    return DEFAULT_COLS[object];
  });
  const set = useCallback(
    (v: string[]) => {
      setCols(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [cols.filter((c) => all.includes(c) || c === 'name'), set];
}

function ListView({ object, q }: { object: O; q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const dlg = useDialogs();
  const [confirmEl, confirm] = useConfirm();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [sort, setSort] = useState(object === 'people' ? 'last_interaction' : 'name');
  const [dir, setDir] = useState<'asc' | 'desc'>(object === 'people' ? 'desc' : 'asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState('');
  const [saveAs, setSaveAs] = useState(false);
  const [viewName, setViewName] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const view = app.views.find((v) => v.id === q['view']);
  // A saved view brings its filters, sort and columns.
  useEffect(() => {
    if (view) {
      setFilters(view.filters);
      setMatch(view.match);
      if (view.sort) setSort(view.sort);
      setDir(view.dir);
    } else setFilters([]);
    setSelected(new Set());
  }, [view, q['preset'], q['list']]);
  const columnsAll = useMemo(() => (object === 'people' ? (peopleColumns(app) as Column<Row>[]) : (companyColumns(app) as Column<Row>[])), [object, app]);
  const [visible, setVisible] = useColumns(object, columnsAll.map((c) => c.key));
  const shownCols = view && view.columns.length > 0 ? columnsAll.filter((c) => c.key === 'name' || view.columns.includes(c.key)) : columnsAll.filter((c) => c.key === 'name' || visible.includes(c.key));
  const live = useLive(
    () => (object === 'people' ? api.people({ q: search, preset: q['preset'], list: q['list'], filters, match, sort, dir, limit: 1000 }).then((r) => ({ rows: r.people as Row[], total: r.total })) : api.companies({ q: search, preset: q['preset'], list: q['list'], filters, match, sort, dir, limit: 1000 }).then((r) => ({ rows: r.companies as Row[], total: r.total }))),
    [object, 'interactions', 'deals', 'list_entries', 'proposals', 'fields', ...(object === 'people' ? (['companies'] as const) : (['people'] as const))],
    [object, search, q['preset'], q['list'], JSON.stringify(filters), match, sort, dir],
    250,
  );
  const rows = live.data?.rows ?? [];
  const peek = q['peek'] ?? '';
  useReportScreen(object, peek ? { type: object, id: peek } : null, { preset: q['preset'], list: q['list'], filters, q: search });
  const title = view?.name ?? (q['list'] ? (app.lists.find((l) => l.id === q['list'])?.name ?? 'List') : q['preset'] ? (PRESETS[object].find((p) => p.id === q['preset'])?.label ?? '') : object === 'people' ? 'All people' : 'All companies');
  const open = (id: string, page: boolean): void => {
    setActive(id);
    if (page) go(object, { id });
    else setQuery({ peek: id });
  };
  // Keys: J/K move, Enter opens, X selects, / searches.
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') !== null) return;
      const i = rows.findIndex((r) => r.id === active);
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, e.key === 'j' ? i + 1 : i - 1))];
        if (next) {
          setActive(next.id);
          if (peek) setQuery({ peek: next.id });
          document.querySelector(`[data-row="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        open(active, e.shiftKey);
      } else if (e.key === 'x' && active) {
        e.preventDefault();
        const n = new Set(selected);
        if (n.has(active)) n.delete(active);
        else n.add(active);
        setSelected(n);
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  const ids = [...selected];
  const bulk = (action: string, extra: Record<string, unknown> = {}): void => {
    void api
      .bulk(object, { ids, action, ...extra })
      .then((r) => {
        toast.success(action === 'research' ? 'Sent ' + (r.queued ?? 0) + ' to your AI agent to research' : 'Done' + (r.changed !== undefined ? ': ' + r.changed : ''));
        if (action === 'delete') setSelected(new Set());
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const exportCsv = (): void => {
    void api
      .exportCsv(object, { q: search, preset: q['preset'], list: q['list'], filters, match })
      .then((r) => {
        const blob = new Blob([r.csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = r.filename;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const lists = app.lists.filter((l) => l.object === object);
  return (
    <div className="flex h-full min-h-0">
      {confirmEl}
      <Sidebar object={object} q={q} total={live.data?.total} />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--cr-line)] px-3 py-1.5">
          <h2 className="flex items-center gap-2 text-[13px] font-bold">
            {title}
            <span className="num text-[12px] font-normal text-[var(--cr-muted)]">{live.data?.total ?? ''}</span>
          </h2>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--cr-muted)]" />
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className={cn(input, 'h-7 w-44 pl-7')} />
          </div>
          <FilterBar fields={filterFields(app, object)} filters={filters} match={match} home={app.home} onChange={setFilters} onMatch={setMatch} />
          <span className="flex-1" />
          {(filters.length > 0 || view) && (
            <Btn size="sm" variant="ghost" icon={Bookmark} onClick={() => (view ? void api.saveView({ view: view.id, filters, match, sort, dir }).then(() => toast.success('View saved')) : setSaveAs(true))}>
              {view ? 'Update view' : 'Save view'}
            </Btn>
          )}
          <ColumnChooser all={columnsAll} visible={shownCols.map((c) => c.key)} onChange={setVisible} />
          <IconBtn icon={FileUp} label="Import from CSV" onClick={() => dlg.openImport(object)} />
          <IconBtn icon={Download} label="Export as CSV" onClick={exportCsv} />
          <Btn size="sm" variant="primary" icon={Plus} onClick={() => dlg.openNew(object === 'people' ? 'person' : 'company', q['list'] ? { list: q['list'] } : {})}>
            {object === 'people' ? 'Person' : 'Company'}
          </Btn>
        </div>
        {selected.size > 0 && (
          <div className="cr-fade flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--cr-line)] bg-[var(--cr-accent-soft)] px-3 text-[12.5px]">
            <span className="mr-1 font-semibold">{selected.size} selected</span>
            <Btn size="xs" icon={TagIcon} onClick={() => setTagOpen(true)}>
              Tag
            </Btn>
            {lists.length > 0 && (
              <Menu align="left" trigger={(_, t) => <Btn size="xs" icon={ListPlus} onClick={t}>Add to list</Btn>} items={lists.map((l) => ({ label: l.name, swatch: stageColor(l.color), onClick: () => bulk('add_to_list', { list: l.id }) }))} />
            )}
            {q['list'] && (
              <Btn size="xs" onClick={() => bulk('remove_from_list', { list: q['list'] })}>
                Remove from list
              </Btn>
            )}
            <Btn size="xs" icon={Sparkles} className="text-[var(--cr-accent-text)]" onClick={() => bulk('research')}>
              Research with AI
            </Btn>
            {selected.size === 2 && (
              <Btn
                size="xs"
                icon={Users}
                onClick={() =>
                  void confirm('The first one stays and keeps its values; the second is merged into it and goes to the trash. You can undo it.', 'Merge these two?', 'Merge').then((ok) => {
                    if (!ok) return;
                    const [a, b] = ids;
                    void api
                      .merge(object, a!, b!)
                      .then(() => {
                        toast.success('Merged (Ctrl+Z to undo)');
                        setSelected(new Set());
                      })
                      .catch((err: unknown) => toast.error(errMessage(err)));
                  })
                }
              >
                Merge
              </Btn>
            )}
            <Btn size="xs" variant="danger" icon={Trash2} onClick={() => void confirm(selected.size + ' ' + object + ' go to the trash; you can restore them for 90 days.', 'Move to the trash?', 'Move to trash').then((ok) => ok && bulk('delete'))}>
              Delete
            </Btn>
            <span className="flex-1" />
            <IconBtn icon={X} label="Clear the selection" onClick={() => setSelected(new Set())} />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {live.data === null ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <RecordTable
              object={object}
              app={app}
              rows={rows}
              columns={shownCols}
              selected={selected}
              onSelect={setSelected}
              activeId={peek || active}
              onActivate={open}
              sort={sort}
              dir={dir}
              onSort={(k) => {
                if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
                else {
                  setSort(k);
                  setDir(k === 'name' || k === 'company' || k === 'title' || k === 'next_touch' ? 'asc' : 'desc');
                }
              }}
              empty={
                <Empty
                  icon={object === 'people' ? Users : Building2}
                  title={search || filters.length > 0 ? 'Nothing matches' : q['preset'] === 'keep_in_touch' ? 'Nobody is due' : object === 'people' ? 'No people yet' : 'No companies yet'}
                  action={
                    !search && filters.length === 0 && !q['preset'] ? (
                      <div className="flex gap-2">
                        <Btn variant="primary" icon={Plus} onClick={() => dlg.openNew(object === 'people' ? 'person' : 'company')}>
                          Add {object === 'people' ? 'a person' : 'a company'}
                        </Btn>
                        <Btn icon={FileUp} onClick={() => dlg.openImport(object)}>
                          Import CSV
                        </Btn>
                      </div>
                    ) : undefined
                  }
                >
                  {search || filters.length > 0 ? 'Try fewer filters.' : q['preset'] === 'keep_in_touch' ? 'Set a keep-in-touch cadence on the people who matter and they show here when it is time.' : 'Add people as you meet them, import a CSV, or ask your AI agent to fill the CRM from your email and calendar.'}
                </Empty>
              }
            />
          )}
        </div>
      </section>
      {peek !== '' && <Peek object={object} id={peek} onClose={() => setQuery({ peek: undefined })} />}
      {saveAs && (
        <Modal
          open
          width="sm"
          onClose={() => setSaveAs(false)}
          title="Save this view"
          description="Its filters, sort and columns, in the sidebar."
          footer={
            <>
              <Btn onClick={() => setSaveAs(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() =>
                  void api
                    .saveView({ object, name: viewName, filters, match, sort, dir, columns: shownCols.map((c) => c.key) })
                    .then((r) => {
                      setSaveAs(false);
                      setViewName('');
                      setQuery({ view: r.view.id, preset: undefined, list: undefined });
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Save
              </Btn>
            </>
          }
        >
          <input autoFocus value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Warm intros in London" className={input} />
        </Modal>
      )}
      {tagOpen && (
        <Modal
          open
          width="sm"
          onClose={() => setTagOpen(false)}
          title={'Tag ' + selected.size + ' ' + object}
          footer={
            <>
              <Btn onClick={() => setTagOpen(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setTagOpen(false);
                  bulk('tag', { tag });
                  setTag('');
                }}
              >
                Tag
              </Btn>
            </>
          }
        >
          <input autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder="vip, investor, warm" className={input} />
        </Modal>
      )}
    </div>
  );
}

export function RecordsView({ object, q }: { object: O; q: Record<string, string> }): React.JSX.Element {
  if (q['id']) return <RecordPage object={object} id={q['id']} />;
  return <ListView object={object} q={q} />;
}

