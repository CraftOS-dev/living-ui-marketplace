/**
 * Trademark watch triage: reports from the organization's watch provider
 * land here (CSV import or by hand), people compare each hit with their
 * own mark side by side, decide (dismiss, monitor, escalate, action) and
 * open an opposition as a dispute when it is worth fighting.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Binoculars, FileUp, Plus, Scale, Trash2 } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { parseCsv } from '../lib/csv.ts';
import { d10, daysUntil, fmtDate, fmtDateTime, plural, relLabel, toPb } from '../lib/format.ts';
import { STATUS_LABEL, WATCH_STATUS_LABEL, WATCH_STATUS_TONE, jurisdictionName } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href, useHashParam } from '../lib/router.ts';
import type { DisputeRec, FamilyRec, GoodsServicesRec, MatterRec, WatchHitRec } from '../lib/types.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { JurisdictionSelect, RecordPicker } from './pickers.tsx';
import { EmptyHint, ErrorBox, Field, JurChip, Loading, Notice, Pill, Prose, Ref, Section, Segmented, TONE_BAR, TONE_BG, TONE_TEXT, Tag } from './ui.tsx';

export type HitX = WatchHitRec & { expand?: { family?: FamilyRec } };
type HitStatus = WatchHitRec['status'];
type Filter = 'new' | 'reviewing' | 'monitor' | 'escalated' | 'done' | 'all';

const FILTERS: { value: Filter; label: string; statuses: HitStatus[] | null }[] = [
  { value: 'new', label: 'New', statuses: ['new'] },
  { value: 'reviewing', label: 'Reviewing', statuses: ['reviewing'] },
  { value: 'monitor', label: 'Monitor', statuses: ['monitor'] },
  { value: 'escalated', label: 'Escalated', statuses: ['escalated'] },
  { value: 'done', label: 'Done', statuses: ['dismissed', 'actioned'] },
  { value: 'all', label: 'All', statuses: null },
];

/** Office that hears trademark oppositions in each jurisdiction. */
const OPPOSITION_FORUM: Record<string, string> = {
  US: 'USPTO Trademark Trial and Appeal Board',
  EM: 'EUIPO Opposition Division',
  JP: 'Japan Patent Office',
  GB: 'UK Intellectual Property Office',
  CN: 'China National Intellectual Property Administration',
  KR: 'Korean Intellectual Property Office',
  CA: 'Canadian Intellectual Property Office',
  AU: 'IP Australia',
  NZ: 'Intellectual Property Office of New Zealand',
  IN: 'Indian Trade Marks Registry',
  BX: 'Benelux Office for Intellectual Property',
  WO: 'WIPO (Madrid designation, opposed at the designated office)',
};

function forumFor(code: string): string {
  const c = code.toUpperCase();
  if (c === '') return '';
  return OPPOSITION_FORUM[c] ?? `${jurisdictionName(c)} trademark office`;
}

/** Nice class numbers written in a report ("9, 41" or "09;41"). */
export function parseClasses(s: string): number[] {
  const out = new Set<number>();
  for (const part of s.split(/[^0-9]+/)) {
    if (part === '') continue;
    const n = Number(part);
    if (n >= 1 && n <= 45) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function scoreTone(score: number): Tone {
  if (score >= 70) return 'bad';
  if (score >= 40) return 'warn';
  return 'neutral';
}

function ScoreMeter({ score }: { score: number }): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, score || 0));
  return (
    <span className="inline-flex items-center gap-2" title={`Similarity ${pct} of 100 (from the watch report)`}>
      <span className="w-7 text-right text-[12.5px] font-medium tabular-nums">{Math.round(pct)}</span>
      <span className="h-1.5 w-14 bg-[var(--agent-app-border)]" aria-hidden>
        <span className={cn('block h-full', TONE_BAR[scoreTone(pct)])} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function deadlineTone(day: string): Tone {
  const d = d10(day);
  if (d === '') return 'neutral';
  const n = daysUntil(d);
  if (n < 0) return 'neutral';
  if (n <= 14) return 'bad';
  if (n <= 30) return 'warn';
  return 'neutral';
}

function DeadlineCell({ day }: { day: string }): React.JSX.Element {
  const d = d10(day);
  if (d === '') return <span className="text-[var(--agent-app-muted)]">-</span>;
  const n = daysUntil(d);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {fmtDate(d)}
      <span className={cn('block text-xs', n < 0 ? 'text-[var(--agent-app-muted)]' : TONE_TEXT[deadlineTone(d)])}>{n < 0 ? 'Period ended' : relLabel(d)}</span>
    </span>
  );
}

function ClassChips({ classes, shared }: { classes: number[]; shared: Set<number> }): React.JSX.Element {
  if (classes.length === 0) return <span className="text-[13px] text-[var(--agent-app-muted)]">None given</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {classes.map((c) => (
        <span
          key={c}
          title={shared.has(c) ? 'Class in common with your mark' : undefined}
          className={cn(
            'inline-flex h-6 min-w-7 items-center justify-center border px-1.5 font-mono text-xs',
            shared.has(c) ? cn('border-current font-semibold', TONE_BG.warn, TONE_TEXT.warn) : 'border-[var(--agent-app-border)]',
          )}
        >
          {c}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export function WatchTab({ onOpenDispute }: { onOpenDispute: (id: string) => void }): React.JSX.Element {
  const { can } = useApp();
  const hits = useCollection<HitX>('watch_hits', { sort: 'opposition_deadline', expand: 'family' });
  const [filterRaw, setFilter] = useHashParam('filter', 'new');
  const filter: Filter = FILTERS.some((f) => f.value === filterRaw) ? (filterRaw as Filter) : 'new';
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { new: 0, reviewing: 0, monitor: 0, escalated: 0, done: 0, all: hits.records.length };
    for (const h of hits.records) {
      for (const f of FILTERS) if (f.statuses !== null && f.statuses.includes(h.status)) c[f.value] += 1;
    }
    return c;
  }, [hits.records]);

  const rows = useMemo(() => {
    const statuses = FILTERS.find((f) => f.value === filter)?.statuses ?? null;
    const list = hits.records.filter((h) => statuses === null || statuses.includes(h.status));
    return list.sort((a, b) => (d10(a.opposition_deadline) || '9999').localeCompare(d10(b.opposition_deadline) || '9999'));
  }, [hits.records, filter]);

  const open = openId !== null ? (hits.records.find((h) => h.id === openId) ?? null) : null;

  const columns: Col<HitX>[] = [
    {
      key: 'their_mark',
      label: 'Their mark',
      render: (h) => (
        <div className="min-w-0">
          <div className="font-semibold">{h.their_mark}</div>
          {h.application_no !== '' && <div className="font-mono text-[11px] text-[var(--agent-app-muted)]">{h.application_no}</div>}
        </div>
      ),
    },
    { key: 'their_owner', label: 'Owner', render: (h) => <span className="line-clamp-2 max-w-56">{h.their_owner || '-'}</span> },
    { key: 'jurisdiction', label: 'Office', render: (h) => <JurChip code={h.jurisdiction} /> },
    { key: 'classes', label: 'Classes', render: (h) => <span className="font-mono text-xs">{parseClasses(h.classes).join(', ') || '-'}</span> },
    { key: 'score', label: 'Similarity', value: (h) => h.score, render: (h) => <ScoreMeter score={h.score} /> },
    {
      key: 'publication_date',
      label: 'Published',
      value: (h) => d10(h.publication_date),
      render: (h) => (d10(h.publication_date) !== '' ? <span className="whitespace-nowrap tabular-nums">{fmtDate(h.publication_date)}</span> : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
    { key: 'opposition_deadline', label: 'Oppose by', value: (h) => d10(h.opposition_deadline), render: (h) => <DeadlineCell day={h.opposition_deadline} /> },
    {
      key: 'family',
      label: 'Our mark',
      value: (h) => h.expand?.family?.title ?? '',
      render: (h) =>
        h.expand?.family !== undefined ? (
          <a href={href('family', h.expand.family.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {h.expand.family.title}
          </a>
        ) : (
          <span className="text-xs text-[var(--agent-app-muted)]">Not linked</span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      value: (h) => WATCH_STATUS_LABEL[h.status] ?? h.status,
      render: (h) => <Pill tone={WATCH_STATUS_TONE[h.status] ?? 'neutral'}>{WATCH_STATUS_LABEL[h.status] ?? h.status}</Pill>,
    },
    { key: 'source', label: 'Source', optional: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <Notice tone="info" icon={Binoculars}>
          IP Manager does not run watch searches itself: it triages the reports from your watch provider. Import their report as CSV or add a hit by hand, then compare, decide and act before the opposition period ends.
        </Notice>
        {can.edit && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden /> Add hit
            </Button>
            <Button onClick={() => setImporting(true)}>
              <FileUp size={14} aria-hidden /> Import report
            </Button>
          </div>
        )}
      </div>

      {hits.loading && hits.records.length === 0 ? (
        <Loading />
      ) : hits.error !== null ? (
        <ErrorBox message={hits.error} onRetry={hits.refresh} />
      ) : (
        <Section title="Watch hits" meta={String(hits.records.length)} flush>
          <DataTable<HitX>
            tableId="enforce-watch-hits"
            rows={rows}
            columns={columns}
            exportName={`watch-hits-${filter}`}
            onRowClick={(h) => setOpenId(h.id)}
            toolbar={
              <div className="max-w-full overflow-x-auto">
                <Segmented<Filter>
                  size="sm"
                  value={filter}
                  ariaLabel="Show hits"
                  options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value]}`, title: f.value === 'done' ? 'Dismissed and actioned' : undefined }))}
                  onChange={setFilter}
                />
              </div>
            }
            empty={
              hits.records.length === 0 ? (
                <EmptyHint
                  icon={Binoculars}
                  title="No watch hits yet"
                  message="When your watch provider sends a report of similar marks, import it here to triage each hit."
                  action={
                    can.edit ? (
                      <Button onClick={() => setImporting(true)}>
                        <FileUp size={14} aria-hidden /> Import a report
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <EmptyHint compact title={`No ${filter === 'done' ? 'finished' : (FILTERS.find((f) => f.value === filter)?.label ?? '').toLowerCase()} hits`} action={<Button size="sm" variant="outline" onClick={() => setFilter('all')}>Show all hits</Button>} />
              )
            }
          />
        </Section>
      )}

      {open !== null && <HitDrawer key={open.id} hit={open} onClose={() => setOpenId(null)} onOpenDispute={onOpenDispute} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {adding && <AddHitDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Side-by-side comparison                                             */
/* ------------------------------------------------------------------ */

function Line({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{label}</div>
      <div className="mt-0.5 text-[13px]">{children}</div>
    </div>
  );
}

const ACTION_SUGGESTIONS = ['Opposition filed', 'Letter sent', 'Coexistence agreed', 'Extension of time requested'];

function HitDrawer({ hit, onClose, onOpenDispute }: { hit: HitX; onClose: () => void; onOpenDispute: (id: string) => void }): React.JSX.Element {
  const { can, me, userName } = useApp();
  const family = hit.expand?.family;
  const matters = useCollection<MatterRec>('matters', { filter: family !== undefined ? `family = ${q(family.id)}` : 'id = ""', sort: 'jurisdiction' });
  const gs = useCollection<GoodsServicesRec>('goods_services', { filter: family !== undefined ? `matter.family = ${q(family.id)}` : 'id = ""', sort: 'nice_class' });
  const [notes, setNotes] = useState(hit.notes);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionText, setActionText] = useState(hit.action);
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  const ours = useMemo(() => {
    const s = new Set<number>();
    for (const g of gs.records) if (g.class_status !== 'deleted' && g.class_status !== 'cancelled' && g.nice_class > 0) s.add(g.nice_class);
    return [...s].sort((a, b) => a - b);
  }, [gs.records]);
  const theirs = parseClasses(hit.classes);
  const shared = new Set(theirs.filter((c) => ours.includes(c)));
  const liveMatters = matters.records.filter((m) => m.status_group !== 'dead');

  const setStatus = async (status: HitStatus, extra: Record<string, unknown> = {}): Promise<boolean> => {
    setBusy(true);
    try {
      await updateRecord('watch_hits', hit.id, {
        status,
        reviewer: me?.id ?? '',
        ...(status !== 'reviewing' ? { decided_at: new Date().toISOString() } : {}),
        ...extra,
      });
      toast.success(`Marked as ${WATCH_STATUS_LABEL[status] ?? status}`);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async (): Promise<void> => {
    try {
      await updateRecord('watch_hits', hit.id, { notes });
      toast.success('Notes saved');
    } catch {
      /* toast shown by the client */
    }
  };

  const linkFamily = async (id: string): Promise<void> => {
    try {
      await updateRecord('watch_hits', hit.id, { family: id });
      toast.success(id === '' ? 'Unlinked from your mark' : 'Linked to your mark');
    } catch {
      /* toast shown by the client */
    }
  };

  const openDispute = async (): Promise<void> => {
    setBusy(true);
    try {
      const noteLines = [
        `Opened from a watch hit${hit.source !== '' ? ` (${hit.source})` : ''}.`,
        hit.application_no !== '' ? `Their application: ${hit.application_no}${hit.jurisdiction !== '' ? ` (${hit.jurisdiction})` : ''}.` : '',
        hit.classes !== '' ? `Their classes: ${parseClasses(hit.classes).join(', ')}.` : '',
      ].filter((x) => x !== '');
      const dsp = await createRecord<DisputeRec>('disputes', {
        title: `Opposition against ${hit.their_mark}`,
        dispute_type: 'opposition',
        role: 'offense',
        family: hit.family,
        matter: hit.matter,
        other_party: hit.their_owner,
        their_mark: hit.their_mark,
        forum: forumFor(hit.jurisdiction),
        status: 'pending',
        notes: noteLines.join('\n'),
      });
      let withDeadline = false;
      if (d10(hit.opposition_deadline) !== '') {
        try {
          await createRecord('deadlines', {
            title: `File opposition against ${hit.their_mark}${hit.application_no !== '' ? ` (${hit.application_no})` : ''}`,
            dispute: dsp.id,
            matter: hit.matter,
            kind: 'hard',
            category: 'opposition',
            status: 'open',
            due_date: toPb(hit.opposition_deadline),
            source: 'manual',
            jurisdiction: hit.jurisdiction.toUpperCase().slice(0, 3),
            assignee: me?.id ?? '',
            notes: 'Opposition period taken from the watch report. Check it against the official gazette.',
          });
          withDeadline = true;
        } catch {
          /* toast shown by the client; the dispute exists */
        }
      }
      if (hit.status !== 'escalated' && hit.status !== 'actioned') {
        try {
          await updateRecord('watch_hits', hit.id, { status: 'escalated', reviewer: me?.id ?? '', decided_at: new Date().toISOString() });
        } catch {
          /* toast shown by the client */
        }
      }
      toast.success(withDeadline ? `Dispute opened with its opposition deadline (${fmtDate(hit.opposition_deadline)})` : 'Dispute opened');
      onOpenDispute(dsp.id);
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!(await confirm(`Delete the watch hit "${hit.their_mark}"? Use Dismiss instead to keep a record of the decision.`, 'Delete watch hit'))) return;
    try {
      await deleteRecord('watch_hits', hit.id);
      toast.success('Watch hit deleted');
      onClose();
    } catch {
      /* toast shown by the client */
    }
  };

  const statusButtons: { status: HitStatus; label: string }[] = [
    ...(hit.status === 'new' ? [{ status: 'reviewing' as const, label: 'Take for review' }] : []),
    { status: 'dismissed', label: 'Dismiss' },
    { status: 'monitor', label: 'Monitor' },
    { status: 'escalated', label: 'Escalate' },
  ];

  return (
    <Drawer open onClose={onClose} title={`Watch hit: ${hit.their_mark}`} width={880}>
      {confirmEl}
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Pill tone={WATCH_STATUS_TONE[hit.status] ?? 'neutral'}>{WATCH_STATUS_LABEL[hit.status] ?? hit.status}</Pill>
          <ScoreMeter score={hit.score} />
          {hit.source !== '' && <Tag>{hit.source}</Tag>}
          {hit.reviewer !== '' && (
            <span className="text-xs text-[var(--agent-app-muted)]">
              {userName(hit.reviewer)}
              {d10(hit.decided_at) !== '' ? `, ${fmtDateTime(hit.decided_at)}` : ''}
            </span>
          )}
          {hit.action !== '' && <span className="text-xs text-[var(--agent-app-text)]/85">Action: {hit.action}</span>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-accent)]">Your mark</div>
            {family === undefined ? (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-[var(--agent-app-muted)]">This hit is not linked to one of your marks yet.</p>
                {can.edit && (
                  <RecordPicker<FamilyRec>
                    collection="families"
                    value=""
                    allowClear={false}
                    label="Link to your mark"
                    filter='kind = "trademark"'
                    searchFields={['title', 'word_element']}
                    labelOf={(f) => f.title}
                    onChange={(id) => {
                      if (id !== '') void linkFamily(id);
                    }}
                  />
                )}
              </div>
            ) : (
              <>
                <a href={href('family', family.id)} className="text-lg font-semibold leading-tight hover:underline">
                  {family.title}
                </a>
                {family.mark_image !== '' && (
                  <img src={fileUrl(family, family.mark_image, '400x0')} alt={`${family.title} mark`} className="max-h-28 w-fit border border-[var(--agent-app-border)] bg-white object-contain p-1" />
                )}
                <Line label="Word element">{family.word_element || family.title}</Line>
                <Line label="Classes across your registrations">
                  {gs.loading && gs.records.length === 0 ? <span className="text-[var(--agent-app-muted)]">Loading...</span> : <ClassChips classes={ours} shared={shared} />}
                </Line>
                <Line label="Jurisdictions">
                  {liveMatters.length === 0 ? (
                    <span className="text-[var(--agent-app-muted)]">{matters.loading ? 'Loading...' : 'No live filings'}</span>
                  ) : (
                    <span className="flex flex-col gap-1">
                      {liveMatters.map((m) => (
                        <a key={m.id} href={href('matter', m.id)} className="flex items-center gap-2 hover:underline">
                          <JurChip code={m.jurisdiction} />
                          <Ref>{m.ref}</Ref>
                          <span className="text-xs text-[var(--agent-app-muted)]">{STATUS_LABEL[m.status]}</span>
                        </a>
                      ))}
                    </span>
                  )}
                </Line>
                {can.edit && (
                  <button type="button" className="w-fit text-xs text-[var(--agent-app-muted)] hover:underline" onClick={() => void linkFamily('')}>
                    Not this mark? Unlink it
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Their application</div>
            <div className="text-lg font-semibold leading-tight">{hit.their_mark}</div>
            <Line label="Owner">{hit.their_owner || <span className="text-[var(--agent-app-muted)]">Not given</span>}</Line>
            <div className="grid grid-cols-2 gap-3">
              <Line label="Jurisdiction">
                {hit.jurisdiction !== '' ? (
                  <span className="flex items-center gap-2">
                    <JurChip code={hit.jurisdiction} />
                    <span className="truncate">{jurisdictionName(hit.jurisdiction)}</span>
                  </span>
                ) : (
                  <span className="text-[var(--agent-app-muted)]">Not given</span>
                )}
              </Line>
              <Line label="Application no.">{hit.application_no !== '' ? <span className="font-mono">{hit.application_no}</span> : <span className="text-[var(--agent-app-muted)]">Not given</span>}</Line>
            </div>
            <Line label="Classes">
              <ClassChips classes={theirs} shared={shared} />
            </Line>
            <Line label="Goods and services">{hit.goods !== '' ? <Prose className="max-h-40 overflow-y-auto">{hit.goods}</Prose> : <span className="text-[var(--agent-app-muted)]">Not given</span>}</Line>
            <div className="grid grid-cols-2 gap-3">
              <Line label="Published">{fmtDate(hit.publication_date) || <span className="text-[var(--agent-app-muted)]">Not given</span>}</Line>
              <Line label="Oppose by">
                <DeadlineCell day={hit.opposition_deadline} />
              </Line>
            </div>
          </div>
        </div>

        {family !== undefined && (
          <Notice tone={shared.size > 0 ? 'warn' : 'neutral'}>
            {shared.size > 0
              ? `Classes in common: ${[...shared].join(', ')}. Overlapping classes raise the risk of confusion.`
              : theirs.length === 0 || ours.length === 0
                ? 'Classes cannot be compared: one side has none on file.'
                : 'No classes in common. Check whether the goods are still related.'}
          </Notice>
        )}

        {can.edit && (
          <div className="flex flex-col gap-3 border-t border-[var(--agent-app-border)] pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Decide</div>
            <div className="flex flex-wrap gap-2">
              {statusButtons.map((b) => (
                <Button key={b.status} size="sm" variant={hit.status === b.status ? 'secondary' : 'outline'} disabled={busy || hit.status === b.status} onClick={() => void setStatus(b.status)}>
                  {b.label}
                </Button>
              ))}
              <Button size="sm" variant={hit.status === 'actioned' ? 'secondary' : 'outline'} disabled={busy} onClick={() => setActionOpen((o) => !o)}>
                Mark actioned
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void openDispute()}>
                <Scale size={13} aria-hidden /> Open a dispute
              </Button>
            </div>
            {actionOpen && (
              <div className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-3">
                <div className="flex flex-wrap gap-1.5">
                  {ACTION_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setActionText(s)}
                      className={cn(
                        'border px-2 py-0.5 text-xs',
                        actionText === s ? 'border-[var(--agent-app-accent)] text-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Input label="What was done" value={actionText} maxLength={300} onChange={(e) => setActionText(e.target.value)} placeholder="For example: Opposition filed" />
                  <Button
                    className="shrink-0"
                    disabled={busy || actionText.trim() === ''}
                    onClick={() =>
                      void setStatus('actioned', { action: actionText.trim() }).then((ok) => {
                        if (ok) setActionOpen(false);
                      })
                    }
                  >
                    Save as actioned
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-[var(--agent-app-border)] pt-4">
          {can.edit ? (
            <>
              <Field label="Notes" htmlFor="hit-notes">
                <Textarea id="hit-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reasoning, advice from counsel, next steps" />
              </Field>
              <div className="flex items-center justify-between gap-2">
                {can.manage ? (
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void remove()}>
                    <Trash2 size={13} aria-hidden /> Delete
                  </Button>
                ) : (
                  <span />
                )}
                <Button size="sm" variant="outline" disabled={notes === hit.notes} onClick={() => void saveNotes()}>
                  Save notes
                </Button>
              </div>
            </>
          ) : (
            <Line label="Notes">{hit.notes !== '' ? <Prose>{hit.notes}</Prose> : <span className="text-[var(--agent-app-muted)]">No notes</span>}</Line>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Import a watch report                                               */
/* ------------------------------------------------------------------ */

type WatchField =
  | 'their_mark'
  | 'their_owner'
  | 'jurisdiction'
  | 'application_no'
  | 'classes'
  | 'goods'
  | 'publication_date'
  | 'opposition_deadline'
  | 'score'
  | 'our_mark'
  | 'source';

const WATCH_FIELDS: { key: WatchField; label: string; help?: string }[] = [
  { key: 'their_mark', label: 'Their mark', help: 'Required' },
  { key: 'their_owner', label: 'Owner' },
  { key: 'jurisdiction', label: 'Jurisdiction', help: 'Two-letter office code, such as US, EM, JP' },
  { key: 'application_no', label: 'Application number' },
  { key: 'classes', label: 'Classes' },
  { key: 'goods', label: 'Goods and services' },
  { key: 'publication_date', label: 'Publication date' },
  { key: 'opposition_deadline', label: 'Opposition deadline' },
  { key: 'score', label: 'Similarity score', help: '0 to 100' },
  { key: 'our_mark', label: 'Our mark', help: 'Matched to your trademark families by exact title' },
  { key: 'source', label: 'Source' },
];

function normHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function autoMap(headers: string[]): Record<WatchField, number> {
  const out = {} as Record<WatchField, number>;
  for (const f of WATCH_FIELDS) {
    const targets = [normHeader(f.key), normHeader(f.label)];
    out[f.key] = headers.findIndex((h) => targets.includes(normHeader(h)));
  }
  return out;
}

function ImportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<WatchField, number> | null>(null);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  const parsed = useMemo(() => parseCsv(text), [text]);
  const headers = parsed[0] ?? [];
  const data = parsed.slice(1);
  const map = mapping ?? autoMap(headers);

  const load = (t: string): void => {
    setText(t);
    setMapping(autoMap(parseCsv(t)[0] ?? []));
    setResult(null);
  };

  const build = (): Record<string, string>[] =>
    data
      .map((row) => {
        const o: Record<string, string> = {};
        for (const f of WATCH_FIELDS) {
          const idx = map[f.key];
          if (idx >= 0) o[f.key] = (row[idx] ?? '').trim();
        }
        if ((o['source'] ?? '') === '' && source.trim() !== '') o['source'] = source.trim();
        return o;
      })
      .filter((o) => Object.values(o).some((v) => v !== ''));

  const submit = async (): Promise<void> => {
    if (map.their_mark < 0) {
      toast.error('Choose the column that holds their mark.');
      return;
    }
    const rows = build();
    if (rows.length === 0) {
      toast.error('No rows to import.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ created: number; errors: string[] }>('import/watch', { rows });
      setResult(r);
      toast.success(`Imported ${plural(r.created, 'watch hit')}`);
      if (r.errors.length > 0) toast.error(`${plural(r.errors.length, 'row')} skipped`);
      else onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const mapped = WATCH_FIELDS.filter((f) => map[f.key] >= 0);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Import a watch report"
      description="Paste the report or upload the CSV your watch provider sent. Match its columns, check the preview, then import. Every hit starts as New."
      className="w-[min(94vw,52rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {result !== null ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={data.length === 0 || map.their_mark < 0}>
            Import {data.length > 0 ? plural(data.length, 'row') : ''}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="CSV text" htmlFor="watch-csv">
            <Textarea
              id="watch-csv"
              rows={4}
              className="font-mono text-[12px]"
              value={text}
              onChange={(e) => load(e.target.value)}
              placeholder={'their_mark,their_owner,jurisdiction,application_no,classes,opposition_deadline\nSTARFALLEN,Nova Toys Ltd,EM,018912345,"9, 28",2026-12-01'}
            />
          </Field>
          <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 border border-[var(--agent-app-border)] px-3 text-sm font-medium hover:bg-[var(--agent-app-hover)]">
            <FileUp size={14} aria-hidden /> {fileName !== '' ? fileName : 'Upload CSV'}
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                void f.text().then(load);
              }}
            />
          </label>
        </div>

        {headers.length > 0 && (
          <>
            <div>
              <div className="mb-2 text-[13px] font-medium">Match the columns</div>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {WATCH_FIELDS.map((f) => (
                  <Select
                    key={f.key}
                    label={`${f.label}${f.help !== undefined ? ` (${f.help})` : ''}`}
                    value={String(map[f.key])}
                    options={[{ value: '-1', label: 'Not in the file' }, ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }))]}
                    onChange={(e) => setMapping({ ...map, [f.key]: Number(e.target.value) })}
                  />
                ))}
              </div>
            </div>
            {map.source < 0 && (
              <Input label="Report source (applied to every row)" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Name of the watch provider and report date" />
            )}
            {map.their_mark < 0 && <Notice tone="bad">Choose the column that holds their mark. It is the only required column.</Notice>}
            {mapped.length > 0 && data.length > 0 && (
              <div>
                <div className="mb-2 text-[13px] font-medium">
                  Preview <span className="font-normal text-[var(--agent-app-muted)]">(first {Math.min(5, data.length)} of {plural(data.length, 'row')})</span>
                </div>
                <div className="overflow-x-auto border border-[var(--agent-app-border)]">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                        {mapped.map((f) => (
                          <th key={f.key} className="whitespace-nowrap px-2.5 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                          {mapped.map((f) => (
                            <td key={f.key} className="max-w-48 truncate px-2.5 py-1.5">
                              {row[map[f.key]] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {result !== null && result.errors.length > 0 && (
          <Notice tone="warn">
            <div className="font-medium">
              {plural(result.created, 'hit')} imported, {plural(result.errors.length, 'row')} skipped:
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Add a hit by hand                                                   */
/* ------------------------------------------------------------------ */

function AddHitDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings } = useApp();
  const [f, setF] = useState({
    their_mark: '',
    their_owner: '',
    jurisdiction: '',
    application_no: '',
    classes: '',
    goods: '',
    publication_date: '',
    opposition_deadline: '',
    score: '',
    source: '',
    notes: '',
  });
  const [family, setFamily] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string): void => setF((cur) => ({ ...cur, [k]: v }));

  const submit = async (): Promise<void> => {
    if (f.their_mark.trim() === '') {
      toast.error('Enter their mark.');
      return;
    }
    setBusy(true);
    try {
      await createRecord('watch_hits', {
        their_mark: f.their_mark.trim(),
        their_owner: f.their_owner.trim(),
        jurisdiction: f.jurisdiction,
        application_no: f.application_no.trim(),
        classes: parseClasses(f.classes).join(', '),
        goods: f.goods.trim(),
        publication_date: toPb(f.publication_date),
        opposition_deadline: toPb(f.opposition_deadline),
        score: f.score.trim() === '' ? 0 : Math.max(0, Math.min(100, Number(f.score) || 0)),
        source: f.source.trim() || 'Added by hand',
        notes: f.notes.trim(),
        family,
        status: 'new',
      });
      toast.success('Watch hit added');
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a watch hit"
      description="Record a conflicting application you found yourself or that a provider reported outside a CSV."
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={f.their_mark.trim() === ''}>
            Add hit
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Their mark" value={f.their_mark} maxLength={300} onChange={(e) => set('their_mark', e.target.value)} />
          <Input label="Owner" value={f.their_owner} maxLength={300} onChange={(e) => set('their_owner', e.target.value)} />
          <JurisdictionSelect label="Jurisdiction" value={f.jurisdiction} onChange={(v) => set('jurisdiction', v)} preferred={settings?.jurisdictions ?? undefined} />
          <Input label="Application number" value={f.application_no} maxLength={80} onChange={(e) => set('application_no', e.target.value)} />
          <Input label="Classes" value={f.classes} placeholder="For example: 9, 41" onChange={(e) => set('classes', e.target.value)} />
          <Input label="Similarity score (0 to 100)" type="number" min={0} max={100} value={f.score} onChange={(e) => set('score', e.target.value)} />
          <Input label="Published on" type="date" value={f.publication_date} onChange={(e) => set('publication_date', e.target.value)} />
          <Input label="Oppose by" type="date" value={f.opposition_deadline} onChange={(e) => set('opposition_deadline', e.target.value)} />
        </div>
        <Textarea label="Goods and services" rows={2} value={f.goods} onChange={(e) => set('goods', e.target.value)} />
        <RecordPicker<FamilyRec>
          collection="families"
          value={family}
          onChange={(id) => setFamily(id)}
          label="Our mark"
          filter='kind = "trademark"'
          searchFields={['title', 'word_element']}
          labelOf={(x) => x.title}
          placeholder="Search your trademarks"
        />
        <Input label="Source" value={f.source} maxLength={120} placeholder="Watch provider, gazette, customer tip" onChange={(e) => set('source', e.target.value)} />
        <Textarea label="Notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}
