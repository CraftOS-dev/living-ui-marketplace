/**
 * Deadlines: every date across the catalogue (rules, offices, contracts,
 * playbooks and people), as a grouped list with bulk actions or a month
 * calendar. Filters live in the address so a view can be bookmarked or
 * shared. "#/deadlines/<id>" opens "Why this date?" for one deadline;
 * "?new=1" opens the new-deadline form; "?feed=1" shows the calendar link.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { Button, Input, Select, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { getRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, d10, daysUntil, fmtDate, toPb, today } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { parseHash, useHashParam, useRoute } from '../lib/router.ts';
import type { DeadlineRec } from '../lib/records.ts';
import type { ModuleKey } from '../lib/shapes.ts';
import { CalendarMonth } from '../components/CalendarMonth.tsx';
import { DeadlineList, deadlineSubject, useDeadlineActions } from '../components/deadlines.tsx';
import { EmptyHint, ErrorBox, Loading, PageHeader, Section, Segmented } from '../components/ui.tsx';
import { CalendarFeedPanel, NewDeadlineDialog } from '../components/workDeadlines.tsx';
import { errMsg, normSubjectType, replaceHashSilently, subjectTypeLabel } from '../components/workShared.tsx';

type Status = 'open' | 'closed' | 'all';
type Win = 'all' | 'overdue' | 'week' | '30' | '60' | '90';
type View = 'list' | 'calendar';

const WINS: Win[] = ['all', 'overdue', 'week', '30', '60', '90'];

function asStatus(v: string): Status {
  return v === 'closed' || v === 'all' ? v : 'open';
}
function asWin(v: string): Win {
  return (WINS as string[]).includes(v) ? (v as Win) : 'all';
}
function asView(v: string): View {
  return v === 'calendar' ? 'calendar' : 'list';
}

function winLabel(w: Win): string {
  switch (w) {
    case 'overdue':
      return t('Overdue');
    case 'week':
      return t('Next 7 days');
    case '30':
      return t('Next 30 days');
    case '60':
      return t('Next 60 days');
    case '90':
      return t('Next 90 days');
    default:
      return t('Any date');
  }
}

function inWindow(d: DeadlineRec, w: Win): boolean {
  if (w === 'all') return true;
  const due = d10(d.due_date);
  if (due === '') return false;
  const n = daysUntil(due);
  if (w === 'overdue') return n < 0;
  const limit = w === 'week' ? 7 : Number(w);
  return n >= 0 && n <= limit;
}

/** Categories that belong to a module (hidden when it is switched off). */
const CATEGORY_MODULE: Partial<Record<string, ModuleKey>> = {
  committee: 'committees',
  talent: 'talents',
  playbook: 'talents',
  licensing: 'products',
  approval: 'approvals',
  music: 'music',
  content_id: 'music',
  permission: 'permissions',
  guideline: 'guidelines',
};

/** Record types a deadline can belong to, with the module each needs. */
const RECORD_TYPES: [string, ModuleKey | null][] = [
  ['matter', null],
  ['agreement', null],
  ['work', 'titles'],
  ['character', 'franchises'],
  ['talent', 'talents'],
  ['product', 'products'],
  ['approval', 'approvals'],
  ['permission', 'permissions'],
  ['committee', 'committees'],
  ['case', null],
  ['registration', 'music'],
  ['claim', 'music'],
  ['recordation', null],
  ['society_contract', 'music'],
  ['fan_registration', 'guidelines'],
  ['enrollment', null],
];

const FILTER_KEYS = ['window', 'category', 'kind', 'assignee', 'jurisdiction', 'type', 'q'];

export function DeadlinesPage({ id }: { id: string }): React.JSX.Element {
  const { can, me, users, on } = useApp();
  const myId = me?.id ?? '';
  const [statusRaw, setStatus] = useHashParam('status', 'open');
  const status = asStatus(statusRaw);
  const [winRaw, setWin] = useHashParam('window', 'all');
  const win = asWin(winRaw);
  const [category, setCategory] = useHashParam('category', '');
  const [kind, setKind] = useHashParam('kind', '');
  const [assignee, setAssignee] = useHashParam('assignee', 'anyone');
  const [jur, setJur] = useHashParam('jurisdiction', '');
  const [type, setType] = useHashParam('type', '');
  const [qParam, setQParam] = useHashParam('q', '');
  const [viewRaw, setView] = useHashParam('view', 'list');
  const view = asView(viewRaw);
  const [day, setDay] = useHashParam('day', today());
  const route = useRoute();

  // Typing updates the address after a pause, not on every key.
  const [q, setQ] = useState(qParam);
  useEffect(() => {
    if (q === qParam) return;
    const timer = setTimeout(() => setQParam(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q, qParam, setQParam]);

  const since = toPb(addDays(today(), -365));
  const openCol = useCollection<DeadlineRec>('deadlines', { filter: 'status = "open"', sort: 'due_date' });
  const closedCol = useCollection<DeadlineRec>('deadlines', {
    filter: status === 'open' ? 'id = "-"' : `status != "open" && updated >= "${since}"`,
    sort: '-updated',
  });
  const dl = useDeadlineActions(() => {
    openCol.refresh();
    closedCol.refresh();
  });

  /* ---------------- filters ---------------- */
  const term = qParam.trim().toLowerCase();
  const matches = (d: DeadlineRec): boolean => {
    if (category !== '' && d.category !== category) return false;
    if (kind !== '' && d.kind !== kind) return false;
    if (jur !== '' && d.jurisdiction.toUpperCase() !== jur) return false;
    if (assignee === 'me' && (myId === '' || d.assignee !== myId)) return false;
    if (assignee === 'unassigned' && d.assignee !== '') return false;
    if (assignee !== 'anyone' && assignee !== 'me' && assignee !== 'unassigned' && d.assignee !== assignee) return false;
    if (type !== '') {
      const s = deadlineSubject(d);
      if (s?.type !== type && normSubjectType(d.subject_type) !== type) return false;
    }
    if (term !== '') {
      const hay = `${d.title} ${d.title_ja} ${d.subject_label} ${d.ref}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  };

  const openMatched = useMemo(() => openCol.records.filter(matches), [openCol.records, category, kind, jur, assignee, type, term, myId]); // eslint-disable-line react-hooks/exhaustive-deps
  const closedMatched = useMemo(() => closedCol.records.filter(matches), [closedCol.records, category, kind, jur, assignee, type, term, myId]); // eslint-disable-line react-hooks/exhaustive-deps
  const winCounts = useMemo(() => {
    const c = {} as Record<Win, number>;
    for (const w of WINS) c[w] = openMatched.filter((d) => inWindow(d, w)).length;
    return c;
  }, [openMatched]);
  const rows = useMemo(() => {
    const open = openMatched.filter((d) => inWindow(d, win));
    return status === 'open' ? open : status === 'closed' ? closedMatched : [...open, ...closedMatched];
  }, [openMatched, closedMatched, win, status]);

  const jurOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of [...openCol.records, ...closedCol.records]) {
      const j = d.jurisdiction.toUpperCase();
      if (j !== '' && j !== '*') set.add(j);
    }
    if (jur !== '') set.add(jur);
    return [...set].sort().map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` }));
  }, [openCol.records, closedCol.records, jur]);
  const categoryOptions = enumOptions('deadlines.category')
    .filter(([v]) => {
      const m = CATEGORY_MODULE[v];
      return m === undefined || on(m) || v === category;
    })
    .map(([value, label]) => ({ value, label }));
  const kindOptions = enumOptions('deadlines.kind').map(([value, label]) => ({ value, label }));
  const typeOptions = RECORD_TYPES.filter(([v, m]) => m === null || on(m) || v === type).map(([value]) => ({ value, label: subjectTypeLabel(value) }));
  const internal = new Set(['admin', 'manager', 'rights', 'licensing', 'talent_manager', 'contributor', 'viewer']);
  const assigneeOptions = [
    { value: 'anyone', label: t('Anyone') },
    { value: 'me', label: t('Assigned to me') },
    { value: 'unassigned', label: t('Nobody assigned') },
    ...users.filter((u) => internal.has(u.role) && u.id !== myId).map((u) => ({ value: u.id, label: u.name || u.email })),
  ];
  const winOptions = WINS.map((w) => ({ value: w, label: openCol.loading ? winLabel(w) : `${winLabel(w)} (${winCounts[w]})` }));

  const filtersOn = win !== 'all' || category !== '' || kind !== '' || assignee !== 'anyone' || jur !== '' || type !== '' || term !== '';
  const clearFilters = (): void => {
    const r = parseHash(window.location.hash);
    const p = new URLSearchParams(r.params);
    for (const k of FILTER_KEYS) p.delete(k);
    setQ('');
    const qs = p.toString();
    const base = `#/deadlines${r.id !== '' ? `/${encodeURIComponent(r.id)}` : ''}`;
    window.history.replaceState(null, '', qs !== '' ? `${base}?${qs}` : base);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  /* ---------------- deep link and hand-offs ---------------- */
  useEffect(() => {
    if (id === '') return;
    let cancelled = false;
    getRecord<DeadlineRec>('deadlines', id)
      .then((d) => {
        if (!cancelled) dl.actions.onWhy(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(t('That deadline could not be opened: {error}', { error: errMsg(e) }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [addOpen, setAddOpen] = useState(false);
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || route.params.get('new') !== '1' || !can.edit) return;
    handled.current = true;
    setAddOpen(true);
    const r = parseHash(window.location.hash);
    const p = new URLSearchParams(r.params);
    p.delete('new');
    const qs = p.toString();
    replaceHashSilently(qs !== '' ? `#/deadlines?${qs}` : '#/deadlines');
  }, [route, can.edit]);
  const [feedOpen] = useState(() => route.params.get('feed') === '1');

  /* ---------------- empty states ---------------- */
  const loading = openCol.loading || (status !== 'open' && closedCol.loading);
  const loadError = openCol.error ?? (status !== 'open' ? closedCol.error : null);
  const nothingAtAll = !loading && openCol.records.length === 0 && (status === 'open' || closedCol.records.length === 0);
  const emptyEl = filtersOn && !nothingAtAll ? (
    <EmptyHint
      icon={CalendarClock}
      title={t('No deadlines match these filters')}
      action={
        <Button size="sm" variant="outline" onClick={clearFilters}>
          {t('Clear filters')}
        </Button>
      }
    />
  ) : status === 'closed' ? (
    <EmptyHint icon={CalendarClock} title={t('Nothing closed in the last 12 months')} message={t('Deadlines marked done, extended or closed with a reason appear here.')} />
  ) : (
    <EmptyHint
      icon={CalendarClock}
      title={t('No open deadlines')}
      message={t('Deadlines appear when you record what happened on a record, when an office or CraftBot proposal is accepted in the Inbox, or when you add one by hand.')}
      action={
        can.edit ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} aria-hidden /> {t('New deadline')}
          </Button>
        ) : undefined
      }
    />
  );

  const listTitle = status === 'closed' ? t('Closed in the last 12 months') : status === 'all' ? t('Open and recently closed') : win === 'all' ? t('All open deadlines') : winLabel(win);
  const dayRows = rows.filter((d) => d10(d.due_date) === day);

  return (
    <div>
      <PageHeader
        title={t('Deadlines')}
        meta={openCol.loading ? undefined : t('{n} open', { n: openCol.records.length })}
        subtitle={t('Every date from the rules, the offices, contracts and people. Each one can show why it falls when it does.')}
        actions={
          can.edit ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={14} aria-hidden /> {t('New deadline')}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented<Status>
            size="sm"
            ariaLabel={t('Status')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'open', label: t('Open|deadline status') },
              { value: 'closed', label: t('Closed') },
              { value: 'all', label: t('All') },
            ]}
          />
          <Segmented<View>
            size="sm"
            ariaLabel={t('View')}
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: t('List') },
              { value: 'calendar', label: t('Calendar') },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-60">
            <Input aria-label={t('Search deadlines')} className="h-8 text-[13px]" placeholder={t('Search title, record or reference')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {status !== 'closed' && <FilterSelect label={t('When')} value={win} options={winOptions} onChange={setWin} />}
          <FilterSelect label={t('Assignee')} value={assignee} options={assigneeOptions} onChange={setAssignee} />
          <FilterSelect label={t('Category')} value={category} placeholder={t('All categories')} options={categoryOptions} onChange={setCategory} />
          <FilterSelect label={t('Kind')} value={kind} placeholder={t('All kinds')} options={kindOptions} onChange={setKind} />
          <FilterSelect label={t('Record type')} value={type} placeholder={t('All records')} options={typeOptions} onChange={setType} />
          <FilterSelect label={t('Jurisdiction')} value={jur} placeholder={t('All jurisdictions')} options={jurOptions} onChange={setJur} />
          {filtersOn && (
            <Button size="sm" variant="ghost" className="h-8" onClick={clearFilters}>
              {t('Clear filters')}
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
        <Section title={listTitle} flush>
          <Loading />
        </Section>
      ) : view === 'list' ? (
        <Section title={listTitle} meta={String(rows.length)} flush>
          <DeadlineList deadlines={rows} actions={dl.actions} canEdit={dl.canEdit} empty={emptyEl} />
        </Section>
      ) : (
        <div className="flex flex-col gap-4">
          <Section title={listTitle} meta={String(rows.length)}>
            <CalendarMonth deadlines={rows} selectedDay={day} onSelectDay={setDay} />
          </Section>
          <Section title={t('Due {date}', { date: fmtDate(day) })} meta={dayRows.length > 0 ? String(dayRows.length) : undefined} flush>
            <DeadlineList
              deadlines={dayRows}
              grouped={false}
              actions={dl.actions}
              canEdit={dl.canEdit}
              empty={<EmptyHint compact icon={CalendarClock} title={t('Nothing due on this day')} message={t('Pick another day in the calendar above.')} />}
            />
          </Section>
        </div>
      )}

      <div className="mt-6">
        <CalendarFeedPanel defaultOpen={feedOpen} />
      </div>

      {dl.dialogs}
      {addOpen && (
        <NewDeadlineDialog
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            openCol.refresh();
          }}
        />
      )}
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
  placeholder?: string | undefined;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <div className="w-[calc(50%-0.25rem)] min-w-0 sm:w-44">
      <Select aria-label={label} title={label} className="h-8 text-[13px]" value={value} placeholder={placeholder} options={options} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
