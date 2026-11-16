/**
 * Review cycles: the list (current first, with their phase and progress),
 * and one cycle: its phases as a strip with "start now" and "end now" for
 * HR, progress per review kind, and the people in it as compact rows that
 * show who has not submitted. A person opens as a sheet: their reviews, the
 * stage, sharing, peers and the calibrated rating.
 */
import { useState } from 'react';
import { BellRing, CalendarRange, Ellipsis, CircleStop, Download, Pencil, Play, Plus, Rocket, Scale as ScaleIcon, Send, Trash2, UserPlus, Users } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, Field, LinkButton, LoadError, Loading, Menu, MenuItem, MenuSep, Notice, PageBody, PageHeader, Panel, PersonChip, RowCue, Segmented, Sheet, SheetHeader, StatTile, StatusDot, Tag, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { kindLabel, PersonPicker, phaseNow, PhaseStrip, ProgressBar, STAGE_TONE } from '../../components/performance/bits.tsx';
import type { CalibrationEntry, Cycle, Participant, ReviewBrief, ReviewKind } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op, saveText } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtRange, fmtStampDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';

export function CyclesPage(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ cycles: Cycle[]; can_create: boolean }>('cycles.list', {}, READS.reviews, { name: 'perf.cycles' });
  const today = me.today;
  const list = live.data?.cycles ?? [];
  const groups: { key: string; label: string; rows: Cycle[] }[] = [
    { key: 'active', label: t('perf.cycles.active'), rows: list.filter((c) => c.status === 'active') },
    { key: 'draft', label: t('perf.cycles.drafts'), rows: list.filter((c) => c.status === 'draft') },
    { key: 'closed', label: t('perf.cycles.closed'), rows: list.filter((c) => c.status === 'closed') },
  ].filter((g) => g.rows.length > 0);
  return (
    <>
      <PageHeader title={t('perf.cycles.title')} meta={tn('perf.cycles.count', list.length)}>
        {live.data?.can_create === true && (
          <Button variant="primary" icon={Plus} onClick={() => navigate('/performance/cycles/new')}>
            {t('perf.cycle.new')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {live.data === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : list.length === 0 ? (
          <Empty icon={CalendarRange} title={t('perf.cycles.empty')} action={live.data.can_create ? <Button icon={Plus} onClick={() => navigate('/performance/cycles/new')}>{t('perf.cycles.first')}</Button> : undefined}>
            {live.data.can_create ? t('perf.cycles.empty_hr') : t('perf.cycles.empty_text')}
          </Empty>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <section key={g.key}>
                <div className="hr-label mb-2">{g.label}</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {g.rows.map((c) => (
                    <a key={c.id} href={`#/performance/cycles/${c.id}`} className="hr-panel hr-in hr-focus flex min-w-0 flex-col gap-3 p-3.5 transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="hr-wrap text-[14px] font-semibold">{c.name}</div>
                          <div className="hr-label mt-0.5 truncate">{[t(`perf.cycle.kind.${c.kind}`), fmtRange(c.period_start, c.period_end), c.entity_name].filter((x) => x !== '').join(' · ')}</div>
                        </div>
                        <Tag tone={c.status === 'active' ? 'good' : c.status === 'draft' ? 'rh' : 'faint'}>{t(`perf.cycle.status.${c.status}`)}</Tag>
                      </div>
                      {c.status === 'active' && <div className="text-[12px] text-[var(--hr-ink-2)]">{phaseNow(c.phases, today)}</div>}
                      <PhaseStrip phases={c.phases} today={today} />
                      {c.status !== 'draft' && (
                        <div className="grid grid-cols-2 gap-3">
                          {(['self', 'manager'] as ReviewKind[]).map((k) =>
                            c.counts.reviews[k].total > 0 ? (
                              <div key={k}>
                                <div className="hr-label">{t('perf.home.kind_in', { kind: kindLabel(k) })}</div>
                                <ProgressBar value={(c.counts.reviews[k].submitted / Math.max(1, c.counts.reviews[k].total)) * 100} className="mt-1" />
                              </div>
                            ) : null,
                          )}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

type Filter = 'all' | 'missing' | 'submitted' | 'shared';

export function CyclePage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = params['id'] ?? '';
  const live = useOp<{ cycle: Cycle }>('cycles.get', { cycle: id }, READS.reviews, { name: 'perf.cycle' });
  const filter = (query.get('show') as Filter | null) ?? 'all';
  const people = useOp<{ participants: Participant[]; total: number }>('participants.list', { cycle: id, missing: filter === 'missing' ? 'any' : undefined, stage: filter === 'submitted' ? 'submitted' : filter === 'shared' ? 'shared' : undefined, limit: 500 }, READS.reviews, { name: 'perf.cycle.people', skip: live.data?.cycle.status === 'draft' });
  const preview = useOp<{ total: number; without_manager: number; people: { employee: string; name: string; number: string }[] }>('cycles.preview', { cycle: id }, ['review_cycles', 'employments', 'job_records'], { skip: live.data?.cycle.status !== 'draft' || live.data?.cycle.can.run !== true });
  const [open, setOpen] = useState(query.get('participant') ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const c = live.data?.cycle ?? null;
  if (c === null)
    return (
      <>
        <PageHeader title={t('perf.cycles.title')} back="#/performance/cycles" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const today = me.today;
  const run = async (key: string, fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(key);
    try {
      await fn();
      changed(...READS.reviews);
      toast.success(done);
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  const launch = async (): Promise<void> => {
    if (!(await confirmAsk(t('perf.cycle.launch_text', { n: preview.data?.total ?? 0 }), t('perf.cycle.launch'), t('perf.cycle.launch'), 'primary'))) return;
    await run('launch', () => op('cycles.launch', { cycle: c.id }), t('perf.cycle.launched'));
  };
  const close = async (): Promise<void> => {
    if (!(await confirmAsk(t('perf.cycle.close_text'), t('perf.cycle.close'), t('perf.cycle.close'), 'primary'))) return;
    await run('close', () => op('cycles.close', { cycle: c.id }), t('perf.cycle.closed_done'));
  };
  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('cycles.export', { cycle: c.id });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  const cols: Column<Participant>[] = [
    { key: 'name', label: t('perf.cycle.person'), width: 'minmax(200px,2fr)', phone: 'title', sort: (p) => p.employee?.name ?? '', render: (p) => <PersonChip name={p.employee?.name ?? ''} sub={p.title || p.department_name} size={24} /> },
    { key: 'dept', label: t('perf.cycle.department'), width: 'minmax(110px,1fr)', hideBelow: 'xl', sort: (p) => p.department_name, render: (p) => p.department_name },
    { key: 'self', label: t('perf.kind.self'), width: '110px', sort: (p) => p.reviews.self?.status ?? '', render: (p) => <ReviewState s={p.reviews.self?.status} /> },
    { key: 'manager', label: t('perf.kind.manager'), width: '150px', sort: (p) => p.reviews.manager?.status ?? '', render: (p) => <span className="min-w-0"><ReviewState s={p.reviews.manager?.status} /><span className="block truncate text-[12px] text-[var(--hr-muted)]">{p.manager?.name ?? t('perf.cycle.no_manager')}</span></span> },
    { key: 'peers', label: t('perf.kind.peer'), width: '80px', mono: true, hideBelow: 'lg', phone: 'hide', render: (p) => (p.reviews.peer.total > 0 ? `${p.reviews.peer.submitted}/${p.reviews.peer.total}` : '') },
    { key: 'stage', label: t('perf.cycle.stage'), width: '130px', phone: 'end', sort: (p) => p.stage, render: (p) => <StatusDot tone={STAGE_TONE[p.stage]} label={t(`perf.stage.${p.stage}`)} /> },
    { key: 'rating', label: t('perf.cycle.rating'), width: 'minmax(110px,1fr)', hideBelow: 'lg', sort: (p) => p.rating ?? 0, render: (p) => (p.rating !== null && p.rating > 0 ? <span className="truncate text-[12px]">{p.rating_label}{p.calibrated ? <span className="ml-1 text-[var(--hr-muted)]">{t('perf.cycle.calibrated_mark')}</span> : null}</span> : '') },
  ];
  const k = c.counts.reviews;
  return (
    <>
      <PageHeader title={c.name} meta={[t(`perf.cycle.kind.${c.kind}`), fmtRange(c.period_start, c.period_end), c.entity_name || t('perf.cycle.all_entities'), t(`perf.cycle.status.${c.status}`)].join(' · ')} back="#/performance/cycles">
        {c.can.run && c.status === 'draft' && (
          <>
            <Button icon={Pencil} onClick={() => navigate(`/performance/cycles/${c.id}/edit`)}>
              {t('perf.cycle.edit')}
            </Button>
            <Button variant="primary" icon={Rocket} busy={busy === 'launch'} disabled={(preview.data?.total ?? 0) === 0} onClick={() => void launch()}>
              {t('perf.cycle.launch')}
            </Button>
          </>
        )}
        {c.can.run && c.status === 'active' && (
          <>
            <Menu icon={Ellipsis} label={t('perf.cycle.more')}>
              {(closeMenu) => (
                <>
                  <MenuItem icon={BellRing} onClick={() => (closeMenu(), void run('remind', () => op('cycles.remind', { cycle: c.id }), t('perf.cycle.reminded')))}>
                    {t('perf.cycle.remind')}
                  </MenuItem>
                  <MenuItem icon={Send} onClick={() => (closeMenu(), void run('share', () => op('reviews.share-all', { cycle: c.id }), t('perf.cycle.shared_all')))}>
                    {t('perf.cycle.share_all')}
                  </MenuItem>
                  <MenuItem icon={UserPlus} onClick={() => (closeMenu(), setAddOpen(true))}>
                    {t('perf.cycle.add_person')}
                  </MenuItem>
                  <MenuItem icon={ScaleIcon} onClick={() => (closeMenu(), navigate('/performance/calibration', { cycle: c.id }))}>
                    {t('perf.calib.title')}
                  </MenuItem>
                  <MenuItem icon={Download} onClick={() => (closeMenu(), void exportCsv())}>
                    {t('ui.export')}
                  </MenuItem>
                  <MenuSep />
                  <MenuItem icon={CircleStop} onClick={() => (closeMenu(), void close())}>
                    {t('perf.cycle.close')}
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        )}
        {c.status !== 'draft' && !c.can.run && (
          <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv()}>
            {t('ui.export')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <Panel index="01" label={t('perf.cycle.phases')} className="lg:col-span-7">
            <div className="flex flex-col gap-3 pt-1">
              {c.status === 'active' && <div className="text-[13px] text-[var(--hr-ink-2)]">{phaseNow(c.phases, today)}</div>}
              <PhaseStrip phases={c.phases} today={today} />
              {c.can.run && c.status === 'active' && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hr-hair)] pt-2">
                  {c.phases.map((p) =>
                    p.state === 'upcoming' ? (
                      <LinkButton className="h-6" key={p.key} onClick={() => void run('ph', () => op('cycles.phase', { cycle: c.id, phase: p.key, action: 'start_now' }), t('perf.cycle.phase_started', { phase: t(`perf.phase.${p.key}`) }))}>
                        <Play size={11} aria-hidden /> {t('perf.cycle.start_phase', { phase: t(`perf.phase.${p.key}`) })}
                      </LinkButton>
                    ) : p.state === 'open' ? (
                      <LinkButton className="h-6" key={p.key} onClick={() => void run('ph', () => op('cycles.phase', { cycle: c.id, phase: p.key, action: 'end_now' }), t('perf.cycle.phase_ended', { phase: t(`perf.phase.${p.key}`) }))}>
                        <CircleStop size={11} aria-hidden /> {t('perf.cycle.end_phase', { phase: t(`perf.phase.${p.key}`) })}
                      </LinkButton>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </Panel>
          {c.status === 'draft' ? (
            <Panel index="02" label={t('perf.cycle.who')} className="lg:col-span-5">
              {preview.data === null ? (
                <Loading className="min-h-[120px]" />
              ) : (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-baseline gap-2">
                    <span className="hr-mono hr-num text-[26px] font-light leading-none">{preview.data.total}</span>
                    <span className="text-[13px] text-[var(--hr-ink-2)]">{t('perf.cycle.people_now')}</span>
                  </div>
                  {preview.data.without_manager > 0 && <Notice tone="warn">{tn('perf.cycle.no_manager_n', preview.data.without_manager)}</Notice>}
                  {preview.data.total === 0 && <Notice tone="warn">{t('perf.cycle.nobody')}</Notice>}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {preview.data.people.slice(0, 24).map((x) => (
                      <span key={x.employee} className="rounded-[4px] border border-[var(--hr-hair)] bg-[var(--hr-raised)] px-1.5 py-0.5 text-[12px] text-[var(--hr-ink-2)]">
                        {x.name}
                      </span>
                    ))}
                    {preview.data.people.length > 24 && <span className="px-1 text-[12px] text-[var(--hr-muted)]">{tn('perf.cycle.and_more', preview.data.people.length - 24)}</span>}
                  </div>
                </div>
              )}
            </Panel>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:col-span-5">
              {(['self', 'manager', 'peer', 'upward'] as ReviewKind[]).map((kind) => (
                <StatTile key={kind} label={t('perf.home.kind_in', { kind: kindLabel(kind) })} value={k[kind].total > 0 ? `${k[kind].submitted}/${k[kind].total}` : '0'} sub={k[kind].total > 0 ? `${Math.round((k[kind].submitted / k[kind].total) * 100)}%` : t('perf.cycle.none_kind')} />
              ))}
            </div>
          )}
          {c.status !== 'draft' && (
            <div className="hr-panel hr-in min-w-0 lg:col-span-12">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
                <span className="hr-label flex-1">{t('perf.cycle.people')}</span>
                <Segmented
                  value={filter}
                  onChange={(v) => setQuery({ show: v === 'all' ? undefined : v })}
                  label={t('perf.cycle.show')}
                  size="sm"
                  options={[
                    { value: 'all', label: t('perf.cycle.f.all') },
                    { value: 'missing', label: t('perf.cycle.f.missing') },
                    { value: 'submitted', label: t('perf.cycle.f.submitted') },
                    { value: 'shared', label: t('perf.cycle.f.shared') },
                  ]}
                />
              </div>
              {people.data === null ? (
                people.error !== null ? (
                  <LoadError message={people.error} onRetry={people.reload} />
                ) : (
                  <Loading />
                )
              ) : (
                <DataTable label={t('perf.cycle.people')} columns={cols} rows={people.data.participants} rowKey={(p) => p.id} onRowClick={(p) => setOpen(p.id)} empty={<Empty icon={Users} title={filter === 'missing' ? t('perf.cycle.all_in') : t('perf.cycle.nobody_here')} />} />
              )}
            </div>
          )}
        </div>
      </PageBody>
      <ParticipantSheet id={open} onClose={() => setOpen('')} />
      <AddPersonDialog open={addOpen} onClose={() => setAddOpen(false)} cycle={c.id} />
    </>
  );
}

function ReviewState({ s }: { s: string | undefined }): React.JSX.Element {
  if (s === undefined) return <span className="text-[12px] text-[var(--hr-faint)]">{t('perf.cycle.none_kind')}</span>;
  return <StatusDot tone={s === 'submitted' ? 'good' : s === 'declined' ? 'faint' : 'warn'} label={t(`perf.review.status.${s}`)} />;
}

interface Packet extends Omit<Participant, 'cycle'> {
  reviews_list: ReviewBrief[];
  calibration: CalibrationEntry[];
  can: { share: boolean; acknowledge: boolean; add_peer: boolean; calibrate: boolean; remove: boolean; reassign: boolean };
  cycle: Cycle;
}

/** One person in a cycle, as a sheet. */
export function ParticipantSheet({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element | null {
  const live = useOp<{ participant: Packet }>('participants.get', { participant: id }, READS.reviews, { skip: id === '' });
  const [peer, setPeer] = useState('');
  const [busy, setBusy] = useState(false);
  if (id === '') return null;
  const p = live.data?.participant ?? null;
  const act = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      changed(...READS.reviews);
      toast.success(done);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={id !== ''} onClose={onClose} label={t('perf.cycle.person')} width={520}>
      {p === null ? (
        <Loading />
      ) : (
        <>
          <SheetHeader title={p.employee?.name ?? ''} meta={[p.title, p.department_name].filter((x) => x !== '').join(' · ')} onClose={onClose} actions={p.can.share ? <Button size="sm" variant="primary" icon={Send} busy={busy} onClick={() => void act(() => op('reviews.share', { participant: p.id }), t('perf.cycle.shared_one'))}>{t('perf.cycle.share')}</Button> : undefined} />
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusDot tone={STAGE_TONE[p.stage]} label={t(`perf.stage.${p.stage}`)} />
              {p.rating !== null && p.rating > 0 && <Tag tone="rh">{p.rating_label}</Tag>}
              {p.score !== null && p.score > 0 && <span className="hr-num whitespace-nowrap text-[12px] text-[var(--hr-muted)]">{t('perf.review.score', { n: p.score.toFixed(2) })}</span>}
            </div>
            {p.returned_note !== '' && <Notice tone="warn">{t('perf.cycle.returned', { note: p.returned_note })}</Notice>}
            {p.ack_comment !== '' && <Notice>{t('perf.cycle.ack_comment', { note: p.ack_comment })}</Notice>}
            <section>
              <div className="hr-label mb-1.5">{t('perf.cycle.reviews')}</div>
              <ul className="flex flex-col">
                {p.reviews_list.map((r) => (
                  <li key={r.id}>
                    <a href={`#/performance/reviews/${r.id}`} className="group hr-focus flex items-center gap-3 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] px-1.5 py-2 last:border-b-0 hover:bg-[var(--hr-hover)]">
                      <Tag tone="faint">{kindLabel(r.kind)}</Tag>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{r.anonymous ? t('perf.review.anonymous') : r.reviewer?.name ?? t('perf.cycle.no_reviewer')}</span>
                      <ReviewState s={r.status} />
                      <RowCue />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            {p.can.add_peer && (
              <section>
                <div className="hr-label mb-1.5">{t('perf.cycle.add_peer')}</div>
                <div className="flex gap-2">
                  <PersonPicker value={peer} onChange={(v) => setPeer(v)} label={t('perf.cycle.add_peer')} placeholder={t('perf.cycle.pick_peer')} exclude={p.employee !== null ? [p.employee.id] : []} />
                  <Button icon={UserPlus} disabled={peer === ''} busy={busy} onClick={() => void act(() => op('reviews.add-peer', { participant: p.id, reviewer: peer }).then(() => setPeer('')), t('perf.cycle.peer_added'))}>
                    {t('ui.add')}
                  </Button>
                </div>
              </section>
            )}
            {p.calibration.length > 0 && (
              <section>
                <div className="hr-label mb-1.5">{t('perf.calib.history')}</div>
                <ul className="flex flex-col gap-1.5">
                  {p.calibration.map((h, i) => (
                    <li key={i} className="text-[13px] leading-5">
                      <span className="font-medium">{h.from_label}</span> {'>'} <span className="font-medium">{h.to_label}</span>
                      <span className="text-[var(--hr-muted)]"> · {h.by_name} · {fmtStampDay(h.at)}</span>
                      <div className="hr-wrap text-[var(--hr-ink-2)]">{h.reason}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {p.can.calibrate && (
              <Button icon={ScaleIcon} onClick={() => navigate('/performance/calibration', { cycle: p.cycle.id })}>
                {t('perf.calib.open')}
              </Button>
            )}
            {p.can.remove && (
              <div className="border-t border-[var(--hr-hair)] pt-3">
                <LinkButton className="h-6"
                  tone="danger"
                  onClick={() =>
                    void confirmAsk(t('perf.cycle.remove_text'), t('perf.cycle.remove')).then((yes) => {
                      if (yes) void act(() => op('participants.remove', { participant: p.id }), t('perf.cycle.removed')).then(onClose);
                    })
                  }
                >
                  <Trash2 size={12} aria-hidden /> {t('perf.cycle.remove')}
                </LinkButton>
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

function AddPersonDialog({ open, onClose, cycle }: { open: boolean; onClose: () => void; cycle: string }): React.JSX.Element | null {
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('participants.add', { cycle, employee: person });
      changed(...READS.reviews);
      toast.success(t('perf.cycle.person_added'));
      setPerson('');
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('perf.cycle.add_person')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={person === ''} onClick={() => void save()}>{t('ui.add')}</Button></>}>
      <Field label={t('perf.cycle.person')}>
        <PersonPicker value={person} onChange={(v) => setPerson(v)} label={t('perf.cycle.person')} />
      </Field>
    </Dialog>
  );
}

