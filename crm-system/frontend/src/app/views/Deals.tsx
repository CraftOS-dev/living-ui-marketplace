/**
 * Deals: a pipeline at a time, as a board or a table.
 *
 * The board has a column per open stage (color, count, total and weighted
 * value); cards show the company, value, expected close, the next activity
 * (overdue red, today green, none amber), days in stage (red past the
 * stage's target) and a rotting edge when nothing happened for longer than
 * the stage allows. Cards drag between stages and onto the Won and Lost
 * zones at the bottom. #/deals?id=.. opens a deal's page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, Clock, Kanban, Plus, Rows3, Search, Settings2, Sparkles, Trophy, XCircle } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { PIPELINE_KIND_LABEL, compact, money, relDay, stageColor, since } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { AppState } from '../lib/store.tsx';
import type { Deal, Filter, Pipeline } from '../lib/types.ts';
import { useDialogs } from '../components/dialogs.tsx';
import { Avatar, CompanyMark, Dot, ProvMark } from '../components/controls.tsx';
import { Peek, RecordPage } from '../components/RecordView.tsx';
import { FilterBar, RecordTable, cell } from '../components/Table.tsx';
import type { Column } from '../components/Table.tsx';
import { specsOf } from '../components/fields.tsx';
import { filterFields } from './Records.tsx';
import { Btn, Empty, IconBtn, Modal, Seg, Spinner, input } from '../components/ui.tsx';

const NEXT_STYLE: Record<string, { color: string; label: string }> = {
  overdue: { color: 'var(--cr-neg)', label: 'Next activity overdue' },
  today: { color: 'var(--cr-pos)', label: 'Next activity today' },
  future: { color: 'var(--cr-muted)', label: 'Next activity planned' },
  none: { color: 'var(--cr-warn)', label: 'No next activity' },
};

function Card({ d, home, active, onOpen, dragging, onDragStart, onDragEnd }: { d: Deal; home: string; active: boolean; onOpen: (page: boolean) => void; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }): React.JSX.Element {
  const ns = NEXT_STYLE[d.next_state] ?? NEXT_STYLE['none']!;
  const overdueClose = d.expected_close !== '' && d.expected_close < new Date().toISOString().slice(0, 10);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      data-deal={d.id}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal', d.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => onOpen(e.ctrlKey || e.metaKey)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(false)}
      className={cn(
        'group relative cursor-grab select-none rounded-[7px] border bg-[var(--cr-card)] px-2.5 py-2 text-[12.5px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,opacity] hover:border-[var(--cr-ink-2)] active:cursor-grabbing',
        active ? 'border-[var(--cr-accent)] shadow-[0_0_0_1px_var(--cr-accent)]' : 'border-[var(--cr-line)]',
        dragging && 'cr-dragging',
      )}
    >
      {d.rotting && <span aria-hidden className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r bg-[var(--cr-neg)]" title={'Rotting: nothing for ' + d.idle_days + ' days'} />}
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 font-semibold leading-[17px]">{d.name}</p>
        {d.pending > 0 && <Sparkles size={12} className="mt-0.5 shrink-0 text-[var(--cr-accent-text)]" aria-label="An AI proposal waits" />}
        <ProvMark prov={d.prov['name']} />
      </div>
      {d.company_name && (
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--cr-ink-2)]">
          <CompanyMark name={d.company_name} size={14} />
          <span className="truncate">{d.company_name}</span>
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[11.5px]">
        <span className="num font-semibold" title={money(d.value, d.currency)}>
          {compact(d.value, d.currency)}
        </span>
        {d.expected_close && (
          <span className={cn('inline-flex items-center gap-0.5', overdueClose ? 'font-semibold text-[var(--cr-neg-text)]' : 'text-[var(--cr-muted)]')} title={'Expected close ' + d.expected_close}>
            <CalendarClock size={11} /> {relDay(d.expected_close)}
          </span>
        )}
        <span className="flex-1" />
        <span className={cn('num inline-flex items-center gap-0.5', d.over_target ? 'font-semibold text-[var(--cr-neg-text)]' : 'text-[var(--cr-muted)]')} title={d.days_in_stage + ' days in this stage' + (d.target_days ? ' (target ' + d.target_days + ')' : '')}>
          <Clock size={11} /> {d.days_in_stage}d
        </span>
        <span aria-label={ns.label} title={ns.label + (d.next_task ? ': ' + d.next_task.title : '')} className="inline-block size-2 shrink-0 rounded-full" style={{ background: ns.color }} />
      </div>
      {d.people.length > 0 && (
        <div className="mt-1.5 flex items-center -space-x-1">
          {d.people.slice(0, 4).map((p) => (
            <span key={p.id} title={p.name + (p.role ? ' · ' + p.role : '')} className="rounded-full ring-2 ring-[var(--cr-card)]">
              <Avatar name={p.name} size={18} />
            </span>
          ))}
          {d.people.length > 4 && <span className="pl-2 text-[11px] text-[var(--cr-muted)]">+{d.people.length - 4}</span>}
        </div>
      )}
    </div>
  );
}

function Board({ pipeline, deals, active, onOpen, home }: { pipeline: Pipeline; deals: Deal[]; active: string; onOpen: (id: string, page: boolean) => void; home: string }): React.JSX.Element {
  const dlg = useDialogs();
  const [drag, setDrag] = useState('');
  const [over, setOver] = useState<{ stage: string; before: string } | null>(null);
  const [lost, setLost] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const open = pipeline.stages.filter((s) => s.kind === 'open');
  const byStage = useMemo(() => {
    const m = new Map<string, Deal[]>();
    for (const s of open) m.set(s.id, []);
    for (const d of deals) if (d.status === 'open') m.get(d.stage)?.push(d);
    for (const l of m.values()) l.sort((a, b) => a.position - b.position);
    return m;
  }, [deals, open]);
  const drop = (stage: string, before: string): void => {
    const id = drag;
    setDrag('');
    setOver(null);
    if (!id) return;
    const d = deals.find((x) => x.id === id);
    if (!d) return;
    if (d.stage === stage && before === '') return;
    api
      .move(id, stage, before || undefined)
      .then((r) => r.proposed && toast.success('Sent for review'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const outcome = (kind: 'won' | 'lost'): void => {
    const id = drag;
    setDrag('');
    setOver(null);
    const d = deals.find((x) => x.id === id);
    if (!d) return;
    if (kind === 'lost') return setLost({ id, name: d.name });
    api
      .close(id, 'won')
      .then(() => toast.success('Won: ' + d.name))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const beforeAt = (e: React.DragEvent, stage: string): string => {
    const cards = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-deal]')];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2 && c.dataset['deal'] !== drag) return c.dataset['deal'] ?? '';
    }
    void stage;
    return '';
  };
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 gap-2.5 overflow-x-auto p-3">
        {open.map((s) => {
          const list = byStage.get(s.id) ?? [];
          const total = list.reduce((t, d) => t + (d.home_value ?? 0), 0);
          const weighted = list.reduce((t, d) => t + (d.weighted ?? 0), 0);
          const isOver = over?.stage === s.id;
          return (
            <section
              key={s.id}
              aria-label={s.name}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const b = beforeAt(e, s.id);
                if (over?.stage !== s.id || over.before !== b) setOver({ stage: s.id, before: b });
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(s.id, over?.before ?? '');
              }}
              className={cn('flex w-[272px] min-w-[272px] flex-col rounded-[8px] bg-[var(--cr-row)] transition-colors', isOver && 'bg-[var(--cr-row-hover)] shadow-[inset_0_0_0_1px_var(--cr-line)]')}
            >
              <header className="px-2.5 pb-1.5 pt-2">
                <div className="flex items-center gap-1.5">
                  <Dot color={stageColor(s.color)} />
                  <span className="truncate text-[12.5px] font-bold">{s.name}</span>
                  <span className="num text-[11.5px] text-[var(--cr-muted)]">{list.length}</span>
                  <span className="flex-1" />
                  <IconBtn icon={Plus} label={'New deal in ' + s.name} size={22} onClick={() => dlg.openNew('deal', { pipeline: pipeline.id, stage: s.id })} />
                </div>
                <p className="num mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[var(--cr-ink-2)]" title={'Total ' + money(total, home) + ' · weighted at ' + s.probability + '%'}>
                  <span className="font-semibold">{compact(total, home)}</span>
                  <span className="text-[var(--cr-muted)]">
                    · {compact(weighted, home)} at {s.probability}%
                  </span>
                </p>
                <span aria-hidden className="mt-1.5 block h-[3px] rounded-full" style={{ background: stageColor(s.color), opacity: 0.85 }} />
              </header>
              <div className="flex min-h-[60px] flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-2">
                {list.map((d) => (
                  <div key={d.id} className={cn(isOver && over?.before === d.id && 'cr-drop-before rounded-[7px]')}>
                    <Card d={d} home={home} active={d.id === active} onOpen={(page) => onOpen(d.id, page)} dragging={drag === d.id} onDragStart={() => setDrag(d.id)} onDragEnd={() => (setDrag(''), setOver(null))} />
                  </div>
                ))}
                {list.length === 0 && <p className="px-1 py-3 text-center text-[11.5px] text-[var(--cr-muted)]">Drop a deal here</p>}
              </div>
            </section>
          );
        })}
      </div>
      {drag !== '' && (
        <div className="cr-pop absolute inset-x-3 bottom-3 grid grid-cols-2 gap-2.5">
          {(['won', 'lost'] as const).map((k) => (
            <div
              key={k}
              onDragOver={(e) => {
                e.preventDefault();
                setOver({ stage: k, before: '' });
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                outcome(k);
              }}
              className={cn('flex h-14 items-center justify-center gap-2 rounded-[8px] border-2 border-dashed text-[13px] font-bold transition-colors', k === 'won' ? 'border-[var(--cr-pos)] text-[var(--cr-pos-text)]' : 'border-[var(--cr-neg)] text-[var(--cr-neg-text)]', over?.stage === k ? (k === 'won' ? 'bg-[var(--cr-pos-soft)]' : 'bg-[var(--cr-neg-soft)]') : 'bg-[var(--cr-card)]')}
            >
              {k === 'won' ? <Trophy size={16} /> : <XCircle size={16} />} {k === 'won' ? 'Won' : 'Lost'}
            </div>
          ))}
        </div>
      )}
      {lost && (
        <Modal
          open
          width="sm"
          onClose={() => setLost(null)}
          title={'Mark ' + lost.name + ' lost'}
          footer={
            <>
              <Btn onClick={() => setLost(null)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  const id = lost.id;
                  setLost(null);
                  void api
                    .close(id, 'lost', reason)
                    .then(() => toast.success('Marked lost'))
                    .catch((err: unknown) => toast.error(errMessage(err)));
                  setReason('');
                }}
              >
                Mark lost
              </Btn>
            </>
          }
        >
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-[11.5px] font-semibold text-[var(--cr-ink-2)]">Why was it lost?</span>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={input} placeholder="Went with a competitor, no budget, timing ..." />
          </label>
        </Modal>
      )}
    </div>
  );
}

function dealColumns(app: AppState): Column<Deal>[] {
  const spec = (k: string) => specsOf(app, 'deals').find((s) => s.key === k);
  const cols: Column<Deal>[] = [
    {
      key: 'name',
      label: 'Deal',
      width: 230,
      sortKey: 'name',
      render: (d) => (
        <>
          {d.rotting && <AlertTriangle size={12} className="shrink-0 text-[var(--cr-neg-text)]" aria-label="Rotting" />}
          <span className="truncate font-semibold">{d.name}</span>
          {d.pending > 0 && <Sparkles size={11} className="shrink-0 text-[var(--cr-accent-text)]" />}
        </>
      ),
    },
    { key: 'company', label: 'Company', width: 150, sortKey: 'company', spec: spec('company'), render: (d) => (d.company ? <><CompanyMark name={d.company_name} size={16} /><span className="truncate">{d.company_name}</span></> : null) },
    { key: 'stage', label: 'Stage', width: 140, sortKey: 'stage', render: (d) => <><Dot color={stageColor(d.stage_color, d.stage_kind)} /><span className="truncate">{d.stage_name}</span></> },
    { key: 'value', label: 'Value', width: 110, sortKey: 'home_value', align: 'right', spec: spec('value'), render: (d) => <span className="num">{money(d.value, d.currency)}</span>, footer: (rows) => <span className="num">{compact(rows.reduce((t, d) => t + (d.home_value ?? 0), 0), app.home)}</span> },
    { key: 'probability', label: 'Prob.', width: 64, sortKey: 'probability', align: 'right', spec: spec('probability'), render: (d) => <span className="num">{d.probability}%</span> },
    { key: 'weighted', label: 'Weighted', width: 100, sortKey: 'weighted', align: 'right', render: (d) => <span className="num text-[var(--cr-ink-2)]">{d.weighted === null ? '–' : compact(d.weighted, app.home)}</span>, footer: (rows) => <span className="num">{compact(rows.reduce((t, d) => t + (d.weighted ?? 0), 0), app.home)}</span> },
    { key: 'expected_close', label: 'Close', width: 100, sortKey: 'expected_close', spec: spec('expected_close'), render: (d) => (d.expected_close ? <span className={cn(d.status === 'open' && d.expected_close < new Date().toISOString().slice(0, 10) && 'font-semibold text-[var(--cr-neg-text)]')}>{relDay(d.expected_close)}</span> : null) },
    { key: 'next_step', label: 'Next step', width: 180, spec: spec('next_step'), render: (d) => <><span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: (NEXT_STYLE[d.next_state] ?? NEXT_STYLE['none']!).color }} /><span className="truncate">{d.next_task?.title ?? d.next_step}</span></> },
    { key: 'people', label: 'People', width: 140, render: (d) => <span className="truncate text-[var(--cr-ink-2)]">{d.people.map((p) => p.name).join(', ')}</span> },
    { key: 'days_in_stage', label: 'In stage', width: 76, sortKey: 'days_in_stage', align: 'right', render: (d) => <span className={cn('num', d.over_target && 'font-semibold text-[var(--cr-neg-text)]')}>{d.days_in_stage}d</span> },
    { key: 'last_activity', label: 'Last activity', width: 110, sortKey: 'last_activity', render: (d) => <span className={cn(d.rotting ? 'font-semibold text-[var(--cr-neg-text)]' : 'text-[var(--cr-ink-2)]')}>{since(d.last_activity)}</span> },
    { key: 'source', label: 'Source', width: 110, sortKey: 'source', spec: spec('source'), render: cell(app, spec('source')!) },
    { key: 'tags', label: 'Tags', width: 140, spec: spec('tags'), render: cell(app, spec('tags')!) },
  ];
  for (const f of app.fieldsOf('deals')) {
    const s = specsOf(app, 'deals').find((x) => x.key === 'custom.' + f.key)!;
    cols.push({ key: s.key, label: f.label, width: 130, sortKey: s.key, spec: s, render: cell(app, s) });
  }
  return cols;
}

const DEAL_PRESETS = [
  { id: '', label: 'Open deals' },
  { id: 'rotting', label: 'Rotting' },
  { id: 'no_next_step', label: 'No next step' },
  { id: 'closing', label: 'Closing in 30 days' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

function DealsList({ q }: { q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const dlg = useDialogs();
  const pipeline = app.pipeline(q['pipeline']) ?? app.pipelines[0];
  const mode = q['mode'] === 'table' ? 'table' : 'board';
  const preset = q['preset'] ?? '';
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [sort, setSort] = useState('expected_close');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const live = useLive(
    () => api.deals({ pipeline: pipeline?.id, q: search, preset: mode === 'board' ? 'open' : preset || 'open', filters, match, sort: mode === 'board' ? 'position' : sort, dir: mode === 'board' ? 'asc' : dir, limit: 2000 }),
    ['deals', 'deal_people', 'tasks', 'stages', 'proposals', 'interactions', 'notes', 'companies', 'fx_rates'],
    [pipeline?.id, search, preset, mode, JSON.stringify(filters), match, sort, dir],
    250,
  );
  const peek = q['peek'] ?? '';
  useReportScreen('deals', peek ? { type: 'deals', id: peek } : null, { pipeline: pipeline?.id, mode, preset });
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  if (pipeline === undefined)
    return (
      <Empty icon={Kanban} title="No pipeline yet" action={<Btn variant="primary" onClick={() => go('setup', { tab: 'pipelines' })}>Set up a pipeline</Btn>}>
        Pipelines hold your deals by stage: sales, fundraising, hiring, partnerships.
      </Empty>
    );
  const deals = live.data?.deals ?? [];
  const totals = { open: deals.filter((d) => d.status === 'open').reduce((t, d) => t + (d.home_value ?? 0), 0), weighted: deals.filter((d) => d.status === 'open').reduce((t, d) => t + (d.weighted ?? 0), 0) };
  const open = (id: string, page: boolean): void => (page ? go('deals', { id }) : setQuery({ peek: id }));
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[var(--cr-line)] py-1.5 lg:flex">
        <p className="px-3 pb-0.5 pt-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">Pipelines</p>
        {app.pipelines.map((p) => (
          <button key={p.id} type="button" onClick={() => setQuery({ pipeline: p.id, peek: undefined }, true)} aria-current={p.id === pipeline.id ? 'true' : undefined} className={cn('relative flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] transition-colors', p.id === pipeline.id ? 'bg-[var(--cr-row-hover)] font-semibold' : 'hover:bg-[var(--cr-row)]')}>
            {p.id === pipeline.id && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[var(--cr-accent)]" />}
            <Kanban size={14} className={p.id === pipeline.id ? '' : 'text-[var(--cr-muted)]'} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="num text-[11px] text-[var(--cr-muted)]">{p.open_deals}</span>
          </button>
        ))}
        <button type="button" onClick={() => go('setup', { tab: 'pipelines' })} className="flex h-7 items-center gap-2 px-3 text-left text-[12px] text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">
          <Settings2 size={13} /> Edit pipelines
        </button>
        {mode === 'table' && (
          <>
            <p className="mt-3 px-3 pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">Show</p>
            {DEAL_PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => setQuery({ preset: p.id || undefined })} className={cn('flex h-7 w-full items-center px-3 text-left text-[12.5px] transition-colors', preset === p.id ? 'bg-[var(--cr-row-hover)] font-semibold' : 'hover:bg-[var(--cr-row)]')}>
                {p.label}
              </button>
            ))}
          </>
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--cr-line)] px-3 py-1.5">
          <h2 className="flex items-center gap-2 text-[13px] font-bold">
            {pipeline.name}
            {(PIPELINE_KIND_LABEL[pipeline.kind] ?? '').toLowerCase() !== pipeline.name.toLowerCase() && <span className="hidden text-[12px] font-normal text-[var(--cr-muted)] sm:inline">{PIPELINE_KIND_LABEL[pipeline.kind]}</span>}
          </h2>
          <span className="num hidden text-[12px] text-[var(--cr-ink-2)] md:inline" title="Open value and weighted value (value x probability)">
            {compact(totals.open, app.home)} open · {compact(totals.weighted, app.home)} weighted
            {pipeline.target > 0 && ' · target ' + compact(pipeline.target, pipeline.currency)}
          </span>
          <Seg
            value={mode}
            onChange={(v) => setQuery({ mode: v === 'board' ? undefined : v, preset: undefined })}
            options={[
              { value: 'board', label: <Kanban size={13} />, title: 'Board' },
              { value: 'table', label: <Rows3 size={13} />, title: 'Table' },
            ]}
          />
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--cr-muted)]" />
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className={cn(input, 'h-7 w-40 pl-7')} />
          </div>
          <FilterBar fields={filterFields(app, 'deals')} filters={filters} match={match} home={app.home} onChange={setFilters} onMatch={setMatch} />
          <span className="flex-1" />
          <Btn size="sm" variant="primary" icon={Plus} onClick={() => dlg.openNew('deal', { pipeline: pipeline.id })}>
            Deal
          </Btn>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {live.data === null ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : mode === 'board' ? (
            <Board pipeline={pipeline} deals={deals} active={peek} onOpen={open} home={app.home} />
          ) : (
            <RecordTable
              object="deals"
              app={app}
              rows={deals}
              columns={dealColumns(app)}
              selected={selected}
              onSelect={setSelected}
              activeId={peek}
              onActivate={open}
              sort={sort}
              dir={dir}
              onSort={(k) => {
                if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
                else {
                  setSort(k);
                  setDir(k === 'name' || k === 'expected_close' ? 'asc' : 'desc');
                }
              }}
              empty={
                <Empty icon={Kanban} title="No deals here" action={<Btn variant="primary" icon={Plus} onClick={() => dlg.openNew('deal', { pipeline: pipeline.id })}>New deal</Btn>}>
                  {search || filters.length > 0 ? 'Try fewer filters.' : 'Deals you add to this pipeline show here.'}
                </Empty>
              }
            />
          )}
        </div>
      </section>
      {peek !== '' && <Peek object="deals" id={peek} onClose={() => setQuery({ peek: undefined })} />}
    </div>
  );
}

export function DealsView({ q }: { q: Record<string, string> }): React.JSX.Element {
  if (q['id']) return <RecordPage object="deals" id={q['id']} />;
  return <DealsList q={q} />;
}
