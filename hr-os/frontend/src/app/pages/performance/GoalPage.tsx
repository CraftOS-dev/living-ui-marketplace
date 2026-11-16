/**
 * One goal: where it stands (progress, key results, status, due), the
 * chain it aligns to and the goals aligned to it, a check-in right on the
 * page, and the check-in history. Edit, mark done, drop or delete.
 */
import { useState } from 'react';
import { Check, CircleSlash, Ellipsis, Pencil, Plus, Sparkle, Target, Trash2 } from 'lucide-react';
import { Button, Empty, Fact, LoadError, Loading, Menu, MenuItem, MenuSep, PageBody, PageHeader, Panel, RowCue, Tag, Timeline, confirmAsk, toast } from '../../components/ui.tsx';
import type { TimelineItem } from '../../components/ui.tsx';
import { CheckinDialog, GoalDialog } from '../../components/performance/dialogs.tsx';
import { GoalStatusDot, ProgressBar, Reasons } from '../../components/performance/bits.tsx';
import type { GoalDetail } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay, number, stampDayKey } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';

function num(n: number): string {
  return number(n, Number.isInteger(n) ? 0 : Number.isInteger(n * 10) ? 1 : 2);
}

export function GoalPage({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const live = useOp<{ goal: GoalDetail }>('goals.get', { goal: id }, READS.goals, { name: 'perf.goal' });
  const [edit, setEdit] = useState(false);
  const [checkin, setCheckin] = useState(false);
  const [child, setChild] = useState(false);
  const g = live.data?.goal ?? null;
  if (g === null)
    return (
      <>
        <PageHeader title={t('perf.goal.goal')} back="#/performance/goals" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const closed = g.status === 'done' || g.status === 'dropped';
  const setStatus = async (status: 'done' | 'dropped' | 'on_track'): Promise<void> => {
    try {
      await op('goals.update', { goal: g.id, status });
      changed(...READS.goals);
      toast.success(t(`perf.goal.now_${status}`));
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('perf.goal.delete_text'), t('perf.goal.delete')))) return;
    try {
      await op('goals.delete', { goal: g.id });
      changed(...READS.goals);
      toast.success(t('perf.goal.deleted'));
      navigate('/performance/goals');
    } catch {
      /* toast shown */
    }
  };
  const owner = g.scope === 'personal' ? g.employee?.name ?? '' : g.scope === 'team' ? g.department?.name ?? '' : t('perf.goal.scope.company');
  const history: TimelineItem[] = g.checkins.map((c, i) => ({
    id: c.id,
    day: stampDayKey(c.at),
    state: i === 0 ? 'current' : 'past',
    agent: c.actor === 'agent',
    title: c.note !== '' ? c.note : t('perf.checkin.no_note'),
    meta: `${c.who} · ${ago(c.at)}`,
    lines: [
      ...(c.progress_before !== c.progress_after ? [{ label: t('perf.progress'), before: `${c.progress_before}%`, after: `${c.progress_after}%` }] : []),
      ...(c.status_before !== c.status_after ? [{ label: t('perf.goal.status_col'), before: t(`perf.goal.status.${c.status_before}`), after: t(`perf.goal.status.${c.status_after}`) }] : []),
      ...c.key_results.map((k) => ({ label: k.title, before: `${num(k.before)} ${k.unit}`, after: `${num(k.after)} ${k.unit}` })),
    ],
  }));
  return (
    <>
      <PageHeader title={g.title} meta={[t(`perf.goal.scope.${g.scope}`), owner, g.due !== '' ? t('perf.goal.due_on', { day: fmtDay(g.due) }) : ''].filter((x) => x !== '').join(' · ')} back="#/performance/goals">
        {g.can.edit && (
          <>
            <Menu icon={Ellipsis} label={t('perf.goal.more')}>
              {(close) => (
                <>
                  <MenuItem icon={Pencil} onClick={() => (close(), setEdit(true))}>
                    {t('perf.goal.edit')}
                  </MenuItem>
                  {!closed && (
                    <MenuItem icon={Check} onClick={() => (close(), void setStatus('done'))}>
                      {t('perf.goal.mark_done')}
                    </MenuItem>
                  )}
                  {!closed && (
                    <MenuItem icon={CircleSlash} onClick={() => (close(), void setStatus('dropped'))}>
                      {t('perf.goal.drop')}
                    </MenuItem>
                  )}
                  {closed && (
                    <MenuItem icon={Target} onClick={() => (close(), void setStatus('on_track'))}>
                      {t('perf.goal.reopen')}
                    </MenuItem>
                  )}
                  <MenuSep />
                  <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                    {t('perf.goal.delete')}
                  </MenuItem>
                </>
              )}
            </Menu>
            {!closed && (
              <Button variant="primary" onClick={() => setCheckin(true)}>
                {t('perf.checkin.title')}
              </Button>
            )}
          </>
        )}
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <Panel index="01" label={t('perf.goal.standing')} className="lg:col-span-7">
            <div className="flex flex-col gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="hr-mono hr-num text-[26px] font-light leading-none">{g.progress}%</span>
                <GoalStatusDot status={g.status} />
                {g.origin === 'agent' && (
                  <Tag tone="agent">
                    <Sparkle size={10} aria-hidden className="mr-1" />
                    {t('ui.agent_short')}
                  </Tag>
                )}
                <Reasons goal={g} />
              </div>
              <ProgressBar value={g.progress} status={g.status} label={g.title} />
              {g.description !== '' && <p className="hr-wrap whitespace-pre-wrap text-[13px] leading-5 text-[var(--hr-ink-2)]">{g.description}</p>}
              {g.key_results.length > 0 ? (
                <div className="flex flex-col gap-2.5 pt-1">
                  <div className="hr-label">{t('perf.goal.krs')}</div>
                  {g.key_results.map((k) => (
                    <div key={k.key} className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_200px] sm:items-center sm:gap-4">
                      <div className="min-w-0">
                        <div className="hr-wrap text-[13px]">{k.title}</div>
                        <div className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">
                          {num(k.current)} / {num(k.target)} {k.unit}
                          {k.start !== 0 ? ` · ${t('perf.goal.from_value', { value: num(k.start) })}` : ''}
                        </div>
                      </div>
                      <ProgressBar value={k.pct} label={k.title} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[var(--hr-muted)]">{g.progress_from === 'aligned' ? t('perf.goal.from_aligned') : t('perf.goal.from_checkins')}</div>
              )}
              <div className="grid grid-cols-2 gap-3 border-t border-[var(--hr-hair)] pt-3 sm:grid-cols-4">
                <Fact label={t('perf.goal.start')}>{fmtDay(g.start_day) || t('ui.none')}</Fact>
                <Fact label={t('perf.goal.due')}>{fmtDay(g.due) || t('ui.none')}</Fact>
                <Fact label={t('perf.goal.weight')} mono>
                  {g.weight > 0 ? `${g.weight}` : t('ui.none')}
                </Fact>
                <Fact label={t('perf.goal.cycle')}>{g.cycle?.name ?? t('ui.none')}</Fact>
              </div>
            </div>
          </Panel>
          <Panel index="02" label={t('perf.goal.alignment')} className="lg:col-span-5" aside={g.can.edit && g.scope !== 'personal' ? <Button size="sm" variant="ghost" icon={Plus} onClick={() => setChild(true)}>{t('perf.goal.add_below')}</Button> : undefined}>
            <div className="flex flex-col gap-2 pt-1">
              {g.chain.length === 0 && g.children.length === 0 && <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.goal.alone')}</p>}
              {g.chain.map((c, i) => (
                <a key={c.id} href={`#/performance/goals/${c.id}`} className="group hr-focus flex min-h-10 items-center gap-2 rounded-[var(--hr-radius-sm)] px-1.5 py-1.5 hover:bg-[var(--hr-hover)]" style={{ paddingLeft: 6 + i * 14 }}>
                  <Tag tone="faint">{t(`perf.goal.scope.${c.scope}`)}</Tag>
                  <span className="hr-wrap min-w-0 flex-1 text-[13px]">{c.title}</span>
                  <span className="hr-mono hr-num text-[12px] text-[var(--hr-ink-2)]">{c.progress}%</span>
                  <RowCue />
                </a>
              ))}
              {g.chain.length > 0 && <div className="pl-2 text-[12px] font-medium" style={{ paddingLeft: 6 + g.chain.length * 14 }}>{g.title}</div>}
              {g.children.length > 0 && (
                <>
                  <div className="hr-label pt-2">{t('perf.goal.aligned_here', { n: g.children.length })}</div>
                  {g.children.map((c) => (
                    <a key={c.id} href={`#/performance/goals/${c.id}`} className="group hr-focus flex min-h-10 items-center gap-3 rounded-[var(--hr-radius-sm)] px-1.5 py-1.5 hover:bg-[var(--hr-hover)]">
                      <span className="min-w-0 flex-1">
                        <span className="hr-wrap block text-[13px]">{c.title}</span>
                        <span className="block truncate text-[12px] text-[var(--hr-muted)]">{c.employee?.name ?? c.department?.name ?? ''}</span>
                      </span>
                      <ProgressBar value={c.progress} status={c.status} className="w-[120px]" label={c.title} />
                      <RowCue />
                    </a>
                  ))}
                </>
              )}
            </div>
          </Panel>
          <Panel index="03" label={t('perf.goal.history')} className="lg:col-span-12">
            {history.length === 0 ? (
              <Empty icon={Target} title={t('perf.goal.no_checkins')} action={g.can.edit && !closed ? <Button onClick={() => setCheckin(true)}>{t('perf.checkin.first')}</Button> : undefined} className="py-6" />
            ) : (
              <div className="pt-1">
                <Timeline items={history} />
              </div>
            )}
          </Panel>
        </div>
      </PageBody>
      <GoalDialog open={edit} onClose={() => setEdit(false)} goal={g} />
      <GoalDialog open={child} onClose={() => setChild(false)} parent={g.id} />
      <CheckinDialog open={checkin} onClose={() => setCheckin(false)} goal={g} />
    </>
  );
}
