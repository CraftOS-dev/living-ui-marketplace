/**
 * Markets (fix 4): market research, still simple. Tabs:
 *
 *   #/markets, #/markets/news   News: the news dashboard (lead story, featured
 *                               stories, cards by category, your AI agent's
 *                               take, trending topics, sources)
 *   #/markets/overview          the pulse of each thesis sector, then the new
 *                               companies the theses found
 *   #/markets/sectors[/:key]    one research page per sector: funding by
 *                               month, recent rounds, market map, key
 *                               companies, competitors, news and the take
 *   #/markets/theses            the theses as cards (criteria in words, new
 *                               companies to review); each opens its page
 *   #/markets/research[/:id]    ask your AI agent for a market brief; the
 *                               briefs; one brief as a document
 *   #/markets/:thesis[/:tab]    one thesis: New companies, Market map,
 *                               Compare, News
 *
 * One black button per screen: New thesis (Theses), Ask your AI agent
 * (Research).
 */
import { useEffect, useState } from 'react';
import { Archive, Pause, Pencil, Play, Plus, Radar as RadarIcon, RefreshCw, Target } from 'lucide-react';
import { Button, Empty, IconButton, LoadError, Menu, MenuItem, PageBody, PageHeader, Skeleton, StepTrack, Tabs, Tag, confirmAsk } from '../../components/ui.tsx';
import { DCard, DSection } from '../../components/markets/Divided.tsx';
import { FoundList } from '../../components/markets/FoundList.tsx';
import { GridTab } from '../../components/markets/GridTab.tsx';
import { MapTab } from '../../components/markets/MapTab.tsx';
import type { Pulse } from '../../components/markets/MarketPulse.tsx';
import { PULSE_READS, PulseGrid } from '../../components/markets/MarketPulse.tsx';
import { NewsDashboard } from '../../components/markets/NewsDashboard.tsx';
import { RadarTab } from '../../components/markets/RadarTab.tsx';
import { AskBrief, BriefList, ReportView } from '../../components/markets/Research.tsx';
import { SectorView } from '../../components/markets/SectorView.tsx';
import { checkedLine, reviewLine, ThesisCards } from '../../components/markets/ThesisCards.tsx';
import { ThesisSheet } from '../../components/markets/ThesisSheet.tsx';
import type { ThesisTile } from '../../components/markets/types.ts';
import { criteriaChips, radarSteps } from '../../components/markets/types.ts';
import { runRadar, usePulling } from '../../components/markets/pulling.ts';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';

type Tab = 'radar' | 'map' | 'grid' | 'news';
type Area = 'news' | 'overview' | 'sectors' | 'theses' | 'research';

const TABS: Tab[] = ['radar', 'map', 'grid', 'news'];
const AREAS: Area[] = ['news', 'overview', 'sectors', 'theses', 'research'];
const READS = ['theses', 'radars', 'signals', 'maps', 'map_entries', 'agent_requests'];

/** The sector chips of the Sectors tab: one page per thesis sector. */
function SectorsArea({ sub }: { sub: string }): React.JSX.Element {
  const pulse = useOp<Pulse>('markets.pulse', {}, PULSE_READS, { name: 'markets.pulse', keep: true });
  if (pulse.data === null) return pulse.error !== null ? <LoadError message={pulse.error} onRetry={pulse.reload} /> : <Skeleton className="h-72 w-full" />;
  const list = pulse.data.sectors;
  if (list.length === 0)
    return (
      <div className="vo-panel">
        <Empty icon={Target} title="Add a thesis with sectors to research them" action={<Button onClick={() => navigate('/markets/theses')}>Your theses</Button>} />
      </div>
    );
  const key = list.some((s) => s.key === sub) ? sub : (list[0]?.key ?? '');
  // The chips grouped by thesis, in the order the theses come.
  const groups: { thesis: string; name: string; sectors: typeof list }[] = [];
  for (const s of list) {
    const g = groups.find((x) => x.thesis === s.thesis.id);
    if (g !== undefined) g.sectors.push(s);
    else groups.push({ thesis: s.thesis.id, name: s.thesis.name, sectors: [s] });
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label="Sectors" className="flex min-w-0 flex-wrap items-start gap-x-5 gap-y-2">
        {groups.map((g) => (
          <div key={g.thesis} className="flex min-w-0 flex-col gap-1">
            <span className="text-[12px] text-[var(--vo-muted)]">{g.name}</span>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {g.sectors.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={s.key === key}
                  onClick={() => navigate(`/markets/sectors/${s.key}`)}
                  className={cn('vo-focus inline-flex h-8 cursor-pointer items-center rounded-[var(--vo-radius-sm)] border px-3 text-[13px] font-medium transition-colors duration-150', s.key === key ? 'border-[var(--vo-ink)] bg-[var(--vo-active)] text-[var(--vo-ink)]' : 'border-[var(--vo-line)] bg-[var(--vo-panel)] text-[var(--vo-ink-2)] hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <SectorView key={key} sectorKey={key} />
    </div>
  );
}

export function MarketsPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const canEdit = can(me, 'markets', 'edit');
  const live = useOp<{ theses: ThesisTile[] }>('theses.summary', {}, READS, { name: 'theses.summary' });
  const [sheet, setSheet] = useState<'new' | 'edit' | null>(query.get('new') === '1' && canEdit ? 'new' : null);
  const pulling = usePulling();
  const wantNew = query.get('new') === '1';
  useEffect(() => {
    if (wantNew && canEdit) setSheet('new');
  }, [wantNew, canEdit]);
  const tiles = live.data?.theses ?? [];
  const first = params['thesis'] ?? '';
  const area: Area | null = first === '' ? 'news' : (AREAS as string[]).includes(first) ? (first as Area) : null;
  const sub = params['tab'] ?? '';
  const thesisId = area === null ? first : '';
  const sel = thesisId !== '' ? (tiles.find((t) => t.id === thesisId) ?? null) : null;
  const tab: Tab = (TABS as string[]).includes(params['tab'] ?? '') ? (params['tab'] as Tab) : 'radar';
  const go = (id: string, t: Tab = 'radar'): void => navigate(t === 'radar' ? `/markets/${id}` : `/markets/${id}/${t}`);
  const run = (radarId: string, id: string): Promise<void> => runRadar(radarId, id);
  const closeSheet = (): void => {
    setSheet(null);
    if (query.get('new') !== null) setQuery({ new: null });
  };
  const sheetEl = (
    <ThesisSheet
      open={sheet !== null}
      thesis={sheet === 'edit' ? sel : null}
      onClose={closeSheet}
      onSaved={(id, created, radarId) => {
        closeSheet();
        go(id);
        if (created) void run(radarId, id);
      }}
    />
  );

  if (area !== null) {
    const newThesis =
      canEdit && area === 'theses' ? (
        <Button variant="primary" icon={Plus} aria-label="New thesis" onClick={() => setSheet('new')}>
          <span className="hidden sm:inline">New thesis</span>
        </Button>
      ) : null;
    const reading = area === 'research' && sub !== '';
    return (
      <>
        <PageHeader title="Markets" back={reading ? '#/markets/research' : undefined}>
          {newThesis}
        </PageHeader>
        <PageBody>
          <Tabs<Area>
            label="Markets"
            value={area}
            onChange={(a) => navigate(a === 'news' ? '/markets/news' : `/markets/${a}`)}
            tabs={[
              { value: 'news', label: 'News' },
              { value: 'overview', label: 'Overview' },
              { value: 'sectors', label: 'Sectors' },
              { value: 'theses', label: 'Theses', count: tiles.reduce((n, t) => n + t.net_new, 0) },
              { value: 'research', label: 'Research' },
            ]}
            className="vo-scroll min-w-0 overflow-x-auto"
          />
          {area === 'news' && <NewsDashboard scope="home" insight={query.get('insight') ?? ''} />}
          {area === 'overview' && (
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-label="Market pulse" className="flex min-w-0 flex-col gap-2">
                <h2 className="text-[15px] font-semibold leading-5" title="News and funding rounds found per week in each sector of your theses, the last 8 weeks">
                  Market pulse
                </h2>
                <PulseGrid />
              </section>
              <DCard label="New companies found">
                <DSection title="New companies found" tip="The newest companies your theses found that nobody has decided on yet" aside={<a href="#/markets/theses" className="vo-focus vo-tap rounded-[var(--vo-radius-sm)] px-1.5 text-[12px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">Your theses</a>}>
                  {live.data === null ? live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" /> : <FoundList tiles={tiles} canEdit={canEdit} onOpenThesis={(id) => go(id)} />}
                </DSection>
              </DCard>
            </div>
          )}
          {area === 'sectors' && <SectorsArea sub={sub} />}
          {area === 'theses' &&
            (live.data === null ? (
              live.error !== null ? (
                <LoadError message={live.error} onRetry={live.reload} />
              ) : (
                <Skeleton className="h-64 w-full" />
              )
            ) : tiles.length === 0 ? (
              <div className="vo-panel">
                <Empty
                  icon={Target}
                  title="Add a thesis to start finding companies"
                  action={
                    canEdit ? (
                      <Button icon={Plus} onClick={() => setSheet('new')}>
                        New thesis
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <ThesisCards tiles={tiles} pulling={pulling} onOpen={(id) => go(id)} />
            ))}
          {area === 'research' &&
            (reading ? (
              <ReportView id={sub} />
            ) : (
              <div className="flex min-w-0 flex-col gap-4">
                <AskBrief />
                <BriefList />
              </div>
            ))}
        </PageBody>
        {sheetEl}
      </>
    );
  }

  if (live.data === null)
    return (
      <>
        <PageHeader title="Markets" back="#/markets/theses" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />}</PageBody>
      </>
    );

  if (sel === null)
    return (
      <>
        <PageHeader title="Markets" back="#/markets/theses" />
        <PageBody>
          <Empty
            icon={RadarIcon}
            title="This thesis is archived or was removed"
            action={
              <Button icon={Target} onClick={() => navigate('/markets/theses')}>
                All theses
              </Button>
            }
          />
        </PageBody>
      </>
    );

  const r = sel.radar;
  const steps = radarSteps(r, pulling.has(sel.id));
  const working = pulling.has(sel.id) || (r !== null && r.steps.state === 'screening');
  const pause = (): void => {
    if (r !== null) void act([], () => op('radars.save', { radar: r.id, status: r.status === 'active' ? 'paused' : 'active' }), READS);
  };
  const archive = async (): Promise<void> => {
    if (!(await confirmAsk(`Archive ${sel.name}? It stops looking for companies.`, 'Archive'))) return;
    const out = await act([], () => op('theses.save', { thesis: sel.id, status: 'archived' }), READS);
    if (out !== null) navigate('/markets/theses');
  };
  const chips = criteriaChips(sel.criteria, me?.firm.base_currency ?? 'USD');
  return (
    <>
      <PageHeader title={sel.name} back="#/markets/theses">
        {canEdit && r !== null && (
          <Button icon={RefreshCw} busy={pulling.has(sel.id)} disabled={working} onClick={() => void run(r.id, sel.id)} title="Look for new companies now (it also runs on its schedule)">
            Check now
          </Button>
        )}
        {canEdit && <IconButton icon={Pencil} label="Edit thesis" onClick={() => setSheet('edit')} />}
        {canEdit && (
          <Menu label="More">
            {(close) => (
              <>
                {r !== null && (
                  <MenuItem
                    icon={r.status === 'active' ? Pause : Play}
                    onClick={() => {
                      close();
                      pause();
                    }}
                  >
                    {r.status === 'active' ? 'Stop looking for companies' : 'Start looking for companies'}
                  </MenuItem>
                )}
                <MenuItem
                  icon={Archive}
                  danger
                  onClick={() => {
                    close();
                    void archive();
                  }}
                >
                  Archive thesis
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        <div className="flex min-w-0 flex-col gap-2">
          {chips.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="What this thesis looks for">
              {chips.map((c) => (
                <Tag key={c} className="max-w-full">
                  <span className="truncate">{c}</span>
                </Tag>
              ))}
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <span className="text-[var(--vo-ink)]">{reviewLine(sel.net_new)}</span>
            <span className="vo-wrap text-[12px] text-[var(--vo-muted)]">{steps !== null ? (pulling.has(sel.id) ? 'Checking the sources now' : 'Your AI agent is screening what was found') : checkedLine(sel, false)}</span>
            {steps !== null && <StepTrack labels={['Look', 'Screen', 'Ready']} at={steps.at} className="w-[180px]" />}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs
            label={sel.name}
            value={tab}
            onChange={(t) => go(sel.id, t)}
            tabs={[
              { value: 'radar', label: 'New companies', count: sel.net_new },
              { value: 'map', label: 'Market map' },
              { value: 'grid', label: 'Compare' },
              { value: 'news', label: 'News' },
            ]}
            className="min-w-0"
          />
          {tab === 'radar' && <RadarTab key={sel.id} thesis={sel} canEdit={canEdit} onRun={() => r !== null && void run(r.id, sel.id)} />}
          {tab === 'map' && <MapTab key={sel.id} thesis={sel} canEdit={canEdit} />}
          {tab === 'grid' && <GridTab key={sel.id} thesis={sel} chosen={query.get('grid') ?? ''} onGoMap={() => go(sel.id, 'map')} />}
          {tab === 'news' && <NewsDashboard key={sel.id} scope="thesis" refId={sel.id} aside={false} />}
        </div>
      </PageBody>
      {sheetEl}
    </>
  );
}
