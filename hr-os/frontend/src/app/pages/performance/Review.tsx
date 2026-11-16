/**
 * The review form: one column of sections (goals, competencies, questions,
 * the overall rating), ratings as a segmented scale, every change saved as
 * a draft a moment after you stop typing. Beside it (below on a phone) what
 * the reviewer has at hand: the person's goals and check-ins, feedback and
 * praise of the period, the other submitted reviews, and your AI agent's
 * neutral summary, which the reviewer may use or ignore (it never rates).
 * Shared with the person, the same page reads back and asks them to
 * acknowledge it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ClipboardCheck, Copy, RotateCcw, Send, Sparkle, Target, X } from 'lucide-react';
import { AgentMark, Button, Dialog, Empty, Field, LinkButton, LoadError, Loading, Notice, PageBody, PageHeader, Panel, PersonChip, Tabs, Tag, Textarea, toast } from '../../components/ui.tsx';
import { kindLabel, ProgressBar, RatingScaleInput, ValueTag, dueText, GoalStatusDot } from '../../components/performance/bits.tsx';
import type { Checkin, FeedbackRow, Goal, Review, ReviewBrief, Scale, Section, Summary } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { copyText, op, toOpError } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay, fmtRange, fmtStampDay, time, today } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { cn } from '../../../kit/index.ts';
import { AgentAskStatus } from '../../components/agent.tsx';

interface Context {
  goals: Goal[];
  checkins: Checkin[];
  feedback: FeedbackRow[];
  trainings: { id: string; program_name: string; completed_on: string; result: string }[];
}

function scoreOf(sections: Section[], ratings: Record<string, number>): number | null {
  let total = 0;
  let weights = 0;
  for (const s of sections) {
    if (s.kind === 'questions' || !((s.weight ?? 0) > 0)) continue;
    let sum = 0;
    let w = 0;
    if (s.kind === 'goals') {
      if (s.rate === false) continue;
      const goals = s.goals ?? [];
      const allZero = goals.every((g) => !(g.weight > 0));
      for (const g of goals) {
        const v = ratings[`${s.key}.${g.id}`];
        if (v === undefined || v <= 0) continue;
        const gw = allZero ? 1 : g.weight;
        sum += v * gw;
        w += gw;
      }
    } else
      for (const it of s.items ?? []) {
        const v = ratings[`${s.key}.${it.key}`];
        if (v === undefined || v <= 0) continue;
        sum += v;
        w += 1;
      }
    if (w === 0) continue;
    total += (sum / w) * (s.weight ?? 0);
    weights += s.weight ?? 0;
  }
  return weights === 0 ? null : Math.round((total / weights) * 100) / 100;
}

export function ReviewPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = params['id'] ?? '';
  const live = useOp<{ review: Review }>('reviews.get', { review: id }, READS.reviews, { name: 'perf.review' });
  const r = live.data?.review ?? null;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [overall, setOverall] = useState(0);
  const [savedAt, setSavedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<'form' | 'reference'>('form');
  const [ackOpen, setAckOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const pending = useRef<{ answers: Record<string, string>; ratings: Record<string, number>; overall?: number | undefined }>({ answers: {}, ratings: {} });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef('');

  useEffect(() => {
    if (r === null || loadedFor.current === r.id) return;
    loadedFor.current = r.id;
    setAnswers(r.answers);
    setRatings(r.ratings);
    setOverall(r.overall);
    setSavedAt(r.saved_at);
  }, [r]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (Object.keys(p.answers).length === 0 && Object.keys(p.ratings).length === 0 && p.overall === undefined) return true;
    pending.current = { answers: {}, ratings: {} };
    setSaving(true);
    try {
      const out = await op<{ saved_at: string }>('reviews.save', { review: id, answers: p.answers, ratings: p.ratings, ...(p.overall !== undefined ? { overall: p.overall } : {}) }, { quiet: true });
      setSavedAt(out.saved_at);
      return true;
    } catch (e) {
      toast.error(toOpError(e).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [id]);

  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  const queue = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  };
  const setAnswer = (k: string, v: string): void => {
    setAnswers((a) => ({ ...a, [k]: v }));
    pending.current.answers[k] = v;
    setMissing((m) => (m.has(k) ? new Set([...m].filter((x) => x !== k)) : m));
    queue();
  };
  const setRating = (k: string, v: number): void => {
    setRatings((a) => {
      const n = { ...a };
      if (v === 0) delete n[k];
      else n[k] = v;
      return n;
    });
    pending.current.ratings[k] = v;
    setMissing((m) => (m.has(k) ? new Set([...m].filter((x) => x !== k)) : m));
    queue();
  };
  const setOverallRating = (v: number): void => {
    setOverall(v);
    pending.current.overall = v;
    setMissing((m) => (m.has('overall') ? new Set([...m].filter((x) => x !== 'overall')) : m));
    queue();
  };

  const submit = async (): Promise<void> => {
    if (!(await flush())) return;
    setBusy('submit');
    try {
      await op('reviews.submit', { review: id }, { quiet: true });
      changed(...READS.reviews);
      setMissing(new Set());
      toast.success(t('perf.review.submitted'));
    } catch (e) {
      const err = toOpError(e);
      if (err.code === 'incomplete') {
        const keys = ((err.data['missing'] as { key: string }[] | undefined) ?? []).map((m) => m.key);
        setMissing(new Set(keys));
        setTab('form');
        const first = keys[0];
        if (first !== undefined) document.getElementById(`rf-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  if (r === null)
    return (
      <>
        <PageHeader title={t('perf.review.title')} back="#/performance" />
        <PageBody>{live.error !== null ? <LoadError message={live.code === 'not_shared' ? t('perf.review.not_shared') : live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );

  const write = r.can.write;
  const shared = r.kind === 'manager' && ['shared', 'acknowledged', 'signoff', 'signed'].includes(r.participant.stage);
  const forMe = !r.mine && me.employee?.id === r.employee.id && r.kind === 'manager' && r.participant.stage === 'shared';
  const score = scoreOf(r.sections, write ? ratings : r.ratings);
  const title = r.kind === 'self' && r.mine ? t('perf.review.self_title') : t('perf.review.other_title', { kind: kindLabel(r.kind), name: r.employee.name });
  const status = write ? (saving ? t('perf.review.saving') : savedAt !== '' ? t('perf.review.saved_at', { time: time(savedAt) }) : t('perf.review.draft')) : t(`perf.review.status.${r.status}`);
  const meta = [r.cycle.name, write ? dueText(r.due, today()) : '', status].filter((x) => x !== '').join(' · ');
  const reference = <ReferencePanel review={r} start={r.sections.length + (r.overall_enabled ? 1 : 0) + 1} onUse={(key, text) => setAnswer(key, (answers[key] ?? '') === '' ? text : `${answers[key] ?? ''}\n\n${text}`)} />;

  return (
    <>
      <PageHeader title={title} meta={meta} back={r.mine ? '#/performance' : `#/performance/cycles/${r.cycle.id}?participant=${r.participant.id}`}>
        {r.can.decline && (
          <Button variant="ghost" icon={X} onClick={() => setDeclineOpen(true)}>
            {t('perf.review.decline')}
          </Button>
        )}
        {r.can.reopen && (
          <Button icon={RotateCcw} onClick={() => void op('reviews.reopen', { review: r.id }).then(() => (changed(...READS.reviews), toast.success(t('perf.review.reopened'))))}>
            {t('perf.review.reopen')}
          </Button>
        )}
        {r.can.submit && (
          <Button variant="primary" icon={Send} busy={busy === 'submit'} onClick={() => void submit()}>
            {t('perf.review.submit')}
          </Button>
        )}
        {forMe && (
          <Button variant="primary" icon={CheckCircle2} onClick={() => setAckOpen(true)}>
            {t('perf.review.acknowledge')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <Tabs
          value={tab}
          onChange={setTab}
          label={t('perf.review.title')}
          className="mb-3 lg:hidden"
          tabs={[
            { value: 'form', label: t('perf.review.tab_form') },
            { value: 'reference', label: t('perf.review.tab_reference') },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className={cn('min-w-0 lg:col-span-7 xl:col-span-8', tab !== 'form' && 'hidden lg:block')}>
            <div className="mx-auto flex max-w-[720px] flex-col gap-3">
              {r.participant.returned_note !== '' && r.mine && <Notice tone="warn">{t('perf.review.returned', { note: r.participant.returned_note })}</Notice>}
              {shared && r.participant.rating !== null && r.participant.rating > 0 && (
                <Notice tone="good">
                  <span className="font-medium">{t('perf.review.final', { label: r.participant.rating_label })}</span>
                  {r.participant.stage === 'signed' && <span className="ml-2 text-[var(--hr-muted)]">{t('perf.review.signed')}</span>}
                  {r.participant.stage === 'signoff' && <span className="ml-2 text-[var(--hr-muted)]">{t('perf.review.signoff_wait')}</span>}
                  {r.participant.stage === 'acknowledged' && <span className="ml-2 text-[var(--hr-muted)]">{t('perf.review.acked')}</span>}
                </Notice>
              )}
              <div className="flex flex-wrap items-center gap-3 px-0.5">
                <PersonChip name={r.employee.name} sub={[r.employee.title, r.employee.department_name].filter((x) => x !== '').join(' · ')} size={32} />
                <span className="flex-1" />
                <span className="hr-label">{fmtRange(r.cycle.period_start, r.cycle.period_end)}</span>
              </div>
              {r.sections.map((s, i) => (
                <SectionPanel key={s.key} index={String(i + 1).padStart(2, '0')} section={s} scale={r.scale} write={write} answers={write ? answers : r.answers} ratings={write ? ratings : r.ratings} missing={missing} onAnswer={setAnswer} onRate={setRating} />
              ))}
              {r.overall_enabled && (
                <Panel index={String(r.sections.length + 1).padStart(2, '0')} label={t('perf.review.overall')}>
                  <div id="rf-overall" className={cn('flex flex-col gap-2 pt-1', missing.has('overall') && 'rounded-[var(--hr-radius-sm)] ring-2 ring-[var(--hr-bad)] ring-offset-2 ring-offset-[var(--hr-panel)]')}>
                    {write ? <RatingScaleInput scale={r.scale} value={overall} onChange={setOverallRating} label={t('perf.review.overall')} /> : <ReadRating scale={r.scale} value={r.overall} />}
                    {score !== null && <span className="text-[12px] text-[var(--hr-muted)]">{t('perf.review.calculated', { n: score.toFixed(2) })}</span>}
                  </div>
                </Panel>
              )}
              {write && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[12px] text-[var(--hr-muted)]">{status}</span>
                  <span className="flex-1" />
                  <Button icon={Send} busy={busy === 'submit'} onClick={() => void submit()}>
                    {t('perf.review.submit')}
                  </Button>
                </div>
              )}
            </div>
          </div>
          <aside className={cn('min-w-0 lg:col-span-5 xl:col-span-4', tab !== 'reference' && 'hidden lg:block')}>
            <div className="flex flex-col gap-3 lg:sticky lg:top-3">{reference}</div>
          </aside>
        </div>
      </PageBody>
      <AckDialog open={ackOpen} onClose={() => setAckOpen(false)} participant={r.participant.id} />
      <DeclineDialog open={declineOpen} onClose={() => setDeclineOpen(false)} review={r.id} />
    </>
  );
}

function SectionPanel({ index, section: s, scale, write, answers, ratings, missing, onAnswer, onRate }: { index: string; section: Section; scale: Scale; write: boolean; answers: Record<string, string>; ratings: Record<string, number>; missing: Set<string>; onAnswer: (k: string, v: string) => void; onRate: (k: string, v: number) => void }): React.JSX.Element {
  const ring = (k: string): string => (missing.has(k) ? 'rounded-[var(--hr-radius-sm)] ring-2 ring-[var(--hr-bad)] ring-offset-2 ring-offset-[var(--hr-panel)]' : '');
  return (
    <Panel index={index} label={s.title} aside={s.kind !== 'questions' && (s.weight ?? 0) > 0 ? <span className="hr-label">{t('perf.review.weight', { n: s.weight ?? 0 })}</span> : undefined}>
      <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
        {s.kind === 'goals' &&
          ((s.goals ?? []).length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('perf.review.no_goals')}</p>
          ) : (
            (s.goals ?? []).map((g) => {
              const k = `${s.key}.${g.id}`;
              return (
                <div key={g.id} id={`rf-${k}`} className={cn('flex flex-col gap-2 py-3 first:pt-1', ring(k))}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a href={`#/performance/goals/${g.id}`} className="hr-link hr-focus hit hr-wrap min-h-6 min-w-0 flex-1 rounded-[3px] text-[13px] font-medium">
                      {g.title}
                    </a>
                    {g.weight > 0 && <Tag tone="faint">{t('perf.review.weight', { n: g.weight })}</Tag>}
                    <GoalStatusDot status={g.status} />
                  </div>
                  <ProgressBar value={g.progress} status={g.status} label={g.title} />
                  {s.rate !== false && (write ? <RatingScaleInput scale={scale} value={ratings[k] ?? 0} onChange={(v) => onRate(k, v)} label={g.title} compact /> : <ReadRating scale={scale} value={ratings[k] ?? 0} />)}
                  <Answer k={k} value={answers[k] ?? ''} write={write} onChange={onAnswer} placeholder={t('perf.review.goal_comment')} optional />
                </div>
              );
            })
          ))}
        {s.kind === 'competencies' &&
          (s.items ?? []).map((it) => {
            const k = `${s.key}.${it.key}`;
            return (
              <div key={it.key} id={`rf-${k}`} className={cn('flex flex-col gap-2 py-3 first:pt-1', ring(k))}>
                <div>
                  <div className="text-[13px] font-medium">{it.name}</div>
                  {it.description !== undefined && it.description !== '' && <div className="hr-wrap text-[12px] leading-4 text-[var(--hr-muted)]">{it.description}</div>}
                </div>
                {write ? <RatingScaleInput scale={scale} value={ratings[k] ?? 0} onChange={(v) => onRate(k, v)} label={it.name ?? ''} /> : <ReadRating scale={scale} value={ratings[k] ?? 0} />}
                <Answer k={k} value={answers[k] ?? ''} write={write} onChange={onAnswer} placeholder={t('perf.review.example')} optional collapsed />
              </div>
            );
          })}
        {s.kind === 'questions' &&
          (s.items ?? []).map((it) => {
            const k = `${s.key}.${it.key}`;
            return (
              <div key={it.key} id={`rf-${k}`} className={cn('flex flex-col gap-1.5 py-3 first:pt-1', ring(k))}>
                <div className="hr-wrap text-[13px] font-medium">
                  {it.text}
                  {it.required === true && write && <span className="ml-1 text-[var(--hr-muted)]">{t('perf.review.required')}</span>}
                </div>
                {it.help !== undefined && it.help !== '' && <div className="text-[12px] text-[var(--hr-muted)]">{it.help}</div>}
                <Answer k={k} value={answers[k] ?? ''} write={write} onChange={onAnswer} />
              </div>
            );
          })}
      </div>
    </Panel>
  );
}

function Answer({ k, value, write, onChange, placeholder, optional, collapsed }: { k: string; value: string; write: boolean; onChange: (k: string, v: string) => void; placeholder?: string | undefined; optional?: boolean | undefined; collapsed?: boolean | undefined }): React.JSX.Element | null {
  const [open, setOpen] = useState(collapsed !== true || value !== '');
  if (!write) return value !== '' ? <p className="hr-wrap whitespace-pre-wrap text-[13px] leading-5 text-[var(--hr-ink-2)]">{value}</p> : optional === true ? null : <p className="text-[12px] text-[var(--hr-faint)]">{t('perf.review.no_answer')}</p>;
  if (!open)
    return (
      <LinkButton onClick={() => setOpen(true)} className="h-6 self-start">
        {t('perf.review.add_comment')}
      </LinkButton>
    );
  return <Textarea value={value} onChange={(e) => onChange(k, e.target.value)} minRows={collapsed === true || optional === true ? 2 : 3} maxRows={16} maxLength={6000} placeholder={placeholder} aria-label={placeholder ?? k} />;
}

function ReadRating({ scale, value }: { scale: Scale; value: number }): React.JSX.Element {
  if (!(value > 0)) return <span className="text-[12px] text-[var(--hr-faint)]">{t('perf.review.not_rated')}</span>;
  return (
    <span className="flex items-center gap-2">
      <Tag tone="rh">
        {value} / {scale.points}
      </Tag>
      <span className="text-[13px]">{scale.labels[value - 1] ?? ''}</span>
    </span>
  );
}

/** What the reviewer has at hand: your AI agent's summary, the person's goals, feedback, the other reviews. */
function ReferencePanel({ review: r, start, onUse }: { review: Review; start: number; onUse: (key: string, text: string) => void }): React.JSX.Element {
  const ctx = useOp<Context>('reviews.context', { review: r.id }, [...READS.goals, ...READS.feedback, ...READS.training], { skip: !(r.mine || !r.hidden) });
  let next = start;
  const num = (): string => String(next++).padStart(2, '0');
  const questions = r.sections.filter((s) => s.kind === 'questions').flatMap((s) => (s.items ?? []).map((it) => ({ key: `${s.key}.${it.key}`, text: it.text ?? '' })));
  return (
    <>
      {(r.can.request_summary || (r.summaries ?? []).length > 0) && <SummaryPanel review={r} questions={questions} onUse={onUse} />}
      {(r.related ?? []).length > 0 && <RelatedPanel index={num()} related={r.related ?? []} sections={r.sections} scale={r.scale} />}
      <Panel index={num()} label={t('perf.review.ref_goals')}>
        {ctx.data === null ? (
          <Loading className="min-h-[80px]" />
        ) : ctx.data.goals.length === 0 ? (
          <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.review.ref_no_goals')}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {ctx.data.goals.map((g) => {
              const last = ctx.data?.checkins.find((c) => c.goal_title === g.title);
              return (
                <li key={g.id}>
                  <div className="hr-wrap text-[12px] font-medium">{g.title}</div>
                  <ProgressBar value={g.progress} status={g.status} label={g.title} className="mt-0.5" />
                  {last !== undefined && last.note !== '' && <div className="hr-wrap mt-0.5 text-[12px] text-[var(--hr-muted)]">{t('perf.review.last_note', { when: fmtStampDay(last.at), note: last.note })}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel index={num()} label={t('perf.review.ref_feedback')}>
        {ctx.data === null ? (
          <Loading className="min-h-[80px]" />
        ) : ctx.data.feedback.length === 0 ? (
          <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.review.ref_no_feedback')}</p>
        ) : (
          <ul className="hr-scroll flex max-h-[360px] flex-col gap-2 overflow-y-auto">
            {ctx.data.feedback.map((f) => (
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
      {ctx.data !== null && ctx.data.trainings.length > 0 && (
        <Panel index={num()} label={t('perf.review.ref_training')}>
          <ul className="flex flex-col gap-1">
            {ctx.data.trainings.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate">{x.program_name}</span>
                <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">{fmtDay(x.completed_on)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function SummaryPanel({ review: r, questions, onUse }: { review: Review; questions: { key: string; text: string }[]; onUse: (key: string, text: string) => void }): React.JSX.Element {
  const s: Summary | undefined = (r.summaries ?? []).find((x) => x.status !== 'dismissed');
  const [busy, setBusy] = useState(false);
  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('reviews.request-summary', { review: r.id });
      changed(...READS.reviews);
      toast.success(t('perf.sum.asked'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const mark = async (status: 'used' | 'dismissed'): Promise<void> => {
    if (s === undefined) return;
    try {
      await op('review-summaries.mark', { summary: s.id, status });
      changed(...READS.reviews);
    } catch {
      /* toast shown */
    }
  };
  return (
    <section className="hr-panel hr-in border-[var(--hr-agent)] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <AgentMark size={22} working={s?.status === 'requested'} />
        <span className="hr-label flex-1">{t('perf.sum.title')}</span>
      </div>
      {s === undefined ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-5 text-[var(--hr-ink-2)]">{t('perf.sum.what')}</p>
          {r.can.request_summary && (
            <Button variant="agent" icon={Sparkle} busy={busy} onClick={() => void ask()} className="self-start">
              {t('perf.sum.ask')}
            </Button>
          )}
        </div>
      ) : s.status === 'requested' ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] text-[var(--hr-ink-2)]">{t('perf.sum.working')}</p>
          <AgentAskStatus ask={s.agent} reads={READS.reviews} canRetry={r.can.request_summary} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="hr-wrap hr-scroll max-h-[320px] overflow-y-auto whitespace-pre-wrap text-[13px] leading-5">{s.text}</p>
          <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.sum.note')}</p>
          {r.can.write && (
            <div className="flex flex-wrap items-center gap-2">
              {questions[0] !== undefined && (
                <Button
                  size="sm"
                  icon={ClipboardCheck}
                  title={questions[0].text}
                  onClick={() => {
                    const q = questions[0];
                    if (q === undefined) return;
                    onUse(q.key, s.text);
                    void mark('used');
                    document.getElementById(`rf-${q.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  {t('perf.sum.use')}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copyText(s.text).then((ok) => ok && toast.success(t('ui.copied')))}>
                {t('ui.copy')}
              </Button>
              <LinkButton className="h-6" onClick={() => void mark('dismissed')}><X size={12} strokeWidth={2} aria-hidden />{t('perf.sum.dismiss')}</LinkButton>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RelatedPanel({ index, related, sections, scale }: { index: string; related: ReviewBrief[]; sections: Section[]; scale: Scale }): React.JSX.Element {
  const [open, setOpen] = useState(related[0]?.id ?? '');
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) for (const it of s.items ?? []) m.set(`${s.key}.${it.key}`, it.text ?? it.name ?? it.key);
    return m;
  }, [sections]);
  const keys = [...labels.keys()];
  const order = (k: string): number => {
    const i = keys.indexOf(k);
    return i < 0 ? keys.length : i;
  };
  return (
    <Panel index={index} label={t('perf.review.others')}>
      <div className="flex flex-col gap-2">
        {related.map((x) => (
          <div key={x.id} className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-raised)]">
            <button type="button" onClick={() => setOpen(open === x.id ? '' : x.id)} aria-expanded={open === x.id} className="hr-focus flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-[var(--hr-hover)]">
              <Tag tone="faint">{kindLabel(x.kind)}</Tag>
              <span className="min-w-0 flex-1 truncate text-[12px]">{x.anonymous ? t('perf.review.anonymous') : x.reviewer?.name ?? ''}</span>
              {x.overall > 0 && <span className="text-[12px] text-[var(--hr-muted)]">{x.overall_label}</span>}
              <ChevronDown size={14} aria-hidden className={cn('shrink-0 text-[var(--hr-muted)] transition-transform duration-150', open === x.id && 'rotate-180')} />
            </button>
            {open === x.id && (
              <div className="flex flex-col gap-2 border-t border-[var(--hr-hair)] px-2.5 py-2">
                {Object.entries(x.answers)
                  .sort((a, b) => order(a[0]) - order(b[0]))
                  .map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[12px] text-[var(--hr-muted)]">{labels.get(k) ?? t('perf.review.goal_note')}</div>
                    <p className="hr-wrap whitespace-pre-wrap text-[13px] leading-5">{v}</p>
                  </div>
                ))}
                {Object.keys(x.ratings).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(x.ratings).map(([k, v]) => (
                      <span key={k} className="rounded-[3px] bg-[var(--hr-sunk)] px-1.5 py-0.5 text-[12px] text-[var(--hr-ink-2)]" title={scale.labels[v - 1]}>
                        {(labels.get(k) ?? t('perf.review.goal_rating')).slice(0, 28)}: {v}
                      </span>
                    ))}
                  </div>
                )}
                {Object.keys(x.answers).length === 0 && Object.keys(x.ratings).length === 0 && <Empty icon={Target} title={t('perf.review.no_answer')} className="py-3" />}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AckDialog({ open, onClose, participant }: { open: boolean; onClose: () => void; participant: string }): React.JSX.Element | null {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ participant: { stage: string } }>('reviews.acknowledge', { participant, comment });
      changed(...READS.reviews);
      toast.success(r.participant.stage === 'signoff' ? t('perf.review.acked_signoff') : t('perf.review.acked_done'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('perf.review.acknowledge')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} onClick={() => void save()}>{t('perf.review.acknowledge')}</Button></>}>
      <Field label={t('perf.review.ack_comment')} optional hint={t('perf.review.ack_hint')}>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} minRows={3} maxLength={2000} />
      </Field>
    </Dialog>
  );
}

function DeclineDialog({ open, onClose, review }: { open: boolean; onClose: () => void; review: string }): React.JSX.Element | null {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('reviews.decline', { review, reason });
      changed(...READS.reviews);
      toast.success(t('perf.review.declined'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('perf.review.decline')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" icon={X} busy={busy} onClick={() => void save()}>{t('perf.review.decline')}</Button></>}>
      <Field label={t('perf.review.decline_reason')} optional>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} maxLength={1000} />
      </Field>
    </Dialog>
  );
}
