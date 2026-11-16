/**
 * Interviews: the scorecards you owe first, then the interviews by day
 * (yours, or everything you may see), and one interview's page: the kit's
 * questions, your scorecard (recommendation, a score of 1 to 4 per
 * criterion, notes), the others' once yours is in, and a neutral summary
 * your AI agent may draft.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarX, ClipboardPen, ExternalLink, FileText, MoreHorizontal, Sparkle, Video } from 'lucide-react';
import { Button, Empty, Field, LoadError, Loading, Menu, MenuItem, MenuSep, Notice, PageBody, PageHeader, Panel, RowCue, Segmented, Tag, Textarea, confirmAsk } from '../../components/ui.tsx';
import { ScheduleDialog } from '../../components/hiring/dialogs.tsx';
import { KV, RecBadge, Status, cx, localTime, names, whenText, zoneName } from '../../components/hiring/bits.tsx';
import { download, errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addDays, dayKey, fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import type { Candidate, Interview, Owed, Recommendation, Scorecard } from './types.ts';
import { READS } from './types.ts';
import { AgentAskStatus } from '../../components/agent.tsx';

/* ---------------------------------------------------------------- list */

export function InterviewsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const broadView = can(me, 'hiring', 'view');
  const mine = query.get('mine') === '1' || !broadView;
  const [earlier, setEarlier] = useState(false);
  const from = earlier ? addDays(dayKey(), -30) : addDays(dayKey(), -1);
  const to = earlier ? dayKey() : addDays(dayKey(), 21);
  const live = useOp<{ interviews: Interview[]; owed: Owed[] }>('interviews.list', { from, to, mine, status: earlier ? 'all' : 'scheduled' }, READS, { name: 'hiring.interviews' });
  const d = live.data;
  const byDay = useMemo(() => {
    const m = new Map<string, Interview[]>();
    for (const iv of earlier ? [...(d?.interviews ?? [])].reverse() : (d?.interviews ?? [])) {
      const arr = m.get(iv.day) ?? [];
      arr.push(iv);
      m.set(iv.day, arr);
    }
    return [...m.entries()];
  }, [d, earlier]);
  return (
    <>
      <PageHeader title={t('hiring.interviews')} meta={d !== null ? tn('hiring.meta_interviews', d.interviews.length) : undefined}>
        {broadView && <Segmented value={mine ? 'mine' : 'all'} onChange={(v) => setQuery({ mine: v === 'mine' ? '1' : undefined })} label={t('hiring.whose')} options={[{ value: 'mine', label: t('hiring.mine') }, { value: 'all', label: t('hiring.everyone') }]} />}
      </PageHeader>
      <PageBody>
        {d === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : (
          <div className="flex flex-col gap-3">
            {d.owed.length > 0 && (
              <Panel index="01" label={t('hiring.scorecards_owed')} aside={<span className="hr-label">{d.owed.length}</span>}>
                <ul className="-mx-1 flex flex-col">
                  {d.owed.map((o) => (
                    <li key={o.scorecard}>
                      <a href={`#/hiring/interviews/${o.interview}`} className="group hr-focus flex cursor-pointer items-center gap-3 rounded-[var(--hr-radius-sm)] px-2 py-2 hover:bg-[var(--hr-hover)]">
                        <ClipboardPen size={15} className="shrink-0 text-[var(--hr-muted)]" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="hr-wrap block text-[13px] font-medium">{o.candidate_name}</span>
                          <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{[o.title, o.opening_title, whenText(o.day, o.start, o.timezone)].join(' · ')}</span>
                        </span>
                        <span className="text-[12px] text-[var(--hr-ink-2)]">{o.status === 'draft' ? t('hiring.finish') : t('hiring.write')}</span>
                        <RowCue />
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <div className="hr-panel hr-in min-w-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
                <Segmented value={earlier ? 'past' : 'next'} onChange={(v) => setEarlier(v === 'past')} label={t('hiring.when')} size="sm" options={[{ value: 'next', label: t('hiring.coming_up') }, { value: 'past', label: t('hiring.last_30_days') }]} />
              </div>
              {byDay.length === 0 ? (
                <Empty icon={CalendarCheck} title={earlier ? t('hiring.no_past_interviews') : t('hiring.no_interviews')}>
                  {!earlier && (mine ? t('hiring.no_interviews_mine') : t('hiring.no_interviews_text'))}
                </Empty>
              ) : (
                <div className="flex flex-col">
                  {byDay.map(([day, list]) => (
                    <section key={day} className="border-b border-[var(--hr-line)] last:border-b-0">
                      <div className="hr-label sticky top-0 bg-[var(--hr-panel)] px-4 pb-1 pt-2.5">{day === dayKey() ? t('hiring.today') : fmtDay(day, { weekday: true })}</div>
                      <ul>
                        {list.map((iv) => (
                          <li key={iv.id}>
                            <a href={`#/hiring/interviews/${iv.id}`} className="group relative pr-10 hr-focus grid cursor-pointer grid-cols-[64px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-[var(--hr-hover)] md:grid-cols-[64px_minmax(0,1.3fr)_minmax(0,1fr)_120px]">
                              <span className="hr-mono hr-num pt-px text-[13px]">{iv.start}</span>
                              <span className="min-w-0">
                                <span className="hr-wrap block text-[13px] font-medium">{iv.candidate_name}</span>
                                <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{[iv.title, iv.opening_title].join(' · ')}</span>
                              </span>
                              <span className="hr-wrap col-start-2 text-[12px] text-[var(--hr-muted)] md:col-start-auto">{names(iv.interviewers)}</span>
                              <span className="col-start-2 flex items-center gap-2 md:col-start-auto md:justify-end">
                                {iv.mine && iv.my_scorecard !== 'submitted' && iv.status !== 'cancelled' && <Tag tone="rh">{t('hiring.you_interview')}</Tag>}
                                <Status kind="interview" status={iv.status} />
                              </span>
                              <RowCue className="absolute right-4 top-1/2 -translate-y-1/2" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

/* ----------------------------------------------------------- scorecard */

const RECS: Recommendation[] = ['strong_no', 'no', 'yes', 'strong_yes'];
const SCALE = [1, 2, 3, 4];

function ScorecardForm({ iv, mine }: { iv: Interview; mine: Scorecard }): React.JSX.Element {
  const criteria = iv.kit_detail?.criteria ?? [];
  const [rec, setRec] = useState<Recommendation | ''>(mine.recommendation);
  const [scores, setScores] = useState<Record<string, number>>(mine.scores);
  const [notes, setNotes] = useState(mine.notes);
  const [busy, setBusy] = useState<'' | 'save' | 'submit'>('');
  useEffect(() => {
    setRec(mine.recommendation);
    setScores(mine.scores);
    setNotes(mine.notes);
  }, [mine.id, mine.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const submitted = mine.status === 'submitted';
  const dirty = rec !== mine.recommendation || notes !== mine.notes || JSON.stringify(scores) !== JSON.stringify(mine.scores);
  const save = async (submit: boolean): Promise<void> => {
    setBusy(submit ? 'submit' : 'save');
    try {
      await op('scorecards.save', { interview: iv.id, recommendation: rec, scores, notes, submit }, { quiet: true });
      changed('interview_feedback', 'interviews', 'hiring_events');
      toast.success(submit ? (submitted ? t('hiring.scorecard_updated') : t('hiring.scorecard_submitted')) : t('hiring.scorecard_saved'));
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Panel index="01" label={t('hiring.your_scorecard')} aside={submitted ? <Tag tone="good">{t('hiring.submitted')}</Tag> : mine.status === 'draft' ? <Tag>{t('hiring.draft')}</Tag> : undefined}>
      <div className="flex flex-col gap-4">
        {criteria.length > 0 && (
          <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
            {criteria.map((c) => (
              <div key={c.key} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{c.name}</span>
                  {c.description !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{c.description}</span>}
                </span>
                <div className="inline-flex shrink-0 gap-1" role="radiogroup" aria-label={c.name}>
                  {SCALE.map((n) => {
                    const on = scores[c.key] === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        title={t(`hiring.scale.${n}`)}
                        onClick={() => setScores(on ? Object.fromEntries(Object.entries(scores).filter(([k]) => k !== c.key)) : { ...scores, [c.key]: n })}
                        className={cx('hr-focus hit flex h-8 min-w-[64px] cursor-pointer items-center justify-center rounded-[var(--hr-radius-sm)] border px-2 text-[12px] transition-colors', on ? 'border-[var(--hr-ink)] bg-[var(--hr-active)] font-medium text-[var(--hr-ink)] shadow-[inset_0_0_0_1px_var(--hr-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)]')}
                      >
                        <span className="hr-mono hr-num mr-1">{n}</span>
                        <span className="hidden sm:inline">{t(`hiring.scale.${n}`)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <Field label={t('hiring.notes_seen')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t('hiring.notes_seen')} minRows={5} placeholder={t('hiring.notes_placeholder')} />
        </Field>
        <Field label={t('hiring.recommendation')}>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label={t('hiring.recommendation')}>
            {RECS.map((r) => {
              const on = rec === r;
              return (
                <button key={r} type="button" role="radio" aria-checked={on} onClick={() => setRec(r)} className={cx('hr-focus flex h-9 cursor-pointer items-center justify-center rounded-[var(--hr-radius-sm)] border text-[13px] transition-colors', on ? 'border-[var(--hr-ink)] bg-[var(--hr-active)] font-medium text-[var(--hr-ink)] shadow-[inset_0_0_0_1px_var(--hr-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] hover:bg-[var(--hr-hover)]')}>
                  {t(`hiring.rec.${r}`)}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--hr-line)] pt-3">
          {!submitted && (
            <Button busy={busy === 'save'} disabled={!dirty || busy !== ''} onClick={() => void save(false)}>
              {t('hiring.save_draft')}
            </Button>
          )}
          <Button variant="primary" busy={busy === 'submit'} disabled={rec === '' || busy !== '' || (submitted && !dirty)} onClick={() => void save(true)}>
            {submitted ? t('hiring.update_scorecard') : t('hiring.submit_scorecard')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function OthersPanel({ iv }: { iv: Interview }): React.JSX.Element {
  const sc = iv.scorecard;
  const criteria = iv.kit_detail?.criteria ?? [];
  if (sc === undefined) return <></>;
  return (
    <Panel index="03" label={t('hiring.scorecards')} aside={<span className="hr-label">{sc.submitted}/{sc.total}</span>}>
      {!sc.can_see_others ? (
        <p className="text-[13px] text-[var(--hr-muted)]">{sc.hidden > 0 ? tn('hiring.hidden_until_yours_long', sc.hidden) : t('hiring.none_in_yet')}</p>
      ) : sc.others.length === 0 ? (
        <p className="text-[13px] text-[var(--hr-muted)]">{t('hiring.none_in_yet')}</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--hr-line)]">
          {sc.others.map((s) => (
            <article key={s.id} className="py-2.5 first:pt-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.interviewer_name}</span>
                <RecBadge value={s.recommendation} />
              </div>
              {criteria.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--hr-muted)]">
                  {criteria.map((c) => (
                    <span key={c.key}>
                      {c.name} <span className="hr-mono hr-num text-[var(--hr-ink)]">{s.scores[c.key] ?? '-'}</span>
                    </span>
                  ))}
                </div>
              )}
              {s.notes !== '' && <p className="hr-wrap whitespace-pre-line text-[13px]">{s.notes}</p>}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SummaryPanel({ iv }: { iv: Interview }): React.JSX.Element | null {
  const sc = iv.scorecard;
  if (sc === undefined || !sc.can_see_others) return null;
  const ask = async (): Promise<void> => {
    try {
      const r = await op<{ asked: boolean }>('interviews.summarize', { interview: iv.id });
      changed('interviews');
      if (r.asked) toast.info(t('hiring.agent_summarizing'), { label: t('hiring.open_inbox'), run: () => navigate('/inbox') });
      else toast.info(t('agent.already_asked'));
    } catch {
      /* toast shown */
    }
  };
  return (
    <Panel index="06" label={t('hiring.summary')}>
      {iv.summary !== '' ? (
        <div className="flex flex-col gap-2">
          <p className="hr-wrap whitespace-pre-line text-[13px]">{iv.summary}</p>
          <span className="hr-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--hr-muted)]">{fmtDay(iv.summary_at)}</span>
        </div>
      ) : iv.agent !== null && iv.agent !== undefined && iv.agent.ended_at === '' ? (
        <Notice tone="agent" action={<Button size="sm" onClick={() => navigate('/inbox')}>{t('hiring.open_inbox')}</Button>}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t('hiring.agent_on_summary')}
            <AgentAskStatus ask={iv.agent} reads={['interviews']} canRetry={iv.can?.summarize === true} />
          </span>
        </Notice>
      ) : (
        <p className="text-[13px] text-[var(--hr-muted)]">{t('hiring.no_summary')}</p>
      )}
      {iv.can?.summarize === true && iv.agent?.open !== true && (
        <Button className="mt-3" icon={Sparkle} onClick={() => void ask()}>
          {iv.summary !== '' ? t('hiring.summarize_again') : t('hiring.summarize')}
        </Button>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- page */

export function InterviewPage({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const live = useOp<{ interview: Interview; candidate: Candidate }>('interviews.get', { interview: id }, READS, { name: 'hiring.interview' });
  const [moving, setMoving] = useState(false);
  const d = live.data;
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const iv = d.interview;
  const c = d.candidate;
  const mine = iv.scorecard?.mine ?? null;
  const status = async (s: 'done' | 'no_show' | 'scheduled'): Promise<void> => {
    try {
      await op('interviews.set-status', { interview: iv.id, status: s });
      changed('interviews', 'hiring_events');
      toast.success(t(`hiring.iv_status_done.${s}`));
    } catch {
      /* toast shown */
    }
  };
  const cancel = async (): Promise<void> => {
    if (!(await confirmAsk(t('hiring.cancel_interview_text'), t('hiring.cancel_interview'), t('hiring.cancel_interview')))) return;
    try {
      const r = await op<{ calendar_event_left: boolean }>('interviews.cancel', { interview: iv.id });
      changed('interviews', 'interview_feedback', 'hiring_events');
      toast.success(r.calendar_event_left ? t('hiring.cancelled_cal_left') : t('hiring.interview_cancelled'));
    } catch {
      /* toast shown */
    }
  };
  const toCalendar = async (): Promise<void> => {
    try {
      await op('interviews.calendar', { interview: iv.id });
      changed('interviews');
      toast.success(t('hiring.added_calendar'));
    } catch {
      /* toast shown */
    }
  };
  const local = localTime(iv.at);
  const meta = [whenText(iv.day, iv.start, iv.timezone), tn('hiring.n_minutes', iv.duration_min), t(`hiring.kind.${iv.kind}`)].join(' · ');
  return (
    <>
      <PageHeader title={t('hiring.interview_with', { title: iv.title, name: iv.candidate_name })} meta={meta} back="#/hiring/interviews">
        {iv.link !== '' && iv.status === 'scheduled' && (
          <Button variant={mine !== null ? 'default' : 'primary'} icon={Video} onClick={() => window.open(iv.link, '_blank', 'noopener')}>
            {t('hiring.join')}
          </Button>
        )}
        {iv.can?.edit === true && (
          <Menu icon={MoreHorizontal} label={t('ui.more')} width={230}>
            {(close) => (
              <>
                {iv.status === 'scheduled' && <MenuItem onClick={() => (close(), setMoving(true))}>{t('hiring.reschedule')}</MenuItem>}
                {iv.can?.calendar === true && iv.calendar_event === '' && <MenuItem icon={CalendarCheck} onClick={() => (close(), void toCalendar())}>{t('hiring.add_to_calendar')}</MenuItem>}
                {iv.status === 'scheduled' && <MenuItem onClick={() => (close(), void status('done'))}>{t('hiring.mark_done')}</MenuItem>}
                {iv.status === 'scheduled' && <MenuItem onClick={() => (close(), void status('no_show'))}>{t('hiring.mark_no_show')}</MenuItem>}
                {iv.status !== 'scheduled' && iv.status !== 'cancelled' && <MenuItem onClick={() => (close(), void status('scheduled'))}>{t('hiring.mark_scheduled')}</MenuItem>}
                {iv.status === 'scheduled' && (
                  <>
                    <MenuSep />
                    <MenuItem icon={CalendarX} danger onClick={() => (close(), void cancel())}>
                      {t('hiring.cancel_interview')}
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        {iv.status === 'cancelled' && <Notice className="mb-3">{t('hiring.interview_was_cancelled')}</Notice>}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
            {mine !== null && iv.status !== 'cancelled' ? <ScorecardForm iv={iv} mine={mine} /> : null}
            {(iv.kit_detail?.questions ?? []).length > 0 && (
              <Panel index="02" label={t('hiring.questions')} aside={<span className="text-[12px] text-[var(--hr-muted)]">{iv.kit_name}</span>}>
                <ol className="flex flex-col gap-2">
                  {(iv.kit_detail?.questions ?? []).map((q, i) => (
                    <li key={q.key} className="flex gap-3">
                      <span className="hr-mono hr-num pt-px text-[12px] text-[var(--hr-muted)]">{String(i + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 flex-1">
                        <span className="hr-wrap block text-[13px]">{q.text}</span>
                        {(q.criterion !== '' || q.guidance !== '') && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{[iv.kit_detail?.criteria.find((c2) => c2.key === q.criterion)?.name, q.guidance].filter((x): x is string => typeof x === 'string' && x !== '').join(' · ')}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
            <OthersPanel iv={iv} />
          </div>
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
            <Panel index="04" label={t('hiring.candidate')}>
              <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
                <KV label={t('hiring.name')}>
                  <a href={`#/hiring/candidates/${c.id}`} className="hr-link hr-focus cursor-pointer rounded-[3px] font-medium">
                    {c.name}
                  </a>
                </KV>
                {(c.current_title !== '' || c.current_company !== '') && <KV label={t('hiring.now')}>{[c.current_title, c.current_company].filter((x) => x !== '').join(' · ')}</KV>}
                <KV label={t('hiring.opening')}>{[iv.opening_number, iv.opening_title].join(' ')}</KV>
                <KV label={t('hiring.stage')}>{iv.stage_name}</KV>
              </div>
              {c.has_resume && (
                <Button className="mt-3" size="sm" icon={FileText} onClick={() => void download('candidates.resume', { candidate: c.id }, 'open', c.resume_name)}>
                  {t('hiring.open_resume')}
                </Button>
              )}
            </Panel>
            <Panel index="05" label={t('hiring.details')}>
              <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
                <KV label={t('hiring.when')}>
                  {whenText(iv.day, iv.start, iv.timezone)}
                  {local !== '' && zoneName(iv.timezone) !== zoneName(Intl.DateTimeFormat().resolvedOptions().timeZone) && <span className="block text-[12px] text-[var(--hr-muted)]">{t('hiring.your_time', { time: local })}</span>}
                </KV>
                <KV label={t('hiring.panel')}>
                  <span className="flex flex-col">
                    {iv.interviewers.map((p) => (
                      <span key={p.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="text-[12px] text-[var(--hr-muted)]">{t(`hiring.sc_status.${p.scorecard || 'pending'}`)}</span>
                      </span>
                    ))}
                  </span>
                </KV>
                {iv.location !== '' && <KV label={t('hiring.place')}>{iv.location}</KV>}
                {iv.link !== '' && (
                  <KV label={t('hiring.link')}>
                    <a href={iv.link} target="_blank" rel="noopener noreferrer" className="hr-link hr-focus inline-flex cursor-pointer items-center gap-1 rounded-[3px]">
                      {iv.link.replace(/^https?:\/\//, '').slice(0, 40)}
                      <ExternalLink size={12} aria-hidden />
                    </a>
                  </KV>
                )}
                {iv.calendar_link !== '' && (
                  <KV label={t('hiring.calendar')}>
                    <a href={iv.calendar_link} target="_blank" rel="noopener noreferrer" className="hr-link hr-focus cursor-pointer rounded-[3px]">
                      {t('hiring.in_google_calendar')}
                    </a>
                  </KV>
                )}
                {iv.note !== '' && <KV label={t('hiring.note')}>{iv.note}</KV>}
                <KV label={t('hiring.status')}>
                  <Status kind="interview" status={iv.status} />
                </KV>
              </div>
            </Panel>
            <SummaryPanel iv={iv} />
          </div>
        </div>
      </PageBody>
      <ScheduleDialog open={moving} onClose={() => setMoving(false)} target={{ application: iv.application, candidate_name: iv.candidate_name, opening: iv.opening, entity: iv.entity }} interview={iv} />
    </>
  );
}
