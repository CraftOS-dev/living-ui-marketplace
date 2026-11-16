/**
 * The performance tab of a person's profile: goals with quiet bars, the
 * reviews the viewer may open (with the rating when they may see it),
 * praise and feedback they received, skills against the job title, and
 * trainings with what is still required.
 */
import { useState } from 'react';
import { BadgeCheck, ClipboardCheck, GraduationCap, Heart, Plus, Target } from 'lucide-react';
import { Button, Empty, LoadError, Loading, Panel, RowCue, StatusDot, Tag } from '../../components/ui.tsx';
import { FeedbackDialog, GoalDialog } from '../../components/performance/dialogs.tsx';
import { AsideLink, GoalStatusDot, kindLabel, ProgressBar, ValueTag } from '../../components/performance/bits.tsx';
import type { Attendee, Chip, ComplianceRow, FeedbackRow, Goal, ReviewKind } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import type { ProfileTabProps } from '../../lib/contract.ts';
import { ago, fmtDay, fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { STATE_TONE } from './Training.tsx';

interface ProfileData {
  employee: Chip;
  relation: { self: boolean; manager: boolean; team: boolean; hr: string };
  goals: Goal[];
  reviews: { participant: string; cycle: string; cycle_name: string; cycle_status: string; period_start: string; period_end: string; stage: string; rating: number | null; rating_label: string; reviews: { id: string; kind: ReviewKind; status: string }[] }[];
  feedback: FeedbackRow[];
  skills: { skills: { id: string; skill: string; category: string; level: number; verified: boolean; verified_by: string; expected: number }[]; expected_missing: { skill: string; expected: number }[] };
  trainings: { attendance: Attendee[]; due: ComplianceRow[] };
}

export function PerformanceTab({ employee, self }: ProfileTabProps): React.JSX.Element {
  const live = useOp<ProfileData>('perf.profile', { employee }, [...READS.goals, ...READS.reviews, ...READS.feedback, ...READS.skills, ...READS.training], { name: 'perf.profile' });
  const [goalOpen, setGoalOpen] = useState(false);
  const [praise, setPraise] = useState(false);
  const p = live.data;
  if (p === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const canAddGoal = p.relation.self || p.relation.team || p.relation.hr === 'edit' || p.relation.hr === 'full';
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('perf.prof.goals')} className="lg:col-span-7" aside={canAddGoal ? <Button size="sm" variant="ghost" icon={Plus} onClick={() => setGoalOpen(true)}>{t('perf.goal.add')}</Button> : undefined}>
        {p.goals.length === 0 ? (
          <Empty icon={Target} title={t('perf.prof.no_goals')} className="py-6" />
        ) : (
          <ul className="flex flex-col">
            {p.goals.map((g) => (
              <li key={g.id}>
                <a href={`#/performance/goals/${g.id}`} className="group hr-focus flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] px-1.5 py-2 last:border-b-0 hover:bg-[var(--hr-hover)]">
                  <span className="min-w-0 flex-1 basis-[200px]">
                    <span className="hr-wrap block text-[13px] font-medium">{g.title}</span>
                    <GoalStatusDot status={g.status} />
                  </span>
                  <ProgressBar value={g.progress} status={g.status} className="w-[150px]" label={g.title} />
                  <RowCue />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel index="02" label={t('perf.prof.reviews')} className="lg:col-span-5">
        {p.reviews.length === 0 ? (
          <Empty icon={ClipboardCheck} title={t('perf.prof.no_reviews')} className="py-6" />
        ) : (
          <ul className="flex flex-col gap-2">
            {p.reviews.map((r) => (
              <li key={r.participant} className="border-b border-[var(--hr-hair)] pb-2 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.cycle_name}</span>
                  {r.rating !== null && r.rating > 0 && <Tag tone="rh">{r.rating_label}</Tag>}
                </div>
                <div className="hr-label mt-0.5">{fmtRange(r.period_start, r.period_end)} · {t(`perf.stage.${r.stage}`)}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {r.reviews.map((x) => (
                    <a key={x.id} href={`#/performance/reviews/${x.id}`} className="hr-link hr-focus hit inline-flex h-6 items-center rounded-[3px] text-[12px] text-[var(--hr-ink-2)]">
                      {kindLabel(x.kind)}
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel index="03" label={t('perf.prof.feedback')} className="lg:col-span-7" aside={!self ? <Button size="sm" variant="ghost" icon={Heart} onClick={() => setPraise(true)}>{t('perf.fb.give_praise')}</Button> : undefined}>
        {p.feedback.length === 0 ? (
          <Empty icon={Heart} title={t('perf.prof.no_feedback')} className="py-6" />
        ) : (
          <ul className="flex flex-col gap-2">
            {p.feedback.map((f) => (
              <li key={f.id} className="border-l-2 border-[var(--hr-line-2)] pl-2.5">
                <div className="text-[12px] text-[var(--hr-muted)]">
                  {t(`perf.fb.kind.${f.kind}`)} · {f.from?.name ?? f.from_name} · {ago(f.created)}
                </div>
                <p className="hr-wrap text-[13px] leading-5">{f.text}</p>
                {f.values.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.values.map((v) => (
                      <ValueTag key={v.code} name={v.name} icon={v.icon} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel index="04" label={t('perf.prof.skills')} className="lg:col-span-5" aside={<AsideLink href="#/performance/skills">{t('perf.prof.matrix')}</AsideLink>}>
        {p.skills.skills.length === 0 && p.skills.expected_missing.length === 0 ? (
          <Empty icon={BadgeCheck} title={t('perf.prof.no_skills')} className="py-6" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {p.skills.skills.map((s) => (
              <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_14px_32px_minmax(0,120px)] items-center gap-2">
                <span className="min-w-0 truncate text-[13px]">{s.skill}</span>
                <span>{s.verified && <BadgeCheck size={13} aria-label={t('perf.skills.verified')} className="text-[var(--hr-ink-2)]" />}</span>
                <span className="hr-mono hr-num text-[12px]">
                  {s.level}
                  <span className="text-[var(--hr-faint)]">/5</span>
                </span>
                <span className="min-w-0">{s.expected > 0 && s.level < s.expected && <Tag tone="warn">{t('perf.prof.expects', { n: s.expected })}</Tag>}</span>
              </li>
            ))}
            {p.skills.expected_missing.map((s) => (
              <li key={s.skill} className="grid grid-cols-[minmax(0,1fr)_14px_32px_minmax(0,120px)] items-center gap-2 text-[var(--hr-muted)]">
                <span className="min-w-0 truncate text-[13px]">{s.skill}</span>
                <span />
                <span />
                <span className="min-w-0">
                  <Tag tone="warn">{t('perf.prof.expects', { n: s.expected })}</Tag>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel index="05" label={t('perf.prof.training')} className="lg:col-span-12">
        {p.trainings.attendance.length === 0 && p.trainings.due.length === 0 ? (
          <Empty icon={GraduationCap} title={t('perf.prof.no_training')} className="py-6" />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ul className="flex flex-col gap-1.5">
              {p.trainings.due.map((d) => (
                <li key={d.requirement} className="grid grid-cols-[104px_minmax(0,1fr)_72px] items-center gap-2">
                  <StatusDot tone={STATE_TONE[d.state]} label={t(`perf.training.state.${d.state}`)} />
                  <span className="min-w-0 truncate text-[13px]">{d.program_name}</span>
                  <span className="hr-mono hr-num text-right text-[12px] text-[var(--hr-muted)]">{d.due !== '' ? fmtDay(d.due) : ''}</span>
                </li>
              ))}
              {p.trainings.due.length === 0 && <li className="text-[12px] text-[var(--hr-muted)]">{t('perf.prof.required_done')}</li>}
            </ul>
            <ul className="flex flex-col gap-1.5">
              {p.trainings.attendance.slice(0, 10).map((a) => (
                <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_88px_72px] items-center gap-2">
                  <span className="min-w-0 truncate text-[13px]">{a.program_name}</span>
                  <span className="truncate text-[12px] text-[var(--hr-muted)]">{t(`perf.tr.att.${a.status}`)}</span>
                  <span className="hr-mono hr-num text-right text-[12px] text-[var(--hr-muted)]">{fmtDay(a.completed_on || a.session?.start || '')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
      <GoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} employee={{ id: p.employee.id, name: p.employee.name }} />
      <FeedbackDialog open={praise} onClose={() => setPraise(false)} to={{ id: p.employee.id, name: p.employee.name }} />
    </div>
  );
}
