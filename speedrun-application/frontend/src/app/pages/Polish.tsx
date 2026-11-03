/**
 * Step 4, Polish: the odds gauge with the moves worth most, every check as
 * a small bar, the fixes that matter next, the things only founders confirm,
 * and how the odds are worked out.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BadgeCheck, ChartNoAxesCombined, Clapperboard, FileWarning, Handshake, Lightbulb, MapPin, PenLine, Rocket, ShieldCheck, Sparkles, TrendingUp, Users } from 'lucide-react';
import { op } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { setConfirm } from '../lib/actions.ts';
import { go, href, targetHref, type Route } from '../lib/router.ts';
import type { Check, ChecksList, ConfirmKey, Odds, Pipeline } from '../lib/types.ts';
import { ReviewAgain, ReviewNotice } from '../components/ReviewAgain.tsx';
import { CheckBars, FactorRows, Gauge } from '../components/Charts.tsx';
import { Card, CardHeader, IconBadge, PageHeader, PillLink, StartCard, StatusPill, Tip, ToggleRow } from '../components/ui.tsx';

const GROUP_ICON: Record<string, LucideIcon> = {
  before: ShieldCheck,
  team: Users,
  clarity: PenLine,
  idea: Lightbulb,
  traction: TrendingUp,
  video: Clapperboard,
  form: FileWarning,
};

const CONFIRM_ICON: Record<string, LucideIcon> = {
  residency: MapPin,
  full_time_if_accepted: Rocket,
  one_application: FileWarning,
  ip_clear: ShieldCheck,
  goals_aligned: Handshake,
  metrics_true: ChartNoAxesCombined,
};

function FixRow({ c }: { c: Check }): React.JSX.Element {
  return (
    <div id={'c-' + c.id} className="flex scroll-mt-4 items-center gap-3 rounded-[18px] bg-[var(--sr-row)] px-3 py-2.5">
      <IconBadge icon={GROUP_ICON[c.group] ?? BadgeCheck} tone={c.severity === 'blocker' ? 'bad' : c.severity === 'warning' ? 'accent' : 'light'} />
      <Tip text={c.why ?? ''} className="min-w-0 flex-1">
        <span className="min-w-0 flex-1" tabIndex={0}>
          <span className="block text-[14px] font-bold">{c.title}</span>
          <span className="block text-[12px] text-[var(--sr-muted)]">{c.fix}</span>
        </span>
      </Tip>
      <PillLink variant="light" className="h-9" href={targetHref(c.target)}>
        Fix
      </PillLink>
    </div>
  );
}

export function PolishPage({ p, route }: { p: Pipeline; route: Route }): React.JSX.Element {
  const list = useLive<ChecksList>('checks', (signal) => op<ChecksList>('review.checks', {}, { signal, quiet: true }), ['answers', 'founders', 'settings']);
  const odds = useLive<Odds>('odds', (signal) => op<Odds>('review.odds', {}, { signal, quiet: true }), ['answers', 'founders', 'settings']);
  const [how, setHow] = useState(false);
  useEffect(() => {
    if (route.focus === '' || list.data === null) return;
    document.getElementById(route.focus === 'before' ? 'before' : 'c-' + route.focus)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [route.focus, list.data]);
  const checks = list.data?.checks ?? [];
  const o = odds.data ?? p.odds;
  const order = { blocker: 0, warning: 1, tip: 2 } as const;
  const fails = checks.filter((c) => c.status === 'fail' && c.confirm === undefined).sort((a, b) => order[a.severity] - order[b.severity]);
  // The ticks only founders make, video points aside (those sit with the video on Submit).
  const before = checks.filter((c) => c.confirm !== undefined && c.group !== 'video' && c.status !== 'na');
  const t = list.data?.totals ?? p.totals;
  const locked = p.settings.status !== 'preparing';
  const progress = list.data?.review.progress ?? p.review.progress;
  const reading = progress.active;

  if (!o.ready) {
    const noTeam = p.founders.length === 0;
    return (
      <>
        <PageHeader title="Polish" subtitle="Fix what speedrun investors notice first" actions={<ReviewAgain progress={progress} locked={locked || p.counts.answered === 0} />} />
        <StartCard
          icon={Sparkles}
          title={noTeam ? 'Add your founders first' : 'Answer a few more questions first'}
          actions={
            <PillLink variant="dark" dot icon={ArrowRight} href={href(noTeam ? 'team' : 'answers')}>
              {noTeam ? 'Go to team' : 'Go to answers'}
            </PillLink>
          }
        >
          Polish checks your application and works out your odds once your team and at least 5 answers are in.
        </StartCard>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Polish"
        subtitle="Fix what speedrun investors notice first"
        actions={
          <>
            <ReviewAgain progress={progress} locked={locked} />
            <PillLink variant="dark" dot icon={ArrowRight} href={href('submit')}>Next: submit</PillLink>
          </>
        }
      />
      <ReviewNotice progress={progress} />
      <div className="grid gap-4">
        {p.review.summary !== '' && <Card><CardHeader title="Your AI agent's last review" /><p className="text-[14px] leading-6">{p.review.summary}</p>{p.review.fixes.length > 0 && <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px]">{p.review.fixes.map((fix) => <li key={fix}>{fix}</li>)}</ul>}</Card>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Your odds" subtitle={o.ready ? o.band + ' · ' + o.rank : 'Add your team and a few answers'} />
            <Gauge odds={o} size={220} />
            {o.ready && o.moves.length > 0 && (
              <div className="mt-2 grid gap-2">
                {o.moves.map((m) => (
                  <a key={m.id} href={href('polish', '', m.check)} className="flex items-center justify-between gap-3 rounded-full bg-[var(--sr-row)] py-1.5 pl-4 pr-1.5 transition-colors hover:bg-[var(--sr-hover)]">
                    <span className="truncate text-[13px] font-semibold">{m.label}</span>
                    <span className="num shrink-0 whitespace-nowrap rounded-full bg-[var(--sr-ink)] px-3 py-1 text-[12px] font-bold text-[var(--sr-shell)]">+{m.gain} pts</span>
                  </a>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Every check" subtitle={reading ? 'Your AI agent is reading your answers' : 'Each bar is one thing speedrun looks for. Click one to fix it'} />
            <div className="mb-5 flex flex-wrap gap-2">
              <StatusPill tone="good">{t.pass} done</StatusPill>
              <StatusPill tone="bad">{t.blockers} must fix</StatusPill>
              <StatusPill tone="warn">{t.warnings} should fix</StatusPill>
            </div>
            <CheckBars checks={checks} onPick={(c) => go('polish', '', c.id)} />
          </Card>
        </div>

        {fails.length > 0 && (
          <Card>
            <CardHeader title="Fix next" subtitle={fails.length + ' left'} />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {(fails.findIndex((c) => c.id === route.focus) >= 6 ? fails : fails.slice(0, 6)).map((c) => (
                <FixRow key={c.id} c={c} />
              ))}
            </div>
          </Card>
        )}

        {before.length > 0 && (
          <Card id="before">
            <CardHeader title="Before you apply" subtitle="Things only you can confirm" />
            <div className="grid gap-2 md:grid-cols-2">
              {before.map((c) => (
                <ToggleRow key={c.id} icon={CONFIRM_ICON[c.confirm as string] ?? ShieldCheck} title={c.title} checked={c.status === 'pass'} disabled={locked} onChange={(v) => setConfirm(c.confirm as ConfirmKey, v)} />
              ))}
            </div>
          </Card>
        )}

        {o.ready && (
          <Card>
            <CardHeader
              title="How the odds are worked out"
              subtitle={'Score ' + o.score + ' of 100'}
              action={
                <button type="button" onClick={() => setHow((v) => !v)} className="text-[13px] font-semibold underline underline-offset-4 hover:decoration-2">
                  {how ? 'Hide' : 'Show'}
                </button>
              }
            />
            {how && (
              <div className="sr-unfold grid gap-4">
                <FactorRows odds={o} />
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="neutral">Sum {o.raw}/100</StatusPill>
                  {o.caps.map((c) => (
                    <StatusPill key={c.check} tone="bad">
                      Capped at {c.limit}: {c.why}
                    </StatusPill>
                  ))}
                  {o.modifiers.map((m) => (
                    <StatusPill key={m.why} tone={m.delta > 0 ? 'good' : 'bad'}>
                      {m.delta > 0 ? '+' : ''}
                      {m.delta} {m.why}
                    </StatusPill>
                  ))}
                </div>
                <p className="text-[12px] text-[var(--sr-muted)]">{o.note}</p>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
