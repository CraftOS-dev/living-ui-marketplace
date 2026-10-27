/**
 * My life: the balance of the parts of life as a spider chart (each part's
 * reach worked out from what you do there), how each one is going in a
 * line, and every goal under the part it belongs to. Tap a part to go
 * there; switch parts of life on and off at the foot.
 */
import { Plus } from 'lucide-react';
import { op } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { changed, READS, useLive } from '../lib/live.ts';
import { href, navigate } from '../lib/router.ts';
import type { AreaOut, LifeOverview } from '../lib/types.ts';
import { AREA_BLURB, AREA_NAMES, AreaArt } from '../components/art.tsx';
import { NavArt, ThingArt } from '../components/art2.tsx';
import { Meter, kindColor, switchArea } from '../components/bits.tsx';
import { Radar } from '../components/radar.tsx';
import { Panel, PanelLink } from '../components/panel.tsx';
import { GoalTrail, NewGoalButton, useGoalPanel } from '../components/goals.tsx';
import { PageBanner, PageBody } from '../components/page.tsx';
import { snack } from '../components/snack.tsx';
import { LoadError, Skeleton } from '../components/ui.tsx';

const LEVEL: Record<AreaOut['pulse']['level'], { label: string; color: string }> = {
  good: { label: 'Going well', color: 'var(--lo-green)' },
  ok: { label: 'Ticking along', color: 'var(--lo-art-honey)' },
  attention: { label: 'Needs a look', color: 'var(--lo-amber)' },
  quiet: { label: 'Quiet', color: 'var(--lo-line)' },
};

/** One part of life in the list beside the chart: its drawing, how it is going, its score. */
function Row({ a }: { a: AreaOut }): React.JSX.Element {
  const lv = LEVEL[a.pulse.level];
  return (
    <a href={href('area', { kind: a.kind })} className="flex items-center gap-3 rounded-[var(--lo-r)] px-2 py-2 hover:bg-[var(--lo-sunk)]">
      <AreaArt kind={a.kind} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="text-[14px] font-bold">{AREA_NAMES[a.kind]}</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-bold text-[var(--lo-muted)]">
            <span className="size-2 rounded-full" style={{ background: lv.color }} />
            {lv.label}
          </span>
        </span>
        <span className="block truncate text-[13px] text-[var(--lo-ink-2)]">{a.pulse.line}</span>
      </span>
      <span className="w-16 shrink-0 sm:w-24">
        {a.score !== null ? (
          <>
            <span className="num block text-right text-[13px] font-extrabold">{Math.round(a.score * 100)}</span>
            <Meter value={a.score} color={kindColor(a.kind)} height={5} />
          </>
        ) : (
          <span className="block text-right text-[12px] font-semibold text-[var(--lo-muted)]">Not enough yet</span>
        )}
      </span>
    </a>
  );
}

export default function LifePage(): React.JSX.Element {
  const goals = useGoalPanel();
  const live = useLive<LifeOverview>((signal) => op('life.overview', {}, { quiet: true, signal }), READS.life, []);
  const d = live.data;
  const on = (d?.areas ?? []).filter((a) => a.enabled);
  const off = (d?.areas ?? []).filter((a) => !a.enabled);
  const enable = async (kind: string, enabled: boolean): Promise<void> => {
    snack(enabled ? `${AREA_NAMES[kind as never]} is back on` : `${AREA_NAMES[kind as never]} is put away`, { undo: false });
    await switchArea(kind, enabled);
  };
  return (
    <div>
      <PageBanner seed="life" title="My life" subtitle={d === null ? undefined : `${plural(on.length, 'part')} of life, ${plural(d.goals.filter((g) => g.state === 'active').length, 'goal')}`} />
      <PageBody className="flex flex-col gap-6">
        {d === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Skeleton className="h-72 w-full" />
          )
        ) : (
          <>
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
              <Panel className="xl:col-span-7" title="Balance" art={<ThingArt kind="star" size={24} />} note="How each part is going">
                <Radar points={on.map((a) => ({ kind: a.kind, score: a.score }))} onPick={(k) => navigate('area', { kind: k })} />
              </Panel>
              <Panel className="xl:col-span-5" title="Each part of life" art={<NavArt kind="life" size={24} />} bodyClassName="p-2 md:p-3">
                <div className="flex flex-col">
                  {on.map((a) => (
                    <Row key={a.kind} a={a} />
                  ))}
                </div>
              </Panel>
            </div>

            <div className="-mb-1 mt-2 flex items-center gap-3">
              <ThingArt kind="flag" size={28} />
              <h2 className="serif min-w-0 flex-1 text-[15px] font-semibold">Goals by part of life</h2>
              <span className="w-36 shrink-0 sm:w-44">
                <NewGoalButton />
              </span>
            </div>
            {d.goals.length === 0 ? (
              <p className="text-[14px] text-[var(--lo-ink-2)]">No goals yet. Open a part of life above, or start one here: most of them count by themselves.</p>
            ) : (
              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
                {on
                  .filter((a) => d.goals.some((g) => g.area === a.kind))
                  .map((a) => (
                    <Panel
                      key={a.kind}
                      title={AREA_NAMES[a.kind]}
                      art={<AreaArt kind={a.kind} size={26} />}
                      note={plural(d.goals.filter((g) => g.area === a.kind).length, 'goal')}
                      action={<PanelLink to={href('area', { kind: a.kind })}>Open</PanelLink>}
                      bodyClassName="p-2 md:p-3"
                    >
                      {d.goals
                        .filter((g) => g.area === a.kind)
                        .map((g) => (
                          <GoalTrail key={g.id} goal={g} onOpen={() => goals.open(g.id)} />
                        ))}
                    </Panel>
                  ))}
              </div>
            )}

            {off.length > 0 && (
              <Panel title="More parts of life" art={<Plus size={18} className="text-[var(--lo-ink-2)]" />}>
                <div className="flex flex-wrap gap-3">
                  {off.map((a) => (
                    <button key={a.kind} type="button" onClick={() => void enable(a.kind, true)} className="group flex items-center gap-3 rounded-[var(--lo-r-lg)] border border-dashed border-[var(--lo-line)] py-2 pl-2 pr-4 text-left hover:border-solid hover:border-[var(--lo-moss)]">
                      <AreaArt kind={a.kind} size={44} className="opacity-60 grayscale transition group-hover:opacity-100 group-hover:grayscale-0" />
                      <span>
                        <span className="flex items-center gap-1 text-[14px] font-bold">
                          <Plus size={13} strokeWidth={3} /> {AREA_NAMES[a.kind]}
                        </span>
                        <span className="block text-[12px] text-[var(--lo-muted)]">{AREA_BLURB[a.kind]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}
      </PageBody>
    </div>
  );
}
