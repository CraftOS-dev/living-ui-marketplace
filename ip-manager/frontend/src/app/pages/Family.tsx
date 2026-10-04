/**
 * A patent or design family, or a mark: every filing across offices with
 * their parent links, a shared timeline, class-by-country coverage for
 * marks, documents, and the deadlines across all members.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CornerDownRight, FolderTree, Grid3x3, Pencil, Plus } from 'lucide-react';
import { Button, Card, CardContent, cn, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { fileUrl, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, plural, relLabel, today } from '../lib/format.ts';
import { MARK_TYPE_LABEL, STATUS_LABEL, STATUS_ORDER, statusTone } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { DeadlineRec, FamilyRec, GoodsServicesRec, MatterRec } from '../lib/types.ts';
import { Timeline } from '../components/charts.tsx';
import type { TimelineMarker, TimelineRow, TimelineSegment } from '../components/charts.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { FamilyEditDialog, NewMatterDialog } from '../components/matterDialogs.tsx';
import {
  CLASS_STATUS_LABEL,
  CLASS_STATUS_TONE,
  FAMILY_KIND_LABEL,
  NICE_HEADING,
  STRATEGY_LABEL,
  STRATEGY_TONE,
  classesOf,
  routeText,
} from '../components/matterShared.tsx';
import { EmptyHint, ErrorBox, Fact, FactGrid, JurChip, Loading, Pill, Prose, Ref, Section, Segmented, TONE_DOT, TONE_TEXT, Tag } from '../components/ui.tsx';

export function FamilyPage({ id }: { id: string }): React.JSX.Element {
  const { record, loading, error } = useRecord<FamilyRec>('families', id === '' ? null : id);
  if (id === '') {
    return (
      <Card>
        <EmptyHint icon={FolderTree} title="No family chosen" message="Open a family or a mark from a portfolio list." action={<Button onClick={() => navigate('patents')}>Open patents</Button>} />
      </Card>
    );
  }
  if (loading && record === null) return <Loading label="Loading the family" />;
  if (record === null) {
    return (
      <Card>
        <EmptyHint
          icon={FolderTree}
          title="This family is not available"
          message={error !== null ? 'It may have been deleted, or you may not have access to it.' : 'It may have been deleted.'}
          action={<Button onClick={() => navigate('patents')}>Back to the portfolio</Button>}
        />
      </Card>
    );
  }
  return <FamilyView f={record} />;
}

/** Members in parent-then-child order with their depth under the root filing. */
function treeOrder(members: MatterRec[]): { m: MatterRec; depth: number }[] {
  const ids = new Set(members.map((m) => m.id));
  const kids = new Map<string, MatterRec[]>();
  const roots: MatterRec[] = [];
  for (const m of members) {
    if (m.parent !== '' && ids.has(m.parent) && m.parent !== m.id) {
      const arr = kids.get(m.parent) ?? [];
      arr.push(m);
      kids.set(m.parent, arr);
    } else roots.push(m);
  }
  const byDate = (a: MatterRec, b: MatterRec): number => {
    const fa = d10(a.filing_date) || '9999';
    const fb = d10(b.filing_date) || '9999';
    return fa.localeCompare(fb) || a.ref.localeCompare(b.ref);
  };
  const out: { m: MatterRec; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (m: MatterRec, depth: number): void => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    out.push({ m, depth });
    for (const c of (kids.get(m.id) ?? []).sort(byDate)) walk(c, depth + 1);
  };
  for (const r of roots.sort(byDate)) walk(r, 0);
  // Anything left (a parent loop) is listed at the top level.
  for (const m of members) if (!seen.has(m.id)) walk(m, 0);
  return out;
}

function FamilyView({ f }: { f: FamilyRec }): React.JSX.Element {
  const { can, vocab, propertyName } = useApp();
  const members = useCollection<MatterRec>('matters', { filter: `family = ${q(f.id)}`, sort: 'ref' });
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `matter.family = ${q(f.id)}`, sort: 'due_date' });
  const goods = useCollection<GoodsServicesRec>('goods_services', {
    filter: f.kind === 'trademark' ? `matter.family = ${q(f.id)}` : 'id = "__none__"',
    sort: 'nice_class',
  });
  const { actions, dialogs } = useDeadlineActions();
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dlScope, setDlScope] = useState<'open' | 'all'>('open');

  const mark = f.kind === 'trademark';
  const ordered = useMemo(() => treeOrder(members.records), [members.records]);
  const depthOf = useMemo(() => new Map(ordered.map((x) => [x.m.id, x.depth])), [ordered]);
  const rows = useMemo(() => ordered.map((x) => x.m), [ordered]);
  const counts = useMemo(() => {
    const c = { live: 0, pending: 0, pre_filing: 0, dead: 0 };
    for (const m of members.records) c[m.status_group] += 1;
    return c;
  }, [members.records]);
  const offices = new Set(members.records.map((m) => m.jurisdiction)).size;
  const openDeadlines = deadlines.records.filter((d) => d.status === 'open');
  const shownDeadlines = dlScope === 'open' ? openDeadlines : deadlines.records;

  const columns = useMemo(
    (): Col<MatterRec>[] => [
      {
        key: 'ref',
        label: 'Ref',
        value: (m) => m.ref,
        render: (m) => {
          const depth = depthOf.get(m.id) ?? 0;
          return (
            <a
              href={href('matter', m.id)}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 whitespace-nowrap hover:underline"
              style={{ paddingLeft: depth * 16 }}
            >
              {depth > 0 && <CornerDownRight size={12} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />}
              <Ref dead={m.status_group === 'dead'}>{m.ref}</Ref>
            </a>
          );
        },
      },
      { key: 'jurisdiction', label: 'Office', value: (m) => m.jurisdiction, render: (m) => <JurChip code={m.jurisdiction} /> },
      {
        key: 'route',
        label: 'Route',
        value: (m) => routeText(m),
        render: (m) => <span className="whitespace-nowrap text-xs text-[var(--agent-app-muted)]">{routeText(m) || '-'}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        value: (m) => STATUS_ORDER.indexOf(m.status),
        render: (m) => <Pill tone={statusTone(m.status, m.status_group)}>{STATUS_LABEL[m.status]}</Pill>,
      },
      {
        key: 'application_no',
        label: 'Application no.',
        value: (m) => m.application_no,
        render: (m) => <span className="whitespace-nowrap font-mono text-xs">{m.application_no || '-'}</span>,
      },
      { key: 'filing_date', label: 'Filed', value: (m) => d10(m.filing_date), render: (m) => <DateText v={m.filing_date} /> },
      {
        key: 'registration_date',
        label: f.kind === 'patent' ? 'Granted' : 'Registered',
        value: (m) => d10(m.registration_date),
        render: (m) => <DateText v={m.registration_date} />,
      },
      { key: 'expiry_date', label: 'Expires', value: (m) => d10(m.expiry_date), render: (m) => <DateText v={m.expiry_date} /> },
      {
        key: 'next_deadline',
        label: 'Next deadline',
        value: (m) => d10(m.next_deadline),
        render: (m) => {
          const d = d10(m.next_deadline);
          if (d === '') return <span className="text-[var(--agent-app-muted)]">-</span>;
          const n = daysUntil(d);
          return (
            <div className="min-w-0 max-w-[15rem]">
              <div className={cn('whitespace-nowrap tabular-nums', n < 0 ? TONE_TEXT.bad : n <= 30 ? TONE_TEXT.warn : '')}>
                {fmtDate(d)} <span className="text-xs text-[var(--agent-app-muted)]">{relLabel(d)}</span>
              </div>
              <div className="truncate text-xs text-[var(--agent-app-muted)]" title={m.next_deadline_title}>
                {m.next_deadline_title}
              </div>
            </div>
          );
        },
      },
      { key: 'title', label: 'Title', optional: true, value: (m) => m.title },
      { key: 'registration_no', label: 'Registration no.', optional: true, value: (m) => m.registration_no },
      { key: 'owner_of_record', label: 'Owner of record', optional: true, value: (m) => m.owner_of_record },
    ],
    [depthOf, f.kind],
  );

  const timelineRows = useMemo((): TimelineRow[] => {
    const now = today();
    return ordered.map(({ m, depth }) => {
      const filing = d10(m.filing_date);
      const reg = d10(m.registration_date);
      const exp = d10(m.expiry_date);
      const dead = m.status_group === 'dead';
      const deadEnd = d10(m.status_date) !== '' ? d10(m.status_date) : now;
      const segments: TimelineSegment[] = [];
      if (filing !== '') {
        const end = reg !== '' ? reg : dead ? deadEnd : now;
        if (end >= filing) segments.push({ start: filing, end, className: dead ? 'bg-[var(--agent-app-border)]' : 'bg-sky-500/25', title: `${m.ref} pending: ${fmtDate(filing)} to ${fmtDate(end)}` });
      }
      if (reg !== '') {
        const end = dead ? (exp !== '' && exp < deadEnd ? exp : deadEnd) : exp !== '' ? exp : now;
        if (end >= reg) segments.push({ start: reg, end, className: dead ? 'bg-[var(--agent-app-border)]' : 'bg-emerald-500/25', title: `${m.ref} ${dead ? 'was in force' : 'in force'}: ${fmtDate(reg)} to ${fmtDate(end)}` });
      }
      const markers: TimelineMarker[] = [
        ...(m.priority_claims ?? []).filter((p) => d10(p.date) !== '').map((p) => ({ date: d10(p.date), label: `Priority ${p.country} ${p.number}`, className: 'bg-[var(--agent-app-muted)]' })),
        ...(d10(m.next_deadline) !== '' ? [{ date: d10(m.next_deadline), label: m.next_deadline_title || 'Next deadline', className: 'bg-amber-500' }] : []),
      ];
      return {
        key: m.id,
        label: (
          <a href={href('matter', m.id)} className="flex items-center gap-1.5 hover:underline" style={{ paddingLeft: depth * 10 }}>
            <JurChip code={m.jurisdiction} />
            <Ref dead={m.status_group === 'dead'}>{m.ref}</Ref>
          </a>
        ),
        segments,
        markers,
      };
    });
  }, [ordered]);
  const hasDates = timelineRows.some((r) => r.segments.length > 0);

  const newIpType = f.kind;
  const tags = f.technology_tags ?? [];
  const facts: { label: string; value: ReactNode; mono?: boolean; wide?: boolean }[] = [
    ...(mark && f.mark_type !== '' ? [{ label: 'Mark type', value: MARK_TYPE_LABEL[f.mark_type] ?? f.mark_type }] : []),
    ...(mark && f.word_element !== '' ? [{ label: 'Word element', value: f.word_element }] : []),
    ...(mark && f.vienna_codes !== '' ? [{ label: 'Vienna codes', value: f.vienna_codes, mono: true }] : []),
    ...(mark && f.transliteration !== '' ? [{ label: 'Transliteration', value: f.transliteration }] : []),
    ...(mark && f.translation !== '' ? [{ label: 'Translation', value: f.translation }] : []),
    ...(!mark && tags.length > 0
      ? [
          {
            label: 'Technology',
            wide: true,
            value: (
              <span className="flex flex-wrap gap-1 whitespace-normal">
                {tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </span>
            ),
          },
        ]
      : []),
    ...(f.products !== '' ? [{ label: 'Products', value: f.products }] : []),
    ...(f.business_unit !== '' ? [{ label: 'Business unit', value: f.business_unit }] : []),
    ...(f.owner_entity !== '' ? [{ label: 'Owner entity', value: f.owner_entity }] : []),
  ];

  return (
    <div>
      {dialogs}

      {/* Header */}
      <Card className="mb-5">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 basis-72 gap-4">
              {mark && <MarkPanel f={f} />}
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{FAMILY_KIND_LABEL[f.kind]}</div>
                <h1 className="mt-1 text-xl font-semibold tracking-tight">{f.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
                  {f.strategy !== '' ? (
                    <Pill tone={STRATEGY_TONE[f.strategy] ?? 'neutral'}>{STRATEGY_LABEL[f.strategy] ?? f.strategy}</Pill>
                  ) : (
                    <span className="text-xs text-[var(--agent-app-muted)]">No strategy set</span>
                  )}
                  {f.property !== '' && (
                    <a href={href('property', f.property)} className="text-[var(--agent-app-text)]/85 hover:underline">
                      <span className="text-[var(--agent-app-muted)]">{vocab.property}: </span>
                      {propertyName(f.property) || 'Open'}
                    </a>
                  )}
                  {members.records.length > 0 && (
                    <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">
                      {plural(members.records.length, 'filing')} in {plural(offices, 'office')}: {counts.live} in force, {counts.pending} pending
                      {counts.pre_filing > 0 ? `, ${counts.pre_filing} not filed` : ''}
                      {counts.dead > 0 ? `, ${counts.dead} dead` : ''}
                    </span>
                  )}
                </div>
                {f.strategy_note !== '' && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--agent-app-text)]/85">{f.strategy_note}</p>}
              </div>
            </div>
            {can.edit && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => setAdding(true)}>
                  <Plus size={14} aria-hidden /> Add filing
                </Button>
                <Button variant="outline" onClick={() => setEdit(true)}>
                  <Pencil size={14} aria-hidden /> Edit
                </Button>
              </div>
            )}
          </div>

          {(facts.length > 0 || (mark && f.disclaimer !== '') || f.description !== '') && (
            <div className="mt-4 border-t border-[var(--agent-app-border)] pt-4">
              {facts.length > 0 && (
                <FactGrid cols={4}>
                  {facts.map((x) => (
                    <Fact key={x.label} label={x.label} value={x.value} mono={x.mono} className={x.wide === true ? 'col-span-2' : undefined} />
                  ))}
                </FactGrid>
              )}
              {mark && f.disclaimer !== '' && (
                <p className="mt-3 text-[13px]">
                  <span className="text-[var(--agent-app-muted)]">Disclaimer: </span>
                  {f.disclaimer}
                </p>
              )}
              {f.description !== '' && <Prose className="mt-3 max-w-3xl text-[var(--agent-app-text)]/85">{f.description}</Prose>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-5">
        <Section title="Members" meta={members.records.length > 0 ? String(members.records.length) : undefined} flush>
          {members.error !== null ? (
            <div className="p-4">
              <ErrorBox message={members.error} onRetry={members.refresh} />
            </div>
          ) : members.loading && members.records.length === 0 ? (
            <Loading />
          ) : (
            <DataTable<MatterRec>
              tableId={`family-members-${f.kind}`}
              rows={rows}
              columns={columns}
              exportName={`${f.title} filings`}
              onRowClick={(m) => navigate('matter', m.id)}
              rowClassName={(m) => (m.status_group === 'dead' ? 'opacity-70' : '')}
              empty={
                <EmptyHint
                  compact
                  icon={FolderTree}
                  title="No filings yet"
                  message={mark ? 'Add the trademark filings for this mark, one per office.' : 'Add the applications of this family, one per office.'}
                  action={
                    can.edit ? (
                      <Button size="sm" onClick={() => setAdding(true)}>
                        Add filing
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          )}
        </Section>

        {members.records.length > 0 && (
          <Section title="Timeline">
            {hasDates ? (
              <div className="flex flex-col gap-3">
                <Timeline rows={timelineRows} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--agent-app-muted)]">
                  <Legend className="h-2.5 w-4 bg-sky-500/25" label="Pending" />
                  <Legend className="h-2.5 w-4 bg-emerald-500/25" label="In force" />
                  <Legend className="h-2.5 w-4 bg-[var(--agent-app-border)]" label="Ended" />
                  <Legend className="size-2 rotate-45 bg-amber-500" label="Next deadline" />
                  <Legend className="size-2 rotate-45 bg-[var(--agent-app-muted)]" label="Priority date" />
                  <Legend className="h-2.5 w-px bg-[var(--agent-app-accent)]" label="Today" />
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-[var(--agent-app-muted)]">No filing or registration dates recorded yet. They appear here as the members are filed.</p>
            )}
          </Section>
        )}

        {mark && <CoverageSection members={members.records} goods={goods.records} loading={goods.loading} />}

        <Section
          title="Deadlines across members"
          meta={deadlines.records.length > 0 ? `${openDeadlines.length} open` : undefined}
          flush
          actions={
            deadlines.records.length > openDeadlines.length ? (
              <Segmented
                size="sm"
                value={dlScope}
                ariaLabel="Which deadlines"
                options={[
                  { value: 'open', label: 'Open' },
                  { value: 'all', label: 'All' },
                ]}
                onChange={setDlScope}
              />
            ) : undefined
          }
        >
          {deadlines.error !== null ? (
            <div className="p-4">
              <ErrorBox message={deadlines.error} onRetry={deadlines.refresh} />
            </div>
          ) : deadlines.loading && deadlines.records.length === 0 ? (
            <Loading />
          ) : (
            <DeadlineList
              deadlines={shownDeadlines}
              actions={can.edit ? actions : null}
              empty={
                <EmptyHint
                  compact
                  icon={FolderTree}
                  title={deadlines.records.length > 0 ? 'Nothing open' : 'No deadlines'}
                  message={
                    deadlines.records.length > 0
                      ? 'Every deadline of this family is closed. Pick All to see them.'
                      : 'Deadlines appear when events are recorded on the members.'
                  }
                />
              }
            />
          )}
        </Section>

        <DocumentsPanel relation="family" relationId={f.id} title={mark ? 'Documents for the mark' : 'Family documents'} />
      </div>

      {edit && <FamilyEditDialog family={f} onClose={() => setEdit(false)} />}
      {adding && (
        <NewMatterDialog
          ipType={newIpType}
          heading={`Add a filing to ${f.title}`}
          defaults={{ family: f.id, property: f.property, title: mark ? f.word_element || f.title : f.title }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function DateText({ v }: { v: string }): React.JSX.Element {
  return d10(v) !== '' ? <span className="whitespace-nowrap tabular-nums">{fmtDate(v)}</span> : <span className="text-[var(--agent-app-muted)]">-</span>;
}

function Legend({ className, label }: { className: string; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block', className)} aria-hidden />
      {label}
    </span>
  );
}

function MarkPanel({ f }: { f: FamilyRec }): React.JSX.Element {
  if (f.mark_image !== '') {
    return (
      <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] p-1.5 sm:size-28">
        <img src={fileUrl(f, f.mark_image, '400x0')} alt={`${f.title} mark`} className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  const word = f.word_element || f.title;
  return (
    <span className="flex min-h-20 max-w-[8rem] shrink-0 items-center justify-center break-words border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] px-3 py-3 text-center text-sm font-semibold leading-tight tracking-wide sm:min-h-28 sm:max-w-[12rem] sm:px-4 sm:text-lg">
      {word}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Coverage: classes x offices                                         */
/* ------------------------------------------------------------------ */

const CLASS_RANK: Record<string, number> = { registered: 0, pending: 1, partially_refused: 2, '': 3, refused: 4, cancelled: 5, deleted: 6 };

interface Cell {
  g: GoodsServicesRec;
  m: MatterRec;
  tone: Tone;
  text: string;
}

function CoverageSection({ members, goods, loading }: { members: MatterRec[]; goods: GoodsServicesRec[]; loading: boolean }): React.JSX.Element {
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const jurs = useMemo(() => [...new Set(members.map((m) => m.jurisdiction.toUpperCase()))].sort((a, b) => (a === 'WO' ? 1 : b === 'WO' ? -1 : a.localeCompare(b))), [members]);
  const classes = useMemo(() => classesOf(goods), [goods]);

  const cells = useMemo(() => {
    const map = new Map<string, Cell>();
    for (const g of goods) {
      const m = byId.get(g.matter);
      if (m === undefined) continue;
      const key = `${g.nice_class}|${m.jurisdiction.toUpperCase()}`;
      const dead = m.status_group === 'dead';
      const rank = (dead ? 10 : 0) + (CLASS_RANK[g.class_status] ?? 3);
      const cur = map.get(key);
      const curRank = cur === undefined ? 99 : (cur.m.status_group === 'dead' ? 10 : 0) + (CLASS_RANK[cur.g.class_status] ?? 3);
      if (rank >= curRank) continue;
      const tone: Tone = dead ? 'neutral' : g.class_status !== '' ? (CLASS_STATUS_TONE[g.class_status] ?? 'neutral') : statusTone(m.status, m.status_group);
      const text = dead ? `${STATUS_LABEL[m.status]} (right ended)` : g.class_status !== '' ? (CLASS_STATUS_LABEL[g.class_status] ?? g.class_status) : STATUS_LABEL[m.status];
      map.set(key, { g, m, tone, text });
    }
    return map;
  }, [goods, byId]);

  return (
    <Section title="Coverage" meta={classes.length > 0 ? `${plural(classes.length, 'class', 'classes')} in ${plural(jurs.length, 'office')}` : undefined} flush>
      {loading && goods.length === 0 ? (
        <Loading />
      ) : classes.length === 0 ? (
        <EmptyHint
          compact
          icon={Grid3x3}
          title="No classes recorded"
          message="Add the classes on each trademark's Goods and services tab to see where the mark is covered."
        />
      ) : (
        <div className="flex flex-col gap-3 pb-3">
          <div className="overflow-x-auto">
            <table className="border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                  <th className="sticky left-0 z-10 bg-[var(--agent-app-surface)] px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                    Class
                  </th>
                  {jurs.map((j) => (
                    <th key={j} className="px-2 py-2 text-center">
                      <JurChip code={j} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                    <th scope="row" className="sticky left-0 z-10 bg-[var(--agent-app-surface)] px-4 py-1.5 text-left font-normal">
                      <div className="flex w-[14rem] items-baseline gap-2 sm:w-[18rem]" title={NICE_HEADING[c]}>
                        <span className="w-6 shrink-0 font-mono font-semibold tabular-nums">{c}</span>
                        <span className="min-w-0 truncate text-xs text-[var(--agent-app-muted)]">{NICE_HEADING[c] ?? ''}</span>
                      </div>
                    </th>
                    {jurs.map((j) => {
                      const cell = cells.get(`${c}|${j}`);
                      return (
                        <td key={j} className="px-2 py-1.5 text-center">
                          {cell !== undefined ? (
                            <button
                              type="button"
                              title={`Class ${c} in ${j}: ${cell.text} (${cell.m.ref})`}
                              aria-label={`Class ${c} in ${j}: ${cell.text}`}
                              onClick={() => navigate('matter', cell.m.id, { tab: 'goods' })}
                              className="inline-flex size-6 items-center justify-center hover:bg-[var(--agent-app-border)]/40"
                            >
                              <span className={cn('inline-block size-3.5', TONE_DOT[cell.tone])} />
                            </button>
                          ) : (
                            <span className="text-[var(--agent-app-muted)]" title={`Class ${c} not covered in ${j}`}>
                              ·
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 text-xs text-[var(--agent-app-muted)]">
            <CoverageLegend tone="good" label="Registered" />
            <CoverageLegend tone="info" label="Pending" />
            <CoverageLegend tone="warn" label="Partly refused" />
            <CoverageLegend tone="bad" label="Refused" />
            <CoverageLegend tone="neutral" label="Ended, deleted or cancelled" />
          </div>
        </div>
      )}
    </Section>
  );
}

function CoverageLegend({ tone, label }: { tone: Tone; label: ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-2.5', TONE_DOT[tone])} aria-hidden />
      {label}
    </span>
  );
}
