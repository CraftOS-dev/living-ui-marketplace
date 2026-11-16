/**
 * Deals: the funnel strip (this quarter's cohort: "30 inbound", then how many
 * reached each stage and the share that moved on), then the board, which
 * fills the page height (drag a card to sort it in its column or move it to
 * another; a shadow shows where it lands; a click opens the side peek) or
 * the table (saved views, column picker, scroll paging). The pipeline
 * switch shows only when the firm runs more than one pipeline. Phones get
 * the stage counts and my deals as rows with a Move to menu.
 */
import { useMemo, useState } from 'react';
import { Columns3, KanbanSquare, Lock, Plus, Rows3 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Avatar, Board, Button, DataTable, Empty, LoadError, PageBody, PageHeader, PhoneList, Segmented, Skeleton, Tag } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { CompanyLogo } from '../../components/portfolio/Logo.tsx';
import { DealCardBody, DealPeek, DealPhoneRow } from '../../components/deals/DealCard.tsx';
import { FunnelStrip } from '../../components/deals/FunnelStrip.tsx';
import { compareDeals } from '../../components/diligence/compare.ts';
import { placeDeal, useNarrow } from '../../components/deals/actions.ts';
import { DEAL_READS, roundLabel } from '../../components/deals/types.ts';
import type { BoardAnswer, DealCard, FunnelAnswer, Pipeline } from '../../components/deals/types.ts';
import { ago, money } from '../../lib/format.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { useOp } from '../../lib/live.ts';
import { go, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.ts';
import { primary } from '../../registry.ts';

type View = 'board' | 'table';
type Filter = 'active' | 'mine' | 'passed' | 'all';

/** The sidebar's Add deal (intake's dialog through the registry). */
export function addDeal(): void {
  const p = primary();
  if (p?.run !== undefined) p.run();
  else if (p?.to !== undefined) go(p.to);
}

function AddDeal({ variant = 'primary' }: { variant?: 'primary' | 'default' | undefined }): React.JSX.Element {
  return (
    <Button variant={variant} icon={Plus} onClick={addDeal}>
      Add deal
    </Button>
  );
}

function DealsTable({ pipeline, fund, onOpen }: { pipeline: string; fund: string; onOpen: (d: DealCard) => void }): React.JSX.Element {
  const me = useMe();
  const canCompare = allowed(me, 'diligence:edit');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('active');
  const [limit, setLimit] = useState(60);
  const params = { pipeline, fund: fund || undefined, status: filter === 'mine' ? 'active' : filter, point: filter === 'mine' ? 'me' : undefined, limit, sort: 'updated' };
  const live = useOp<{ deals: DealCard[]; total: number; hidden: number }>('deals.list', params, DEAL_READS, { name: 'deals.table', keep: true });
  const rows = live.data?.deals ?? [];
  const columns: Column<DealCard>[] = [
    {
      key: 'deal',
      label: 'Deal',
      width: 'minmax(200px,2.2fr)',
      fixed: true,
      phone: 'title',
      sort: (r) => r.title.toLowerCase(),
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <CompanyLogo name={r.company?.name ?? r.title} domain={r.company?.logo_domain ?? ''} logoUrl={r.company?.logo_url ?? ''} size={22} />
          <span className="truncate font-medium">{r.title}</span>
          {r.restricted && <Lock size={12} aria-label="Restricted" className="shrink-0 text-[var(--vo-muted)]" />}
        </span>
      ),
    },
    { key: 'stage', label: 'Stage', width: 'minmax(110px,1fr)', sort: (r) => r.stage_index, render: (r) => <span className={cn('truncate', r.stalled && 'text-[var(--vo-warn)]')}>{r.stage_label}</span> },
    { key: 'days', label: 'Days', width: '64px', align: 'right', mono: true, sort: (r) => r.days_in_stage, phone: 'end', render: (r) => <span className={r.stalled ? 'text-[var(--vo-warn)]' : ''}>{r.days_in_stage}</span> },
    { key: 'round', label: 'Round', width: '96px', sort: (r) => r.round_type, render: (r) => (r.round_type !== '' ? <Tag>{roundLabel(r.round_type)}</Tag> : '') },
    { key: 'raise', label: 'Raise', width: '110px', align: 'right', mono: true, sort: (r) => r.raise_minor ?? -1, render: (r) => money(r.raise_minor, r.currency, { compact: true }) },
    { key: 'check', label: 'Check', width: '110px', align: 'right', mono: true, optional: true, sort: (r) => r.check_minor ?? -1, render: (r) => money(r.check_minor, r.currency, { compact: true }) },
    { key: 'point', label: 'Point', width: 'minmax(120px,1fr)', sort: (r) => r.point?.name ?? '', phone: 'hide', render: (r) => (r.point !== null ? <span className="flex min-w-0 items-center gap-2"><Avatar name={r.point.name} size={20} /><span className="truncate">{r.point.name}</span></span> : '') },
    { key: 'status', label: 'Status', width: '84px', optional: true, sort: (r) => r.status, render: (r) => (r.status !== 'open' ? <Tag tone={r.status === 'passed' || r.status === 'lost' ? 'faint' : r.status === 'invested' ? 'good' : 'neutral'}>{r.status}</Tag> : '') },
    { key: 'activity', label: 'Activity', width: '104px', align: 'right', mono: true, optional: true, sort: (r) => r.last_activity_at, render: (r) => <span className="text-[var(--vo-muted)]">{ago(r.last_activity_at)}</span> },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Segmented
        label="Show"
        size="sm"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setLimit(60);
        }}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'mine', label: 'Mine' },
          { value: 'passed', label: 'Passed' },
          { value: 'all', label: 'All' },
        ]}
      />
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : live.data === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DataTable
          label="Deals"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={onOpen}
          selectable={canCompare}
          selected={selected}
          onSelect={setSelected}
          selectionBar={(ids, clear) =>
            ids.length >= 2 ? (
              <Button
                icon={Columns3}
                onClick={() => {
                  clear();
                  void compareDeals(ids);
                }}
              >
                Compare
              </Button>
            ) : null
          }
          viewScope="deals.table"
          viewState={{ filter }}
          onApplyView={(s) => {
            const f = s['filter'];
            if (f === 'active' || f === 'mine' || f === 'passed' || f === 'all') setFilter(f);
          }}
          hasMore={(live.data?.total ?? 0) > rows.length}
          onMore={() => setLimit((l) => l + 60)}
          initialSort={{ key: 'days', dir: 'desc' }}
          empty={<Empty icon={Rows3} title="No deals here" />}
        />
      )}
    </div>
  );
}

/** Phones: the stage counts (tap one to see its deals) and my deals with Move to. */
function PhoneDeals({ funnel, pipeline, stages, fund }: { funnel: FunnelAnswer | null; pipeline: string; stages: Pipeline['stages']; fund: string }): React.JSX.Element {
  const [stage, setStage] = useState('');
  const live = useOp<{ deals: DealCard[]; total: number }>('deals.list', { pipeline, fund: fund || undefined, status: 'active', point: stage === '' ? 'me' : undefined, stage: stage || undefined, limit: 100 }, DEAL_READS, { name: 'deals.phone', keep: true });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {(funnel?.stages ?? []).map((s) =>
          s.now === null ? null : (
            <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => setStage((v) => (v === s.key ? '' : s.key))} className={cn('vo-focus vo-tap flex min-h-12 items-center gap-2 py-1.5 rounded-[var(--vo-radius-sm)] border px-3 text-left transition-colors duration-150', stage === s.key ? 'border-[var(--vo-ink)] bg-[var(--vo-active)]' : 'border-[var(--vo-line)] bg-[var(--vo-raised)] hover:bg-[var(--vo-hover)]')}>
              <span className="vo-wrap min-w-0 flex-1 text-[13px] leading-[17px]">{s.label}</span>
              <span className="shrink-0 whitespace-nowrap text-[13px] text-[var(--vo-ink-2)]"><span className="vo-mono vo-num text-[15px] text-[var(--vo-ink)]">{s.now}</span> {s.now === 1 ? 'deal' : 'deals'}</span>
            </button>
          ),
        )}
      </div>
      {live.data === null ? (
        <Skeleton className="h-40 w-full" />
      ) : live.data.deals.length === 0 ? (
        <Empty icon={KanbanSquare} title={stage === '' ? 'No deals of yours' : 'No deals here'} />
      ) : (
        <div className="-mx-4 border-t border-[var(--vo-hair)]">
          <PhoneList label={stage === '' ? 'My deals' : 'Deals'}>
            {live.data.deals.map((d) => (
              <DealPhoneRow key={d.id} d={d} stages={stages} />
            ))}
          </PhoneList>
        </div>
      )}
    </div>
  );
}

export function DealsPage({ query }: PageProps): React.JSX.Element {
  const narrow = useNarrow();
  const { fund } = useUi();
  const view: View = query.get('view') === 'table' ? 'table' : 'board';
  const pipes = useOp<{ pipelines: Pipeline[] }>('pipelines.list', {}, ['pipelines', 'deals'], { name: 'pipelines.list' });
  const list = pipes.data?.pipelines ?? [];
  const pipeline = query.get('pipeline') ?? 'deal_flow';
  const current = list.find((p) => p.key === pipeline) ?? null;
  const funnel = useOp<FunnelAnswer>('deals.funnel', { pipeline, fund: fund || undefined }, [...DEAL_READS], { name: 'deals.funnel' });
  const board = useOp<BoardAnswer>('deals.board', { pipeline, fund: fund || undefined, limit: 100 }, DEAL_READS, { name: 'deals.board', skip: view !== 'board' || narrow });
  const [peek, setPeek] = useState<DealCard | null>(null);
  const stages = useMemo(() => board.data?.pipeline.stages ?? current?.stages ?? [], [board.data, current]);
  const hidden = board.data?.hidden ?? funnel.data?.hidden ?? 0;
  const columns = (board.data?.stages ?? []).map((s) => ({ key: s.key, label: s.label, items: s.deals }));
  const empty = board.data !== null && board.data.total === 0;
  return (
    <>
      <PageHeader title="Deals">
        {list.length > 1 && <Segmented label="Pipeline" value={pipeline} onChange={(v) => setQuery({ pipeline: v === 'deal_flow' ? null : v })} options={list.map((p) => ({ value: p.key, label: p.name }))} />}
        {!narrow && (
          <Segmented
            label="View"
            value={view}
            onChange={(v) => setQuery({ view: v === 'board' ? null : v })}
            options={[
              { value: 'board', label: '', icon: KanbanSquare, title: 'Board' },
              { value: 'table', label: '', icon: Rows3, title: 'Table' },
            ]}
          />
        )}
        <AddDeal />
      </PageHeader>
      <PageBody wide>
        {!narrow && (
          <div className="flex min-w-0 items-start gap-3">
            <FunnelStrip funnel={funnel.data} className="min-w-0 flex-1" />
            {hidden > 0 && (
              <Tag icon={Lock} title="Restricted deals you cannot see">
                {hidden} restricted
              </Tag>
            )}
          </div>
        )}
        {narrow ? (
          <PhoneDeals funnel={funnel.data} pipeline={pipeline} stages={stages} fund={fund} />
        ) : view === 'table' ? (
          <DealsTable pipeline={pipeline} fund={fund} onOpen={setPeek} />
        ) : board.error !== null && board.data === null ? (
          <LoadError message={board.error} onRetry={board.reload} />
        ) : board.data === null ? (
          <Skeleton className="h-80 w-full" />
        ) : empty ? (
          <Empty icon={KanbanSquare} title="No deals yet" action={<AddDeal variant="default" />} />
        ) : (
          <Board<DealCard>
            label="Deal board"
            columns={columns}
            itemKey={(d) => d.id}
            renderCard={(d) => <DealCardBody d={d} />}
            stalled={(d) => d.stalled}
            onOpen={setPeek}
            cardLabel={(d) => d.title}
            onMove={(id, to, at) => {
              const d = columns.flatMap((c) => c.items).find((x) => x.id === id);
              const i = stages.findIndex((s) => s.key === to);
              const st = stages[i];
              if (d === undefined || st === undefined) return;
              // The deal it lands in front of, in the column as shown (without the card itself).
              const rest = (columns.find((c) => c.key === to)?.items ?? []).filter((x) => x.id !== id);
              return placeDeal(d, { key: st.key, label: st.label, index: i }, at, rest[at]?.id ?? '');
            }}
          />
        )}
      </PageBody>
      <DealPeek deal={peek} stages={stages} onClose={() => setPeek(null)} />
    </>
  );
}
