/**
 * The deal page, where partners live: results first, depth in tabs. The
 * header shows where the deal is (the stage track; click a stage to move
 * it after a one-line confirm), who works it and whether it is restricted;
 * the figure strip shows the round; the stage's one primary action sits in
 * the page header with the overflow menu. Tabs come from every module
 * (dealTabs): Overview, Diligence, Memo, Decision, Investment, Files, Notes.
 */
import { useMemo } from 'react';
import { KanbanSquare, Lock } from 'lucide-react';
import { Avatar, Empty, FigureStrip, LoadError, PageBody, PageHeader, Skeleton, StageTrack, Tabs, Tag, Tip } from '../../components/ui.tsx';
import type { Figure } from '../../components/ui.tsx';
import { CompanyLogo } from '../../components/portfolio/Logo.tsx';
import { DealMenu, PrimaryFor } from '../../components/deals/DealActions.tsx';
import { moveDeal } from '../../components/deals/actions.ts';
import { DEAL_READS, roundLabel } from '../../components/deals/types.ts';
import type { Deal } from '../../components/deals/types.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { money, pct } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { dealTabs } from '../../registry.ts';

const STATUS: Record<string, { word: string; tone: 'faint' | 'good' | 'warn' }> = {
  passed: { word: 'Passed', tone: 'faint' },
  lost: { word: 'Lost', tone: 'faint' },
  invested: { word: 'Invested', tone: 'good' },
  hold: { word: 'On hold', tone: 'warn' },
};

/** May the signed-in person change this deal: Deals edit rights or a seat on its team. */
export function useCanEdit(deal: { team?: { id: string }[] | undefined }): boolean {
  const me = useMe();
  return allowed(me, 'pipeline:edit') || (deal.team ?? []).some((t) => t.id === me.member.id);
}

function People({ deal }: { deal: Deal }): React.JSX.Element {
  const others = deal.team.filter((t) => t.id !== deal.point?.id);
  return (
    <div className="flex shrink-0 items-center">
      {deal.point !== null && (
        <Tip text={`${deal.point.name}, point`}>
          <span className="flex">
            <Avatar name={deal.point.name} size={28} />
          </span>
        </Tip>
      )}
      <span className="ml-3 flex -space-x-1.5">
        {others.slice(0, 4).map((t) => (
          <Tip key={t.id} text={t.name}>
            <span className="flex rounded-full bg-[var(--vo-page)] p-px">
              <Avatar name={t.name} size={22} />
            </span>
          </Tip>
        ))}
      </span>
      {others.length > 4 && <span className="vo-mono vo-num ml-1.5 text-[12px] text-[var(--vo-muted)]">+{others.length - 4}</span>}
    </div>
  );
}

export function DealPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ deal: Deal }>('deals.get', { deal: params['id'] ?? '' }, DEAL_READS.concat(['files', 'notes']), { name: 'deals.get' });
  const deal = live.data?.deal ?? null;
  const canEdit = useCanEdit(deal ?? {});
  const tabs = useMemo(() => (deal === null ? [] : dealTabs().filter((t) => allowed(me, t.perm ?? 'signed') && (t.show === undefined || t.show({ deal: deal as unknown as { id: string } & Record<string, unknown> })))), [deal, me]);
  if (deal === null) {
    return (
      <>
        <PageHeader title="Deal" back="#/deals" />
        <PageBody>
          {live.code === 'restricted' ? (
            <Empty icon={Lock} title="Restricted deal" />
          ) : live.code === 'not_found' ? (
            <Empty icon={KanbanSquare} title="No such deal" />
          ) : live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-64 w-full" />
            </>
          )}
        </PageBody>
      </>
    );
  }
  const stages = deal.pipeline.stages;
  const open = deal.status === 'open';
  const tab = tabs.find((t) => t.key === (query.get('tab') ?? 'overview')) ?? tabs[0];
  const TabBody = tab?.component;
  const status = STATUS[deal.status];
  const valuation = deal.round.post_money_minor ?? deal.round.pre_money_minor;
  // The round in figures; a deal with none of them known (an SPV, a fund raise) shows no strip of Unknowns.
  const figures: Figure[] = [
            { label: 'Round', value: roundLabel(deal.round.type) || null },
            { label: 'Raise', value: deal.round.raise_minor !== null ? money(deal.round.raise_minor, deal.currency, { compact: true }) : null },
            { label: 'Valuation', value: valuation !== null ? money(valuation, deal.currency, { compact: true }) : null, tip: deal.round.post_money_minor !== null ? 'Post-money' : deal.round.pre_money_minor !== null ? 'Pre-money' : undefined },
            { label: 'Check', value: deal.check_minor !== null ? money(deal.check_minor, deal.currency, { compact: true }) : null },
            { label: 'Ownership', value: deal.ownership_ppm !== null ? pct(deal.ownership_ppm, 2) : null, tip: 'Check over post-money' },
          ];
  return (
    <>
      <PageHeader title={deal.title} back="#/deals">
        <PrimaryFor deal={deal} canEdit={canEdit} hasTab={(k) => tabs.some((t) => t.key === k)} />
        <DealMenu deal={deal} canEdit={canEdit} />
      </PageHeader>
      <PageBody>
        <div className="vo-in flex min-w-0 flex-wrap items-center gap-x-4 gap-y-4">
          <CompanyLogo name={deal.company?.name ?? deal.title} domain={deal.company?.logo_domain ?? ''} logoUrl={deal.company?.logo_url ?? ''} size={40} />
          <StageTrack
            stages={stages}
            current={deal.stage}
            stalled={deal.stalled}
            className="order-last min-w-0 basis-full md:order-none md:basis-0 md:flex-1"
            onMove={
              canEdit && open
                ? (key) => {
                    const i = stages.findIndex((s) => s.key === key);
                    const st = stages[i];
                    if (st !== undefined) void moveDeal(deal, { key: st.key, label: st.label, index: i }, true);
                  }
                : undefined
            }
          />
          <span className="flex-1 md:hidden" />
          {status !== undefined && (
            <Tag tone={status.tone} title={deal.status_reason !== '' ? deal.status_reason : undefined}>
              {status.word}
            </Tag>
          )}
          {deal.restricted && (
            <Tip text={deal.agent_allowed ? 'Deal team only; your AI agent allowed' : 'Deal team only'}>
              <Lock size={15} aria-label="Restricted" className="shrink-0 text-[var(--vo-ink-2)]" />
            </Tip>
          )}
          <People deal={deal} />
        </div>
        {!figures.every((f) => f.value === null) && <FigureStrip items={figures} />}
        <div className="flex min-w-0 flex-col gap-5">
          <Tabs label="Deal" value={tab?.key ?? 'overview'} onChange={(k) => setQuery({ tab: k === 'overview' ? null : k, note: null })} tabs={tabs.map((t) => ({ value: t.key, label: t.label, count: t.key === 'files' ? deal.files : undefined }))} />
          {TabBody !== undefined && <TabBody deal={deal as unknown as { id: string } & Record<string, unknown>} />}
        </div>
      </PageBody>
    </>
  );
}
