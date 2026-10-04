/**
 * Deadlines: every open date on the docket, as a grouped list, a month
 * calendar or a table with bulk actions. Filters live in the address so a
 * view can be bookmarked or shared. "#/deadlines/<id>" opens the "Why this
 * date?" panel for one deadline (links from notifications and the feed).
 */
import { useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import { CalendarClock, CalendarPlus, Plus } from 'lucide-react';
import { Button, Input, Select, toast, useAuth } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { getRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, d10, daysUntil, deadlineSeverity, fmtDate, toPb, today } from '../lib/format.ts';
import {
  CATEGORY_LABEL,
  DEADLINE_STATUS_LABEL,
  IP_TYPE_LABEL,
  KIND_LABEL,
  SOURCE_LABEL,
  jurisdictionName,
} from '../lib/labels.ts';
import { parseHash, useHashParam, useRoute } from '../lib/router.ts';
import type { Category, DeadlineKind, DeadlineRec, IpType } from '../lib/types.ts';
import { CalendarMonth } from '../components/CalendarMonth.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { DeadlineList, WhyDrawer, useDeadlineActions } from '../components/deadlines.tsx';
import { EmptyHint, ErrorBox, JurChip, Loading, PageHeader, Pill, Ref, Section, Segmented } from '../components/ui.tsx';
import { AddDeadlineDialog, CalendarFeedDialog } from '../components/workDeadlines.tsx';
import { DEADLINE_EXPAND, currentHashParams, errMsg, replaceHashSilently, subjectTitle } from '../components/workShared.tsx';

type Scope = 'mine' | 'team' | 'all';
type Win = 'overdue' | 'week' | '30' | '60' | '90' | 'open' | 'closed';
type View = 'list' | 'calendar' | 'table';

const WINDOWS: { value: Win; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'week', label: 'This week' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: 'open', label: 'All open' },
  { value: 'closed', label: 'Closed' },
];

const WINDOW_TITLE: Record<Win, string> = {
  overdue: 'Overdue',
  week: 'Due in the next 7 days',
  '30': 'Due in the next 30 days',
  '60': 'Due in the next 60 days',
  '90': 'Due in the next 90 days',
  open: 'All open deadlines',
  closed: 'Closed in the last six months',
};

const WINDOW_EMPTY: Record<Win, string> = {
  overdue: 'Nothing is overdue',
  week: 'Nothing due in the next 7 days',
  '30': 'Nothing due in the next 30 days',
  '60': 'Nothing due in the next 60 days',
  '90': 'Nothing due in the next 90 days',
  open: 'No open deadlines',
  closed: 'Nothing closed in the last six months',
};

const WIN_VALUES = new Set<string>(WINDOWS.map((w) => w.value));

function asWin(v: string): Win {
  return WIN_VALUES.has(v) ? (v as Win) : 'open';
}

function asView(v: string): View {
  return v === 'calendar' || v === 'table' ? v : 'list';
}

function inWindow(d: DeadlineRec, w: Win): boolean {
  if (d.status !== 'open') return w === 'closed';
  if (w === 'closed') return false;
  if (w === 'open') return true;
  const due = d10(d.due_date);
  if (due === '') return false;
  const n = daysUntil(due);
  if (w === 'overdue') return n < 0;
  const limit = w === 'week' ? 7 : Number(w);
  return n >= 0 && n <= limit;
}

type WhyNext = Parameters<NonNullable<ComponentProps<typeof WhyDrawer>['onAction']>>[0];

const FILTER_KEYS = ['kind', 'category', 'jurisdiction', 'ip_type', 'assignee'] as const;

export function DeadlinesPage({ id }: { id: string }): React.JSX.Element {
  const { can, me, users, userName, vocab } = useApp();
  const { userId } = useAuth();
  const myId = me?.id ?? userId ?? '';

  const defaultScope: Scope = can.edit ? 'all' : 'mine';
  const [scopeRaw, setScope] = useHashParam('scope', defaultScope);
  const scope: Scope = scopeRaw === 'mine' || scopeRaw === 'team' || scopeRaw === 'all' ? scopeRaw : defaultScope;
  const [winRaw, setWin] = useHashParam('window', 'open');
  const win = asWin(winRaw);
  const [viewRaw, setView] = useHashParam('view', 'list');
  const view = asView(viewRaw);
  const [kind, setKind] = useHashParam('kind', '');
  const [category, setCategory] = useHashParam('category', '');
  const [jur, setJur] = useHashParam('jurisdiction', '');
  const [ipType, setIpType] = useHashParam('ip_type', '');
  const [assignee, setAssignee] = useHashParam('assignee', '');
  const [day, setDay] = useHashParam('day', today());

  // Text search updates the address quietly so typing never re-renders the router.
  const [q, setQState] = useState(() => currentHashParams().get('q') ?? '');
  const setQ = (v: string): void => {
    setQState(v);
    const r = parseHash(window.location.hash);
    const p = new URLSearchParams(r.params);
    if (v.trim() !== '') p.set('q', v);
    else p.delete('q');
    const base = `#/deadlines${r.id !== '' ? `/${encodeURIComponent(r.id)}` : ''}`;
    const qs = p.toString();
    replaceHashSilently(qs !== '' ? `${base}?${qs}` : base);
  };

  const [addOpen, setAddOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const scopeFilter =
    scope === 'mine' ? ` && assignee = "${myId || '__nobody__'}"` : scope === 'team' ? ` && assignee != "" && assignee != "${myId || '__nobody__'}"` : '';
  const since = toPb(addDays(today(), -180));
  const openCol = useCollection<DeadlineRec>('deadlines', { filter: `status = "open"${scopeFilter}`, sort: 'due_date', expand: DEADLINE_EXPAND });
  const closedCol = useCollection<DeadlineRec>('deadlines', {
    filter: `status != "open" && closed_at >= "${since}"${scopeFilter}`,
    sort: '-closed_at',
    expand: DEADLINE_EXPAND,
  });

  const { actions, dialogs, canEdit } = useDeadlineActions(() => {
    openCol.refresh();
    closedCol.refresh();
    setSel(new Set());
  });

  const term = q.trim().toLowerCase();
  const matches = (d: DeadlineRec): boolean => {
    if (kind !== '' && d.kind !== kind) return false;
    if (category !== '' && d.category !== category) return false;
    if (jur !== '' && d.jurisdiction.toUpperCase() !== jur) return false;
    if (ipType !== '') {
      if (ipType === 'agreement') {
        if (d.ip_type !== 'agreement' && d.agreement === '') return false;
      } else if (ipType === 'work') {
        if (d.ip_type !== 'work' && d.work === '') return false;
      } else if (d.ip_type !== ipType) return false;
    }
    if (assignee === 'none' && d.assignee !== '') return false;
    if (assignee !== '' && assignee !== 'none' && d.assignee !== assignee) return false;
    if (term !== '') {
      const hay = `${d.title} ${d.ref} ${subjectTitle(d)}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  };

  const openFiltered = useMemo(() => openCol.records.filter(matches), [openCol.records, kind, category, jur, ipType, assignee, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const closedFiltered = useMemo(() => closedCol.records.filter(matches), [closedCol.records, kind, category, jur, ipType, assignee, term]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<Win, number> = { overdue: 0, week: 0, '30': 0, '60': 0, '90': 0, open: openFiltered.length, closed: closedFiltered.length };
    for (const d of openFiltered) {
      for (const w of ['overdue', 'week', '30', '60', '90'] as const) if (inWindow(d, w)) c[w] += 1;
    }
    return c;
  }, [openFiltered, closedFiltered]);

  const rows = useMemo(() => (win === 'closed' ? closedFiltered : openFiltered.filter((d) => inWindow(d, win))), [win, openFiltered, closedFiltered]);
  const selectedOpen = useMemo(() => rows.filter((r) => sel.has(r.id) && r.status === 'open'), [rows, sel]);

  // Filter choices drawn from what is loaded, plus the current value.
  const jurOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of openCol.records) if (d.jurisdiction !== '') set.add(d.jurisdiction.toUpperCase());
    for (const d of closedCol.records) if (d.jurisdiction !== '') set.add(d.jurisdiction.toUpperCase());
    if (jur !== '') set.add(jur);
    return [...set].sort().map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` }));
  }, [openCol.records, closedCol.records, jur]);
  const typeOptions = [
    ...(Object.keys(IP_TYPE_LABEL) as IpType[]).map((t) => ({ value: t, label: IP_TYPE_LABEL[t] })),
    { value: 'agreement', label: 'Agreement' },
    { value: 'work', label: vocab.work },
  ];
  const kindOptions = (Object.keys(KIND_LABEL) as DeadlineKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
  const categoryOptions = (Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));
  const assigneeOptions = [
    { value: 'none', label: 'Nobody assigned' },
    ...users.filter((u) => u.role !== 'inventor').map((u) => ({ value: u.id, label: u.name || u.email })),
  ];

  const filtersOn = kind !== '' || category !== '' || jur !== '' || ipType !== '' || assignee !== '' || term !== '';
  const clearFilters = (): void => {
    const r = parseHash(window.location.hash);
    const p = new URLSearchParams(r.params);
    for (const k of FILTER_KEYS) p.delete(k);
    p.delete('q');
    setQState('');
    const qs = p.toString();
    window.history.replaceState(null, '', qs !== '' ? `#/deadlines?${qs}` : '#/deadlines');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  /* ---------------- deep link: #/deadlines/<id> ---------------- */
  const route = useRoute();
  const [deepId, setDeepId] = useState(id);
  const [deep, setDeep] = useState<DeadlineRec | null>(null);
  useEffect(() => {
    if (route.page === 'deadlines' && route.id !== '') setDeepId(route.id);
  }, [route]);
  const cleanHash = (): void => {
    const p = currentHashParams().toString();
    replaceHashSilently(p !== '' ? `#/deadlines?${p}` : '#/deadlines');
  };
  useEffect(() => {
    if (deepId === '') return;
    let cancelled = false;
    getRecord<DeadlineRec>('deadlines', deepId)
      .then((d) => {
        if (!cancelled) setDeep(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        toast.error(`That deadline could not be opened: ${errMsg(e)}`);
        setDeepId('');
        cleanHash();
      });
    return () => {
      cancelled = true;
    };
  }, [deepId]);
  const closeDeep = (): void => {
    setDeep(null);
    setDeepId('');
    cleanHash();
  };
  const onDeepAction = (next: WhyNext): void => {
    closeDeep();
    if (next === null) return;
    switch (next.kind) {
      case 'close':
        actions.onClose(next.items);
        break;
      case 'extend':
        actions.onExtend(next.item);
        break;
      case 'move':
        actions.onMove(next.items);
        break;
      case 'reassign':
        actions.onReassign(next.items);
        break;
      case 'why':
        actions.onWhy(next.item);
        break;
    }
  };

  /* ---------------- table ---------------- */
  const columns: Col<DeadlineRec>[] = [
    { key: 'ref', label: 'Ref', render: (d) => (d.ref !== '' ? <Ref className="whitespace-nowrap">{d.ref}</Ref> : ''), value: (d) => d.ref },
    {
      key: 'title',
      label: 'Deadline',
      render: (d) => {
        const subj = subjectTitle(d);
        return (
          <div className="min-w-[12rem] max-w-[24rem]">
            <div className="font-medium">{d.title}</div>
            {subj !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{subj}</div>}
          </div>
        );
      },
      value: (d) => d.title,
    },
    { key: 'jurisdiction', label: 'Jurisdiction', render: (d) => (d.jurisdiction !== '' ? <JurChip code={d.jurisdiction} /> : ''), value: (d) => d.jurisdiction },
    { key: 'kind', label: 'Kind', value: (d) => KIND_LABEL[d.kind] },
    { key: 'category', label: 'Category', value: (d) => (d.category !== '' ? CATEGORY_LABEL[d.category] : '') },
    { key: 'target', label: 'Target', render: (d) => <span className="whitespace-nowrap tabular-nums">{fmtDate(d.target_date)}</span>, value: (d) => d10(d.target_date) },
    { key: 'due', label: 'Due', render: (d) => <span className="whitespace-nowrap font-medium tabular-nums">{fmtDate(d.due_date)}</span>, value: (d) => d10(d.due_date) },
    { key: 'final', label: 'Final', render: (d) => <span className="whitespace-nowrap tabular-nums">{fmtDate(d.final_date)}</span>, value: (d) => d10(d.final_date) },
    { key: 'assignee', label: 'Assignee', render: (d) => <span className="whitespace-nowrap">{userName(d.assignee)}</span>, value: (d) => userName(d.assignee) },
    { key: 'source', label: 'Source', value: (d) => (d.source !== '' ? (SOURCE_LABEL[d.source] ?? d.source) : ''), optional: true },
    {
      key: 'status',
      label: 'Status',
      render: (d) => {
        if (d.status === 'open') {
          const sev = deadlineSeverity(d);
          return <Pill tone={sev.tone}>{sev.label}</Pill>;
        }
        return <Pill tone={d.status === 'done' ? 'good' : d.status === 'missed' ? 'bad' : 'neutral'}>{DEADLINE_STATUS_LABEL[d.status]}</Pill>;
      },
      value: (d) => (d.status === 'open' ? `Open, due ${d10(d.due_date)}` : DEADLINE_STATUS_LABEL[d.status]),
    },
  ];

  const bulkBar =
    canEdit && selectedOpen.length > 0 ? (
      <>
        <span className="text-[13px] font-medium">{selectedOpen.length} selected</span>
        <Button size="sm" className="h-7 px-2.5 text-xs" variant="outline" onClick={() => actions.onClose(selectedOpen)}>
          Close
        </Button>
        <Button size="sm" className="h-7 px-2.5 text-xs" variant="outline" onClick={() => actions.onReassign(selectedOpen)}>
          Reassign
        </Button>
        <Button size="sm" className="h-7 px-2.5 text-xs" variant="outline" onClick={() => actions.onMove(selectedOpen)}>
          Move dates
        </Button>
        <Button size="sm" className="h-7 px-2.5 text-xs" variant="ghost" onClick={() => setSel(new Set())}>
          Clear
        </Button>
      </>
    ) : canEdit && win !== 'closed' ? (
      <span className="text-xs text-[var(--agent-app-muted)]">Tick rows to close, reassign or move them together.</span>
    ) : undefined;

  /* ---------------- empty states ---------------- */
  const nothingAtAll = !openCol.loading && !closedCol.loading && openCol.records.length === 0 && closedCol.records.length === 0 && scope === 'all';
  const emptyEl = nothingAtAll ? (
    <EmptyHint
      icon={CalendarClock}
      title="No deadlines yet"
      message="Deadlines appear when you record what happened on a record, when offices report changes, or when you add one by hand."
      action={
        can.edit ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add a deadline
          </Button>
        ) : undefined
      }
    />
  ) : filtersOn ? (
    <EmptyHint
      icon={CalendarClock}
      title="No deadlines match these filters"
      message={`${WINDOW_EMPTY[win]} with the filters you chose.`}
      action={
        <Button size="sm" variant="outline" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyHint
      icon={CalendarClock}
      title={WINDOW_EMPTY[win]}
      message={scope === 'mine' ? 'Only deadlines assigned to you are shown.' : scope === 'team' ? 'Only deadlines assigned to other people are shown.' : undefined}
      action={
        scope !== 'all' ? (
          <Button size="sm" variant="outline" onClick={() => setScope('all')}>
            Show everyone's deadlines
          </Button>
        ) : win !== 'open' ? (
          <Button size="sm" variant="outline" onClick={() => setWin('open')}>
            Show all open deadlines
          </Button>
        ) : undefined
      }
    />
  );

  const loading = openCol.loading || (win === 'closed' && closedCol.loading);
  const loadError = openCol.error ?? closedCol.error;
  const dayRows = rows.filter((d) => d10(d.due_date) === day);

  return (
    <div>
      <PageHeader
        title="Deadlines"
        meta={openCol.loading ? undefined : `${openCol.records.length} open`}
        subtitle="Every date on the docket, from the rules, the offices and people. Target dates leave a safety margin before the legal due date."
        actions={
          <>
            <Button variant="outline" onClick={() => setFeedOpen(true)}>
              <CalendarPlus size={14} aria-hidden /> Calendar feed
            </Button>
            {can.edit && (
              <Button onClick={() => setAddOpen(true)}>
                <Plus size={14} aria-hidden /> Add deadline
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="max-w-full overflow-x-auto">
            <Segmented<Win>
              size="sm"
              ariaLabel="When"
              value={win}
              onChange={(v) => {
                setSel(new Set());
                setWin(v);
              }}
              options={WINDOWS.map((w) => ({
                value: w.value,
                label: <span className="whitespace-nowrap">{loading ? w.label : `${w.label} ${counts[w.value]}`}</span>,
                tone: w.value === 'overdue' && counts.overdue > 0 ? ('bad' as const) : undefined,
              }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Scope>
              size="sm"
              ariaLabel="Whose deadlines"
              value={scope}
              onChange={(v) => {
                setSel(new Set());
                setScope(v);
              }}
              options={[
                { value: 'mine', label: 'Mine', title: 'Assigned to you' },
                { value: 'team', label: 'Team', title: 'Assigned to other people' },
                { value: 'all', label: 'All', title: 'Everything, including unassigned' },
              ]}
            />
            <Segmented<View>
              size="sm"
              ariaLabel="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List' },
                { value: 'calendar', label: 'Calendar' },
                { value: 'table', label: 'Table' },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-60">
            <Input aria-label="Search deadlines" className="h-8 text-[13px]" placeholder="Search title or reference" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <FilterSelect label="Kind" value={kind} placeholder="All kinds" options={kindOptions} onChange={setKind} />
          <FilterSelect label="Category" value={category} placeholder="All categories" options={categoryOptions} onChange={setCategory} />
          <FilterSelect label="Jurisdiction" value={jur} placeholder="All jurisdictions" options={jurOptions} onChange={setJur} />
          <FilterSelect label="Type" value={ipType} placeholder="All types" options={typeOptions} onChange={setIpType} />
          <FilterSelect
            label="Assignee"
            value={assignee}
            placeholder="Anyone"
            options={assigneeOptions}
            onChange={(v) => {
              if (v !== '' && scope !== 'all') setScope('all');
              setAssignee(v);
            }}
          />
          {filtersOn && (
            <Button size="sm" variant="ghost" className="h-8" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {loadError !== null && !loading ? (
        <ErrorBox
          message={loadError}
          onRetry={() => {
            openCol.refresh();
            closedCol.refresh();
          }}
        />
      ) : loading ? (
        <Section title={WINDOW_TITLE[win]} flush>
          <Loading label="Loading deadlines" />
        </Section>
      ) : view === 'list' ? (
        <Section title={WINDOW_TITLE[win]} meta={String(rows.length)} flush>
          <DeadlineList deadlines={rows} actions={canEdit ? actions : null} subjectLabel={(d) => subjectTitle(d)} empty={emptyEl} />
        </Section>
      ) : view === 'calendar' ? (
        <div className="flex flex-col gap-4">
          <Section title={WINDOW_TITLE[win]} meta={String(rows.length)}>
            <CalendarMonth deadlines={rows} selectedDay={day} onSelectDay={setDay} />
          </Section>
          <Section title={`Due ${fmtDate(day)}`} meta={dayRows.length > 0 ? String(dayRows.length) : undefined} flush>
            <DeadlineList
              deadlines={dayRows}
              grouped={false}
              actions={canEdit ? actions : null}
              subjectLabel={(d) => subjectTitle(d)}
              empty={<EmptyHint compact icon={CalendarClock} title="Nothing due on this day" message="Pick another day in the calendar above." />}
            />
          </Section>
        </div>
      ) : (
        <Section title={WINDOW_TITLE[win]} flush>
          <DataTable<DeadlineRec>
            tableId="deadlines"
            rows={rows}
            columns={columns}
            onRowClick={(d) => actions.onWhy(d)}
            selectable={canEdit && win !== 'closed'}
            selected={sel}
            onSelectedChange={setSel}
            exportName="deadlines"
            initialSort={{ key: 'due', dir: win === 'closed' ? 'desc' : 'asc' }}
            toolbar={bulkBar}
            empty={emptyEl}
          />
        </Section>
      )}

      {dialogs}
      {deep !== null && <WhyDrawer item={deep} onClose={closeDeep} onAction={can.edit ? onDeepAction : undefined} />}
      {addOpen && (
        <AddDeadlineDialog
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            openCol.refresh();
          }}
        />
      )}
      {feedOpen && <CalendarFeedDialog onClose={() => setFeedOpen(false)} />}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <div className="w-[calc(50%-0.25rem)] sm:w-40">
      <Select aria-label={label} title={label} className="h-8 text-[13px]" value={value} placeholder={placeholder} options={options} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
