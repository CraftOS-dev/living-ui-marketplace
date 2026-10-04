/**
 * Inventions: inventors see and submit their own; the IP team works the
 * pipeline as a board (submitted to filed) or a list, moves cards with a
 * decision note where the inventor needs one, and watches grace periods.
 */
import { useMemo, useState } from 'react';
import { ArrowRightLeft, ChevronDown, Lightbulb, Plus } from 'lucide-react';
import { Button, DropdownMenu } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysBetween, fmtDate, plural, today } from '../lib/format.ts';
import { DISCLOSURE_STAGE_LABEL, DISCLOSURE_STAGE_TONE, IP_TYPE_LABEL } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { DisclosureStage } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { EmptyHint, ErrorBox, Loading, PageHeader, Pill, Ref, Section, Segmented, TONE_TEXT } from '../components/ui.tsx';
import {
  BOARD_STAGES,
  GraceWarning,
  MOVE_STAGES,
  NewInventionDialog,
  OTHER_BUCKETS,
  ScoreBar,
  barDate,
  graceInfo,
  inventorLabel,
  stampDay,
  useInventorNames,
  useStageMover,
} from '../components/inventShared.tsx';
import type { DisclosureX, OtherBucket } from '../components/inventShared.tsx';

export function InventionsPage(): React.JSX.Element {
  const { role, can } = useApp();
  if (role === 'inventor' || !can.read) return <MyInventions />;
  return <TeamInventions />;
}

function offBoardCount(byStage: Map<DisclosureStage, DisclosureX[]>): number {
  let n = 0;
  for (const b of Object.values(OTHER_BUCKETS)) for (const st of b.stages) n += byStage.get(st)?.length ?? 0;
  return n;
}

function sinceLabel(submittedAt: string): string {
  const d = stampDay(submittedAt);
  if (d === '') return 'Not submitted';
  const n = daysBetween(d, today());
  return n <= 0 ? 'Submitted today' : `Submitted ${plural(n, 'day')} ago`;
}

/* ------------------------------------------------------------------ */
/* Inventor view                                                       */
/* ------------------------------------------------------------------ */

function MyInventions(): React.JSX.Element {
  const { me } = useApp();
  const list = useCollection<DisclosureX>('disclosures', {
    filter: me !== null ? `(submitted_by = ${q(me.id)} || inventor_users.id ?= ${q(me.id)})` : 'id = ""',
    sort: '-created',
    expand: 'matter',
  });
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="My inventions"
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        subtitle="Describe ideas that could be protected, submit them to the IP team and follow each step here."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden /> Submit an invention
          </Button>
        }
      />
      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : list.records.length === 0 ? (
        <Section title="Your inventions" flush>
          <EmptyHint
            icon={Lightbulb}
            title="No inventions yet"
            message="Start a draft with a working title, describe how it works and attach any sketches. Submit it when it is ready and the IP team reviews it."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden /> Submit an invention
              </Button>
            }
          />
        </Section>
      ) : (
        <Section title="Your inventions" flush>
          {list.records.map((d) => {
            const matter = d.expand?.matter;
            return (
              <a
                key={d.id}
                href={href('invention', d.id)}
                className="block border-b border-[var(--agent-app-border)]/70 px-4 py-3 transition-colors last:border-0 hover:bg-[var(--agent-app-border)]/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {d.ref !== '' && <Ref>{d.ref}</Ref>}
                      <span className="text-sm font-medium">{d.title}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--agent-app-muted)]">
                      {d.stage === 'draft' ? 'Draft, not submitted yet' : `Submitted ${fmtDate(stampDay(d.submitted_at))}`}
                      {d.stage === 'draft' ? ' · open it to finish and submit' : ''}
                    </div>
                    {(d.stage === 'rejected' || d.stage === 'on_hold') && d.decision !== '' && (
                      <div className="mt-1 text-xs text-[var(--agent-app-text)]/85">
                        <span className="font-medium">Decision: </span>
                        {d.decision}
                      </div>
                    )}
                    {d.matter !== '' && (
                      <div className="mt-1 text-xs text-[var(--agent-app-text)]/85">
                        {matter !== undefined ? (
                          <>
                            Filed as <Ref>{matter.ref}</Ref> ({IP_TYPE_LABEL[matter.ip_type]})
                          </>
                        ) : (
                          'The IP team opened a filing for this invention.'
                        )}
                      </div>
                    )}
                    {d.matter === '' && <GraceWarning d={d} className="mt-1" />}
                  </div>
                  <Pill tone={DISCLOSURE_STAGE_TONE[d.stage]}>{DISCLOSURE_STAGE_LABEL[d.stage]}</Pill>
                </div>
              </a>
            );
          })}
        </Section>
      )}
      {creating && <NewInventionDialog heading="Submit an invention" onClose={() => setCreating(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* IP team view                                                        */
/* ------------------------------------------------------------------ */

function TeamInventions(): React.JSX.Element {
  const { can, userName } = useApp();
  const [view, setView] = useHashParam('view', 'board');
  const [bucketRaw, setBucket] = useHashParam('other', 'draft');
  const bucket: OtherBucket = bucketRaw in OTHER_BUCKETS ? (bucketRaw as OtherBucket) : 'draft';
  const list = useCollection<DisclosureX>('disclosures', { sort: '-created', expand: 'matter' });
  const names = useInventorNames(true);
  const mover = useStageMover(list.refresh);
  const [creating, setCreating] = useState(false);

  const byStage = useMemo(() => {
    const m = new Map<DisclosureStage, DisclosureX[]>();
    for (const d of list.records) {
      const arr = m.get(d.stage) ?? [];
      arr.push(d);
      m.set(d.stage, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => (d10(a.submitted_at) || '9999').localeCompare(d10(b.submitted_at) || '9999'));
    return m;
  }, [list.records]);

  const bucketItems = (b: OtherBucket): DisclosureX[] => OTHER_BUCKETS[b].stages.flatMap((s) => byStage.get(s) ?? []);

  const moveItems = (d: DisclosureX) =>
    MOVE_STAGES.filter((s) => s !== d.stage).map((s) => ({
      label: DISCLOSURE_STAGE_LABEL[s],
      onSelect: () => mover.request(d, s),
    }));

  const columns: Col<DisclosureX>[] = [
    { key: 'ref', label: 'Ref', render: (d) => <Ref>{d.ref}</Ref> },
    { key: 'title', label: 'Title', render: (d) => <span className="font-medium">{d.title}</span> },
    {
      key: 'stage',
      label: 'Stage',
      value: (d) => DISCLOSURE_STAGE_LABEL[d.stage],
      render: (d) => <Pill tone={DISCLOSURE_STAGE_TONE[d.stage]}>{DISCLOSURE_STAGE_LABEL[d.stage]}</Pill>,
    },
    {
      key: 'submitted_at',
      label: 'Submitted',
      value: (d) => d10(d.submitted_at),
      render: (d) => (d10(d.submitted_at) !== '' ? <span className="whitespace-nowrap tabular-nums">{fmtDate(stampDay(d.submitted_at))}</span> : <span className="text-[var(--agent-app-muted)]">Draft</span>),
    },
    { key: 'submitted_by', label: 'Submitted by', optional: true, value: (d) => userName(d.submitted_by) },
    { key: 'score', label: 'Score', align: 'right', value: (d) => (d.review_count > 0 ? d.score : ''), render: (d) => <ScoreBar score={d.score} reviews={d.review_count} /> },
    { key: 'review_count', label: 'Reviews', align: 'right' },
    { key: 'inventors', label: 'Inventors', value: (d) => inventorLabel(d, names.get(d.id)), render: (d) => <span className="line-clamp-2 max-w-64">{inventorLabel(d, names.get(d.id)) || '-'}</span> },
    {
      key: 'bar_date',
      label: 'Earliest bar date',
      value: (d) => barDate(d),
      render: (d) => {
        const g = graceInfo(d);
        if (g === null) return <span className="text-[var(--agent-app-muted)]">-</span>;
        return (
          <span className="whitespace-nowrap tabular-nums" title={`File by ${fmtDate(g.fileBy)} (US and JP grace period)`}>
            {fmtDate(g.bar)}
            {d.matter === '' && <span className={`block text-xs ${g.passed ? TONE_TEXT.bad : TONE_TEXT.warn}`}>File by {fmtDate(g.fileBy)}</span>}
          </span>
        );
      },
    },
    {
      key: 'matter',
      label: 'Filing',
      optional: true,
      value: (d) => d.expand?.matter?.ref ?? '',
      render: (d) => (d.expand?.matter !== undefined ? <Ref>{d.expand.matter.ref}</Ref> : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
  ];

  const newButton = can.contribute ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden /> New invention
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title="Inventions"
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        subtitle="Invention disclosures from submission to filing. Score them as a committee, decide, and turn approved ones into filings."
        actions={
          <>
            <Segmented
              value={view === 'list' ? 'list' : 'board'}
              options={[
                { value: 'board', label: 'Board' },
                { value: 'list', label: 'List' },
              ]}
              onChange={setView}
              ariaLabel="View"
            />
            {newButton}
          </>
        }
      />

      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : list.records.length === 0 ? (
        <Section title="Inventions" flush>
          <EmptyHint
            icon={Lightbulb}
            title="No inventions yet"
            message="Inventors submit ideas here. The IP team scores them against the committee criteria, decides, and converts approved ones into filings."
            action={newButton}
          />
        </Section>
      ) : view === 'list' ? (
        <Section title="All inventions" flush>
          <DataTable<DisclosureX>
            tableId="inventions-list"
            rows={list.records}
            columns={columns}
            exportName="inventions"
            initialSort={{ key: 'submitted_at', dir: 'desc' }}
            onRowClick={(d) => navigate('invention', d.id)}
          />
        </Section>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
            <div className="flex gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              {BOARD_STAGES.map((stage) => {
                const items = byStage.get(stage) ?? [];
                return (
                  <div key={stage} className="flex w-[16.5rem] shrink-0 flex-col border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] sm:w-auto">
                    <div className="flex items-center justify-between border-b border-[var(--agent-app-border)] px-3 py-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{DISCLOSURE_STAGE_LABEL[stage]}</span>
                      <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{items.length}</span>
                    </div>
                    <div className="flex flex-col gap-2 p-2">
                      {items.length === 0 ? (
                        <p className="px-1 py-4 text-center text-xs text-[var(--agent-app-muted)]">Nothing here</p>
                      ) : (
                        items.map((d) => (
                          <InventionCard key={d.id} d={d} inventors={inventorLabel(d, names.get(d.id))} moveItems={can.edit ? moveItems(d) : null} />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Section title="Not on the board" meta={String(offBoardCount(byStage))} flush>
            <div className="overflow-x-auto border-b border-[var(--agent-app-border)] px-4 py-2">
              <Segmented<OtherBucket>
                size="sm"
                value={bucket}
                options={(Object.keys(OTHER_BUCKETS) as OtherBucket[]).map((b) => ({
                  value: b,
                  label: `${OTHER_BUCKETS[b].label} ${bucketItems(b).length}`,
                }))}
                onChange={setBucket}
                ariaLabel="Show inventions"
              />
            </div>
            {bucketItems(bucket).length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-[var(--agent-app-muted)]">No {OTHER_BUCKETS[bucket].label.toLowerCase()}.</p>
            ) : (
              bucketItems(bucket).map((d) => (
                <div key={d.id} className="flex flex-col gap-1 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Ref>{d.ref}</Ref>
                      <a href={href('invention', d.id)} className="text-sm font-medium hover:underline">
                        {d.title}
                      </a>
                      <Pill tone={DISCLOSURE_STAGE_TONE[d.stage]}>{DISCLOSURE_STAGE_LABEL[d.stage]}</Pill>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[var(--agent-app-muted)]">
                      {userName(d.submitted_by) || 'Unknown submitter'}
                      {d.stage === 'draft' ? ` · started ${fmtDate(stampDay(d.created))}` : d10(d.decision_at) !== '' ? ` · decided ${fmtDate(stampDay(d.decision_at))}` : ''}
                      {d.decision !== '' && d.stage !== 'draft' ? ` · ${d.decision}` : ''}
                    </div>
                  </div>
                  {can.edit && (
                    <DropdownMenu
                      items={moveItems(d)}
                      trigger={
                        <Button size="sm" variant="outline" className="h-7 text-xs">
                          <ArrowRightLeft size={12} aria-hidden /> Move to...
                        </Button>
                      }
                    />
                  )}
                </div>
              ))
            )}
          </Section>
        </div>
      )}
      {mover.dialog}
      {creating && <NewInventionDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function InventionCard({
  d,
  inventors,
  moveItems,
}: {
  d: DisclosureX;
  inventors: string;
  moveItems: { label: string; onSelect: () => void }[] | null;
}): React.JSX.Element {
  const matter = d.expand?.matter;
  return (
    <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <Ref>{d.ref}</Ref>
        <ScoreBar score={d.score} reviews={d.review_count} />
      </div>
      <a href={href('invention', d.id)} className="mt-1 block text-[13px] font-medium leading-snug hover:underline">
        {d.title}
      </a>
      <div className="mt-1 truncate text-xs text-[var(--agent-app-muted)]" title={inventors || undefined}>
        {inventors || 'No inventors listed'}
      </div>
      <div className="mt-1.5 text-xs text-[var(--agent-app-muted)]">
        {sinceLabel(d.submitted_at)}
        {d.review_count > 0 ? ` · ${plural(d.review_count, 'review')}` : ''}
      </div>
      {matter !== undefined && (
        <a href={href('matter', matter.id)} className="mt-1.5 inline-flex items-center gap-1 text-xs hover:underline">
          Filed as <Ref>{matter.ref}</Ref>
        </a>
      )}
      {d.matter === '' && <GraceWarning d={d} className="mt-2" />}
      {moveItems !== null && (
        <div className="mt-2 border-t border-[var(--agent-app-border)]/70 pt-2">
          <DropdownMenu
            align="left"
            items={moveItems}
            trigger={
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
                Move to... <ChevronDown size={12} aria-hidden />
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}
