/**
 * Performance Home: opens on what needs the viewer. What you owe (reviews to
 * write or acknowledge, feedback requests, required trainings), the current
 * cycle and its phase, goals that need an update with a one-tap check-in,
 * and this week's praise. Managers and HR see their team's counts on top.
 */
import { useState } from 'react';
import { ArrowRight, CalendarCheck, ClipboardCheck, GraduationCap, Heart, MessageSquare, Plus, Sparkle, Target } from 'lucide-react';
import { Button, Empty, LoadError, Loading, PageBody, PageHeader, Panel, PersonChip, RowCue, StatTile, Tag } from '../../components/ui.tsx';
import { CheckinDialog, FeedbackDialog, GoalDialog } from '../../components/performance/dialogs.tsx';
import { AsideLink, dueText, GoalStatusDot, kindLabel, phaseNow, PhaseStrip, ProgressBar, Reasons, ValueTag } from '../../components/performance/bits.tsx';
import type { FeedbackRow, Goal, PerfHome } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { can, useMe } from '../../lib/auth.tsx';
import { ago, fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';

export function PerformanceHome(): React.JSX.Element {
  const me = useMe();
  const live = useOp<PerfHome>('perf.home', {}, [...READS.goals, ...READS.reviews, ...READS.feedback, ...READS.training], { name: 'perf.home' });
  const [goalOpen, setGoalOpen] = useState(false);
  const [checkin, setCheckin] = useState<Goal | null>(null);
  const [fb, setFb] = useState<{ open: boolean; request?: FeedbackRow | null | undefined }>({ open: false });
  const h = live.data;
  const hrFull = can(me, 'performance', 'full');
  const todo = h === null ? 0 : h.owe.length + h.to_acknowledge.length + h.requests.length + h.trainings.length;
  const first = h?.owe[0];
  return (
    <>
      <PageHeader title={t('perf.title')} meta={h === null ? '' : [h.cycles.length > 0 ? phaseNow(h.cycles[0]?.phases ?? [], h.today) : t('perf.home.no_cycle_meta'), tn('perf.home.todo', todo)].join(' · ')}>
        <Button icon={Target} onClick={() => setGoalOpen(true)}>
          {t('perf.goal.add')}
        </Button>
        {first !== undefined ? (
          <Button variant="primary" icon={ClipboardCheck} onClick={() => navigate(`/performance/reviews/${first.review}`)}>
            {t('perf.home.write_review')}
          </Button>
        ) : me.employee === null && hrFull ? (
          <Button variant="primary" icon={Plus} onClick={() => navigate('/performance/cycles/new')}>
            {t('perf.cycle.new')}
          </Button>
        ) : me.employee === null ? null : (
          <Button variant="primary" icon={Heart} onClick={() => setFb({ open: true })}>
            {t('perf.fb.give_praise')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {h === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            {(h.manager || h.hr) && h.team !== undefined && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:col-span-12">
                <StatTile label={t('perf.home.team')} value={h.team.people} onClick={() => navigate('/performance/goals', { view: 'team' })} />
                <StatTile label={t('perf.home.team_reviews')} value={h.team.reviews_missing} tone={h.team.reviews_missing > 0 ? 'warn' : undefined} sub={t('perf.home.not_in')} onClick={() => navigate('/performance/cycles')} />
                <StatTile label={t('perf.home.team_goals')} value={h.team_goals_needing_update ?? 0} tone={(h.team_goals_needing_update ?? 0) > 0 ? 'warn' : undefined} sub={t('perf.home.need_update')} onClick={() => navigate('/performance/goals', { view: 'team', needs: '1' })} />
                <StatTile label={t('perf.home.team_training')} value={h.team.trainings_overdue} tone={h.team.trainings_overdue > 0 ? 'bad' : undefined} sub={t('perf.home.overdue')} onClick={() => navigate('/performance/training', { tab: 'required' })} />
              </div>
            )}
            <OwePanel h={h} className="lg:col-span-7" onAnswer={(r) => setFb({ open: true, request: r })} />
            <CyclePanel h={h} className="lg:col-span-5" hrFull={hrFull} />
            <GoalsPanel h={h} className="lg:col-span-7" onCheckin={setCheckin} onAdd={() => setGoalOpen(true)} />
            <PraisePanel h={h} className="lg:col-span-5" onGive={() => setFb({ open: true })} canGive={me.employee !== null} />
            {h.upcoming_trainings.length > 0 && (
              <Panel index="05" label={t('perf.home.upcoming_training')} className="lg:col-span-12">
                <ul className="flex flex-col">
                  {h.upcoming_trainings.map((s) => (
                    <li key={s.id}>
                      <a href={`#/performance/training/${s.id}`} className="group hr-focus flex items-center gap-3 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] px-1.5 py-2 last:border-b-0 hover:bg-[var(--hr-hover)]">
                        <GraduationCap size={15} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
                        <span className="hr-wrap min-w-0 flex-1 text-[13px] font-medium">{s.title}</span>
                        <span className="hr-mono hr-num text-[12px] text-[var(--hr-ink-2)]">
                          {fmtDay(s.start)}
                          {s.start_time !== '' ? ` ${s.start_time}` : ''}
                        </span>
                        <RowCue />
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </PageBody>
      <GoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} />
      <CheckinDialog open={checkin !== null} onClose={() => setCheckin(null)} goal={checkin} />
      <FeedbackDialog open={fb.open} onClose={() => setFb({ open: false })} request={fb.request} />
    </>
  );
}

function Row({ href, icon: Icon, title, sub, end, tone, onClick }: { href?: string | undefined; icon: typeof Target; title: string; sub?: string | undefined; end?: React.ReactNode; tone?: 'bad' | undefined; onClick?: (() => void) | undefined }): React.JSX.Element {
  const inner = (
    <>
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border', tone === 'bad' ? 'border-[var(--hr-bad)] text-[var(--hr-bad)]' : 'border-[var(--hr-line-2)] text-[var(--hr-ink-2)]')}>
        <Icon size={13} strokeWidth={1.9} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="hr-wrap block text-[13px] font-medium">{title}</span>
        {sub !== undefined && sub !== '' && <span className="block truncate text-[12px] text-[var(--hr-muted)]">{sub}</span>}
      </span>
      {end}
      <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--hr-faint)]" />
    </>
  );
  const cls = 'hr-focus group flex w-full items-center gap-3 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] px-1.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--hr-hover)]';
  if (onClick !== undefined)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  return (
    <a href={href} className={cls}>
      {inner}
    </a>
  );
}

function OwePanel({ h, className, onAnswer }: { h: PerfHome; className?: string | undefined; onAnswer: (r: FeedbackRow) => void }): React.JSX.Element {
  const n = h.owe.length + h.to_acknowledge.length + h.requests.length + h.trainings.length;
  return (
    <Panel index="01" label={t('perf.home.owe')} className={cn('min-h-[220px]', className)} aside={n > 0 ? <span className="hr-label">{n}</span> : undefined}>
      {n === 0 ? (
        <Empty icon={CalendarCheck} title={t('perf.home.nothing_owed')} className="py-8">
          {t('perf.home.nothing_owed_text')}
        </Empty>
      ) : (
        <div className="flex flex-col">
          {h.owe.map((o) => (
            <Row
              key={o.review}
              href={`#/performance/reviews/${o.review}`}
              icon={ClipboardCheck}
              tone={o.overdue ? 'bad' : undefined}
              title={o.kind === 'self' ? t('perf.home.owe_self') : t('perf.home.owe_other', { kind: kindLabel(o.kind).toLowerCase(), name: o.employee?.name ?? '' })}
              sub={[o.cycle.name, o.started ? t('perf.home.started') : ''].filter((x) => x !== '').join(' · ')}
              end={<span className={cn('hr-label shrink-0', o.overdue && '!text-[var(--hr-bad)]')}>{dueText(o.due, h.today)}</span>}
            />
          ))}
          {h.to_acknowledge.map((a) => (
            <Row key={a.participant} href={`#/performance/reviews/${a.review}`} icon={ClipboardCheck} title={t('perf.home.read_review')} sub={a.cycle.name} end={<Tag tone="lh">{t('perf.home.shared')}</Tag>} />
          ))}
          {h.requests.map((r) => (
            <Row key={r.id} onClick={() => onAnswer(r)} icon={MessageSquare} title={t('perf.home.answer_request', { name: r.from?.name ?? '' })} sub={r.text} end={r.due !== '' ? <span className="hr-label shrink-0">{dueText(r.due, h.today)}</span> : undefined} />
          ))}
          {h.trainings.map((tr) => (
            <Row key={tr.requirement} href="#/performance/training?tab=required" icon={GraduationCap} tone={tr.state === 'overdue' ? 'bad' : undefined} title={t('perf.home.training', { name: tr.program_name })} sub={tr.enrolled !== null ? t('perf.home.enrolled_on', { day: fmtDay(tr.enrolled.start) }) : t(`perf.training.state.${tr.state}`)} end={tr.due !== '' ? <span className={cn('hr-label shrink-0', tr.state === 'overdue' && '!text-[var(--hr-bad)]')}>{dueText(tr.due, h.today)}</span> : undefined} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function CyclePanel({ h, className, hrFull }: { h: PerfHome; className?: string | undefined; hrFull: boolean }): React.JSX.Element {
  const c = h.cycles[0];
  return (
    <Panel index="02" label={c !== undefined ? c.name : t('perf.home.cycle')} className={cn('min-h-[220px]', className)} aside={c !== undefined ? <AsideLink href={`#/performance/cycles/${c.id}`}>{t('perf.home.open_cycle')}</AsideLink> : undefined}>
      {c === undefined ? (
        <Empty icon={CalendarCheck} title={t('perf.home.no_cycle')} className="py-8" action={hrFull ? <Button icon={Plus} onClick={() => navigate('/performance/cycles/new')}>{t('perf.cycle.new')}</Button> : undefined}>
          {hrFull ? t('perf.home.no_cycle_hr') : t('perf.home.no_cycle_text')}
        </Empty>
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          <div className="text-[13px] text-[var(--hr-ink-2)]">{phaseNow(c.phases, h.today)}</div>
          <PhaseStrip phases={c.phases} today={h.today} />
          {(h.hr || h.manager) && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              {(['self', 'manager'] as const).map((k) =>
                c.counts.reviews[k].total > 0 ? (
                  <div key={k} className="min-w-0">
                    <div className="hr-label">{t('perf.home.kind_in', { kind: kindLabel(k) })}</div>
                    <ProgressBar value={(c.counts.reviews[k].submitted / Math.max(1, c.counts.reviews[k].total)) * 100} className="mt-1" />
                    <div className="hr-mono hr-num mt-0.5 text-[12px] text-[var(--hr-muted)]">
                      {c.counts.reviews[k].submitted}/{c.counts.reviews[k].total}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}
          {h.cycles.length > 1 && <div className="text-[12px] text-[var(--hr-muted)]">{tn('perf.home.more_cycles', h.cycles.length - 1)}</div>}
        </div>
      )}
    </Panel>
  );
}

function GoalsPanel({ h, className, onCheckin, onAdd }: { h: PerfHome; className?: string | undefined; onCheckin: (g: Goal) => void; onAdd: () => void }): React.JSX.Element {
  return (
    <Panel index="03" label={t('perf.home.goals')} className={className} aside={<AsideLink href="#/performance/goals">{t('perf.home.all_goals')}</AsideLink>}>
      {h.goals.length === 0 ? (
        <Empty icon={Target} title={t('perf.home.goals_fine')} className="py-8" action={h.employee !== null ? <Button icon={Plus} onClick={onAdd}>{t('perf.goal.add')}</Button> : undefined}>
          {t('perf.home.goals_fine_text')}
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {h.goals.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--hr-hair)] px-1.5 py-2.5 last:border-b-0">
              <a href={`#/performance/goals/${g.id}`} className="hr-focus hit min-w-0 flex-1 basis-[220px] rounded-[3px]">
                <span className="hr-link hr-wrap block text-[13px] font-medium">{g.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <GoalStatusDot status={g.status} />
                  <Reasons goal={g} />
                </span>
              </a>
              <ProgressBar value={g.progress} status={g.status} className="w-[150px]" label={g.title} />
              {g.can.edit && (
                <Button size="sm" onClick={() => onCheckin(g)}>
                  {t('perf.checkin.short')}
                </Button>
              )}
            </li>
          ))}
          {h.goals_total > h.goals.length && <li className="px-1.5 pt-2 text-[12px] text-[var(--hr-muted)]">{tn('perf.home.more_goals', h.goals_total - h.goals.length)}</li>}
        </ul>
      )}
    </Panel>
  );
}

function PraisePanel({ h, className, onGive, canGive }: { h: PerfHome; className?: string | undefined; onGive: () => void; canGive: boolean }): React.JSX.Element {
  return (
    <Panel index="04" label={t('perf.home.praise')} className={className} aside={canGive ? <Button size="sm" variant="ghost" icon={Heart} onClick={onGive}>{t('perf.fb.give_praise')}</Button> : undefined}>
      {h.praise.length === 0 ? (
        <Empty icon={Sparkle} title={t('perf.home.no_praise')} className="py-8">
          {h.settings.praise_wall ? t('perf.home.no_praise_text') : t('perf.home.wall_off')}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {h.praise.map((p) => (
            <li key={p.id} className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-raised)] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <PersonChip name={p.to?.name ?? ''} size={22} sub={t('perf.fb.from', { name: p.from?.name ?? p.from_name })} />
                <span className="flex-1" />
                <span className="hr-label shrink-0">{ago(p.created)}</span>
              </div>
              <p className="hr-wrap mt-1.5 text-[13px] leading-5">{p.text}</p>
              {p.values.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.values.map((v) => (
                    <ValueTag key={v.code} name={v.name} icon={v.icon} />
                  ))}
                </div>
              )}
            </li>
          ))}
          {h.praise_total > h.praise.length && (
            <li>
              <a href="#/performance/feedback" className="hr-link hr-focus hit inline-flex h-6 items-center text-[12px] text-[var(--hr-ink-2)]">
                {tn('perf.home.more_praise', h.praise_total - h.praise.length)}
              </a>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}
