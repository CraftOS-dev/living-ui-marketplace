/**
 * A candidate: details and consent, the resume beside them, each
 * application with its stage, interviews (scorecards as the viewer may see
 * them), offers and the next actions (move, schedule, offer, reject), and
 * the timeline with notes. Interviewers see the basics, the resume and
 * their own interview.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CalendarPlus, ExternalLink, FileSignature, FileText, MoreHorizontal, PencilLine, Plus, RotateCcw, Sparkle, Trash2, UserX, X } from 'lucide-react';
import { Button, Dialog, Empty, Field, FileDrop, Input, LoadError, Loading, Menu, MenuItem, MenuLabel, MenuSep, Money, Notice, PageBody, PageHeader, Panel, Picker, RowCue, Select, Tag, Textarea, confirmAsk } from '../../components/ui.tsx';
import { CloseDialog, OfferDialog, ScheduleDialog } from '../../components/hiring/dialogs.tsx';
import type { OfferTarget, ScheduleTarget } from '../../components/hiring/dialogs.tsx';
import { KV, RecBadge, StageChain, Status, cx, useFileUrl, whenText, ToggleRow } from '../../components/hiring/bits.tsx';
import { download, errMessage, op, opForm } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import type { Application, Candidate, CandidateProfile, Opening } from './types.ts';
import { READS } from './types.ts';

const SOURCES = ['sourced', 'applied', 'referral', 'agency', 'job_board', 'career_site', 'event', 'internal', 'import', 'other'] as const;

function ResumePanel({ c, canEdit }: { c: Candidate; canEdit: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const path = c.has_resume ? `/api/ops/candidates/resume?candidate=${encodeURIComponent(c.id)}` : null;
  const file = useFileUrl(path, c.resume_name);
  const upload = async (f: File): Promise<void> => {
    setBusy(true);
    try {
      await opForm('candidates.resume-set', { candidate: c.id }, { resume: f });
      changed('candidates', 'hiring_events');
      toast.success(t('hiring.resume_saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const isPdf = file.type === 'application/pdf';
  const isImg = file.type.startsWith('image/');
  return (
    <Panel index="02" label={t('hiring.resume')} aside={c.has_resume ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => void download('candidates.resume', { candidate: c.id }, 'open', c.resume_name)}>{t('hiring.open')}</Button> : undefined}>
      {!c.has_resume ? (
        canEdit ? (
          <FileDrop onFiles={(f) => f[0] !== undefined && void upload(f[0])} accept=".pdf,.doc,.docx,.txt,.rtf,.odt,image/*" label={busy ? t('ui.loading') : t('hiring.add_resume')}>
            <FileText size={18} className="text-[var(--hr-muted)]" aria-hidden />
          </FileDrop>
        ) : (
          <p className="py-2 text-[13px] text-[var(--hr-muted)]">{t('hiring.no_resume')}</p>
        )
      ) : file.error !== null ? (
        <Notice tone="bad">{file.error}</Notice>
      ) : file.url === null ? (
        <Loading />
      ) : isPdf ? (
        <>
          <iframe src={file.url} title={c.resume_name} className="hidden h-[560px] w-full rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-white md:block" />
          <div className="flex items-center gap-3 py-1 md:hidden">
            <FileText size={18} className="text-[var(--hr-muted)]" aria-hidden />
            <span className="hr-wrap min-w-0 flex-1 text-[13px]">{c.resume_name}</span>
          </div>
        </>
      ) : isImg ? (
        <img src={file.url} alt={c.resume_name} className="w-full rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]" />
      ) : (
        <div className="flex items-center gap-3 py-2">
          <FileText size={18} className="text-[var(--hr-muted)]" aria-hidden />
          <span className="hr-wrap min-w-0 flex-1 text-[13px]">{c.resume_name}</span>
          <Button size="sm" onClick={() => void download('candidates.resume', { candidate: c.id }, 'save', c.resume_name)}>
            {t('hiring.download')}
          </Button>
        </div>
      )}
      {c.has_resume && canEdit && (
        <label className="hr-link mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-[3px] text-[12px] text-[var(--hr-ink-2)]">
          <input type="file" className="hidden" accept=".pdf,.doc,.docx,.txt,.rtf,.odt,image/*" onChange={(e) => e.target.files?.[0] !== undefined && void upload(e.target.files[0])} />
          {t('hiring.replace_resume')}
        </label>
      )}
    </Panel>
  );
}

function EditDialog({ open, onClose, c }: { open: boolean; onClose: () => void; c: Candidate }): React.JSX.Element | null {
  const [f, setF] = useState({ name: '', email: '', phone: '', location: '', current_title: '', current_company: '', source: 'sourced', links: '', tags: '', consent: false, notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setF({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', location: c.location, current_title: c.current_title, current_company: c.current_company, source: c.source ?? 'sourced', links: c.links.map((l) => l.url).join(' '), tags: c.tags.join(', '), consent: c.consent === true, notes: c.notes ?? '' });
    setError(null);
  }, [open, c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const set = (p: Partial<typeof f>): void => setF((x) => ({ ...x, ...p }));
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('candidates.update', { candidate: c.id, name: f.name, email: f.email, phone: f.phone, location: f.location, current_title: f.current_title, current_company: f.current_company, source: f.source, links: f.links.split(/\s+/).filter((x) => x !== ''), tags: f.tags.split(',').map((x) => x.trim()).filter((x) => x !== ''), consent: f.consent, notes: f.notes }, { quiet: true });
      changed('candidates', 'hiring_events');
      toast.success(t('ui.saved'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('hiring.edit_candidate')}
      width={580}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={f.name.trim() === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hiring.name')}>
          <Input value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label={t('hiring.name')} />
        </Field>
        <Field label={t('hiring.email')} optional>
          <Input value={f.email} onChange={(e) => set({ email: e.target.value })} aria-label={t('hiring.email')} />
        </Field>
        <Field label={t('hiring.phone')} optional>
          <Input value={f.phone} onChange={(e) => set({ phone: e.target.value })} aria-label={t('hiring.phone')} />
        </Field>
        <Field label={t('hiring.location')} optional>
          <Input value={f.location} onChange={(e) => set({ location: e.target.value })} aria-label={t('hiring.location')} />
        </Field>
        <Field label={t('hiring.current_title')} optional>
          <Input value={f.current_title} onChange={(e) => set({ current_title: e.target.value })} aria-label={t('hiring.current_title')} />
        </Field>
        <Field label={t('hiring.current_company')} optional>
          <Input value={f.current_company} onChange={(e) => set({ current_company: e.target.value })} aria-label={t('hiring.current_company')} />
        </Field>
        <Field label={t('hiring.source')}>
          <Select value={f.source} onChange={(e) => set({ source: e.target.value })} aria-label={t('hiring.source')}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`hiring.source.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hiring.tags')} optional hint={t('hiring.tags_hint')}>
          <Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} aria-label={t('hiring.tags')} />
        </Field>
        <Field label={t('hiring.links')} optional className="sm:col-span-2">
          <Input value={f.links} onChange={(e) => set({ links: e.target.value })} aria-label={t('hiring.links')} />
        </Field>
        <Field label={t('hiring.notes')} optional className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} aria-label={t('hiring.notes')} minRows={3} />
        </Field>
        <div className="sm:col-span-2">
          <ToggleRow checked={f.consent} onChange={(v) => set({ consent: v })} label={t('hiring.consent_label')} />
        </div>
        {error !== null && (
          <Notice tone="bad" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

function AddToOpeningDialog({ open, onClose, c }: { open: boolean; onClose: () => void; c: Candidate }): React.JSX.Element | null {
  const list = useOp<{ openings: Opening[] }>('openings.list', { status: 'active', limit: 300 }, ['openings'], { name: 'hiring.openings.pick', skip: !open }).data?.openings ?? [];
  const taken = new Set((c.applications ?? []).map((a) => a.opening));
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPick(''), [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('applications.add', { candidate: c.id, opening: pick });
      changed('applications', 'candidates', 'hiring_events');
      toast.success(t('hiring.added_to_opening', { name: c.name }));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('hiring.add_to_opening')}
      meta={c.name}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={pick === ''} onClick={() => void save()}>
            {t('hiring.add_to_opening')}
          </Button>
        </>
      }
    >
      <Field label={t('hiring.opening')}>
        <Picker value={pick} onChange={(v) => setPick(v)} items={list.filter((o) => o.can.add && !taken.has(o.id)).map((o) => ({ value: o.id, label: o.title, sub: [o.number, o.entity_name].join(' · ') }))} label={t('hiring.opening')} />
      </Field>
    </Dialog>
  );
}

function ApplicationPanel({ a, c, index, highlight }: { a: Application; c: Candidate; index: number; highlight: boolean }): React.JSX.Element {
  const [closing, setClosing] = useState<'rejected' | 'withdrawn' | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [offering, setOffering] = useState(false);
  const can = a.can.move;
  const team = a.access === 'all' || a.access === 'team';
  const openOffer = (a.offers ?? []).find((o) => ['draft', 'pending', 'approved', 'sent'].includes(o.status));
  const move = async (stage: string): Promise<void> => {
    try {
      await op('applications.move', { application: a.id, stage });
      changed('applications', 'hiring_events');
      toast.success(t('hiring.moved_to', { stage: a.stages.find((s) => s.key === stage)?.name ?? stage }));
    } catch {
      /* toast shown */
    }
  };
  const reopen = async (): Promise<void> => {
    try {
      await op('applications.reopen', { application: a.id });
      changed('applications', 'hiring_events');
      toast.success(t('hiring.reopened'));
    } catch {
      /* toast shown */
    }
  };
  const target: ScheduleTarget = { application: a.id, candidate_name: c.name, opening: a.opening, entity: a.entity };
  const offerTarget: OfferTarget = { application: a.id, candidate_name: c.name, title: a.opening_title, currency: '', pay_per: '' };
  return (
    <Panel
      index={String(index).padStart(2, '0')}
      label={
        <a href={`#/hiring/openings/${a.opening}`} className="hr-link hr-focus cursor-pointer rounded-[3px]">
          {a.opening_title}
        </a>
      }
      className={cx(highlight && 'ring-1 ring-[var(--hr-ink-2)]')}
      aside={<Status kind="application" status={a.status} />}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StageChain stages={a.stages} current={a.stage} status={a.status} />
          <span className="hr-num text-[12px] text-[var(--hr-muted)]">{t('hiring.since', { when: fmtDay(a.stage_since) })}</span>
          <span className="flex-1" />
          {can && team && (
            <>
              <Menu icon={ArrowRightLeft} label={t('hiring.move_to')} width={200}>
                {(close) => (
                  <>
                    <MenuLabel>{t('hiring.move_to')}</MenuLabel>
                    {a.stages
                      .filter((s) => s.kind !== 'hired')
                      .map((s) => (
                        <MenuItem key={s.key} selected={s.key === a.stage} disabled={s.key === a.stage} onClick={() => (close(), void move(s.key))}>
                          {s.name}
                        </MenuItem>
                      ))}
                  </>
                )}
              </Menu>
              <Button size="sm" icon={CalendarPlus} onClick={() => setScheduling(true)}>
                {t('hiring.schedule_interview')}
              </Button>
              {openOffer === undefined && (
                <Button size="sm" icon={FileSignature} onClick={() => setOffering(true)}>
                  {t('hiring.make_offer')}
                </Button>
              )}
              <Menu icon={MoreHorizontal} label={t('ui.more')} width={200}>
                {(close) => (
                  <>
                    <MenuItem icon={X} danger onClick={() => (close(), setClosing('rejected'))}>
                      {t('hiring.reject')}
                    </MenuItem>
                    <MenuItem icon={UserX} onClick={() => (close(), setClosing('withdrawn'))}>
                      {t('hiring.candidate_withdrew')}
                    </MenuItem>
                  </>
                )}
              </Menu>
            </>
          )}
          {a.can.reopen && (
            <Button size="sm" icon={RotateCcw} onClick={() => void reopen()}>
              {t('hiring.reopen')}
            </Button>
          )}
        </div>
        {a.status !== 'active' && (a.rejected_reason_name !== '' || a.closed_note !== '') && (
          <p className="hr-wrap text-[13px] text-[var(--hr-muted)]">{[a.rejected_reason_name, a.closed_note].filter((x) => x !== '').join(': ')}</p>
        )}
        {(a.interviews ?? []).length > 0 && (
          <div>
            <div className="hr-label mb-1">{t('hiring.interviews')}</div>
            <ul className="divide-y divide-[var(--hr-line)] rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
              {(a.interviews ?? []).map((iv) => (
                <li key={iv.id}>
                  <a href={`#/hiring/interviews/${iv.id}`} className="group relative pr-10 hr-focus flex cursor-pointer flex-col gap-1 px-3 py-2 hover:bg-[var(--hr-hover)] sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="hr-wrap block text-[13px] font-medium">{iv.title}</span>
                      <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{whenText(iv.day, iv.start, iv.timezone)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {(iv.scorecard?.others ?? []).map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1 text-[12px]">
                          <span className="text-[var(--hr-muted)]">{s.interviewer_name}</span>
                          <RecBadge value={s.recommendation} />
                        </span>
                      ))}
                      {iv.scorecard?.mine !== null && iv.scorecard?.mine !== undefined && iv.scorecard.mine.status === 'submitted' && (
                        <span className="inline-flex items-center gap-1 text-[12px]">
                          <span className="text-[var(--hr-muted)]">{t('hiring.you')}</span>
                          <RecBadge value={iv.scorecard.mine.recommendation} />
                        </span>
                      )}
                      {iv.scorecard !== undefined && iv.scorecard.hidden > 0 && <Tag tone="faint">{tn('hiring.hidden_until_yours', iv.scorecard.hidden)}</Tag>}
                      <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">
                        {iv.scorecards.submitted}/{iv.scorecards.total}
                      </span>
                      <Status kind="interview" status={iv.status} />
                    </span>
                    <RowCue className="absolute right-4 top-1/2 -translate-y-1/2" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(a.offers ?? []).length > 0 && (
          <div>
            <div className="hr-label mb-1">{t('hiring.offers')}</div>
            <ul className="divide-y divide-[var(--hr-line)] rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
              {(a.offers ?? []).map((o) => (
                <li key={o.id}>
                  <a href={`#/hiring/offers/${o.id}`} className="group hr-focus flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--hr-hover)]">
                    <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{o.number}</span>
                    <span className="hr-wrap min-w-0 flex-1 text-[13px]">{o.title}</span>
                    {o.amount_minor !== null && <Money minor={o.amount_minor} currency={o.currency} format={{ display: 'code' }} />}
                    <Status kind="offer" status={o.status} />
                    <RowCue />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <CloseDialog open={closing !== null} onClose={() => setClosing(null)} ids={[a.id]} label={`${c.name} · ${a.opening_title}`} mode={closing ?? 'rejected'} />
      <ScheduleDialog open={scheduling} onClose={() => setScheduling(false)} target={target} />
      {offering && <OfferFromApp a={a} target={offerTarget} onClose={() => setOffering(false)} />}
    </Panel>
  );
}

/** The offer dialog once the opening's currency and pay period are known. */
function OfferFromApp({ a, target, onClose }: { a: Application; target: OfferTarget; onClose: () => void }): React.JSX.Element | null {
  const o = useOp<{ opening: Opening }>('openings.get', { opening: a.opening }, ['openings'], { name: 'hiring.offer.opening' }).data?.opening ?? null;
  if (o === null) return null;
  return <OfferDialog open onClose={onClose} target={{ ...target, currency: o.currency, pay_per: o.pay_per }} />;
}

function TimelinePanel({ p }: { p: CandidateProfile }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('candidates.note', { candidate: p.candidate.id, text });
      changed('hiring_events');
      setText('');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel index={String(p.applications.length + 3).padStart(2, '0')} label={t('hiring.timeline')}>
      {p.can.note && (
        <div className="mb-3 flex flex-col gap-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('hiring.note_placeholder')} aria-label={t('hiring.add_note')} minRows={2} />
          <div className="flex justify-end">
            <Button size="sm" icon={Plus} busy={busy} disabled={text.trim() === ''} onClick={() => void add()}>
              {t('hiring.add_note')}
            </Button>
          </div>
        </div>
      )}
      {p.timeline.length === 0 ? (
        <p className="text-[13px] text-[var(--hr-muted)]">{t('hiring.timeline_empty')}</p>
      ) : (
        <ol className="flex flex-col">
          {p.timeline.map((e) => (
            <li key={e.id} className="flex gap-3 border-l border-[var(--hr-line)] py-1.5 pl-3">
              <span className="min-w-0 flex-1">
                <span className="hr-wrap block text-[13px]">
                  {e.kind === 'message' && e.subject !== '' ? <strong className="font-medium">{e.subject}: </strong> : null}
                  {e.kind === 'message' ? e.text.split('\n')[0] : e.text}
                  {e.day !== '' && <span className="text-[var(--hr-muted)]">{' · ' + whenText(e.day, e.start, e.zone)}</span>}
                </span>
                <span className="hr-mono block text-[10.5px] uppercase tracking-[0.06em] text-[var(--hr-muted)]">
                  {[t(`hiring.event.${e.kind}`), e.actor === 'agent' ? t('hiring.your_agent') : e.who, ago(e.at), e.kind === 'message' ? t(`hiring.delivery.${e.delivery}`) : ''].filter((x) => x !== '').join(' · ')}
                </span>
              </span>
              {e.actor === 'agent' && <Sparkle size={12} className="mt-1 shrink-0 text-[var(--hr-muted)]" aria-hidden />}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function CandidatePage({ params, query }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const focus = query.get('application') ?? '';
  const live = useOp<CandidateProfile>('candidates.get', { candidate: id }, READS, { name: 'hiring.candidate' });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const p = live.data;
  const c = p?.candidate ?? null;
  const team = c !== null && (c.access === 'all' || c.access === 'team');
  const apps = useMemo(() => p?.applications ?? [], [p]);
  useEffect(() => {
    if (focus === '') return;
    const el = document.getElementById('app-' + focus);
    if (el !== null) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus, apps.length]);
  if (p === null || c === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('hiring.delete_candidate_text', { name: c.name }), t('hiring.delete_candidate')))) return;
    try {
      const r = await op<{ deleted: unknown[]; kept: unknown[] }>('candidates.delete', { candidate: c.id });
      changed('candidates', 'applications');
      if (r.deleted.length > 0) {
        toast.success(t('hiring.candidate_deleted', { name: c.name }));
        navigate('/hiring/candidates');
      } else toast.info(t('hiring.candidate_kept'));
    } catch {
      /* toast shown */
    }
  };
  const meta = [c.current_title, c.current_company, c.source !== undefined ? t(`hiring.source.${c.source}`) : ''].filter((x) => x !== '').join(' · ');
  return (
    <>
      <PageHeader title={c.name} meta={meta} back={team ? '#/hiring/candidates' : '#/hiring/interviews'}>
        {p.can.edit && (
          <Button icon={PencilLine} onClick={() => setEditing(true)} className="hidden sm:inline-flex">
            {t('ui.edit')}
          </Button>
        )}
        {p.can.add_to_opening && (
          <Button variant={apps.some((a) => a.status === 'active') ? 'default' : 'primary'} icon={Plus} onClick={() => setAdding(true)} className="hidden sm:inline-flex">
            {t('hiring.add_to_opening')}
          </Button>
        )}
        {(p.can.edit || p.can.add_to_opening || p.can.delete) && (
          <div className={p.can.delete ? undefined : 'sm:hidden'}>
            <Menu icon={MoreHorizontal} label={t('ui.more')} width={200}>
              {(close) => (
                <>
                  <div className="sm:hidden">
                    {p.can.edit && (
                      <MenuItem icon={PencilLine} onClick={() => (close(), setEditing(true))}>
                        {t('ui.edit')}
                      </MenuItem>
                    )}
                    {p.can.add_to_opening && (
                      <MenuItem icon={Plus} onClick={() => (close(), setAdding(true))}>
                        {t('hiring.add_to_opening')}
                      </MenuItem>
                    )}
                  </div>
                  {p.can.delete && (
                    <>
                      <div className={p.can.edit || p.can.add_to_opening ? 'sm:hidden' : 'hidden'}>
                        <MenuSep />
                      </div>
                      <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                        {t('hiring.delete_candidate')}
                      </MenuItem>
                    </>
                  )}
                </>
              )}
            </Menu>
          </div>
        )}
      </PageHeader>
      <PageBody>
        {c.past_retention === true && (
          <Notice tone="warn" className="mb-3">
            {t('hiring.past_retention_note', { day: fmtDay(c.retain_until ?? '') })}
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
            <Panel index="01" label={t('hiring.details')}>
              <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
                {c.email !== undefined && c.email !== '' && (
                  <KV label={t('hiring.email')}>
                    <a href={`mailto:${c.email}`} className="hr-link hr-focus cursor-pointer rounded-[3px]">
                      {c.email}
                    </a>
                  </KV>
                )}
                {c.phone !== undefined && c.phone !== '' && <KV label={t('hiring.phone')}>{c.phone}</KV>}
                {c.location !== '' && <KV label={t('hiring.location')}>{c.location}</KV>}
                {c.links.length > 0 && (
                  <KV label={t('hiring.links')}>
                    <span className="flex flex-col">
                      {c.links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="hr-link hr-focus cursor-pointer rounded-[3px]">
                          {l.label !== '' ? l.label : l.url.replace(/^https?:\/\//, '')}
                        </a>
                      ))}
                    </span>
                  </KV>
                )}
                {c.tags.length > 0 && (
                  <KV label={t('hiring.tags')}>
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((x) => (
                        <Tag key={x}>{x}</Tag>
                      ))}
                    </span>
                  </KV>
                )}
                {c.source !== undefined && <KV label={t('hiring.source')}>{[t(`hiring.source.${c.source}`), c.source_detail ?? ''].filter((x) => x !== '').join(' · ')}</KV>}
                {c.consent !== undefined && <KV label={t('hiring.consent')}>{c.consent ? t('hiring.consent_yes', { day: fmtDay(c.consent_at ?? '') }) : t('hiring.consent_no')}</KV>}
                {c.retain_until !== undefined && c.retain_until !== '' && <KV label={t('hiring.retain_until')}>{fmtDay(c.retain_until, { year: 'always' })}</KV>}
                {c.employee !== '' && (
                  <KV label={t('hiring.employee')}>
                    <a href={`#/people/${c.employee_number}`} className="hr-link hr-focus cursor-pointer rounded-[3px]">
                      {c.employee_number}
                    </a>
                  </KV>
                )}
                {c.notes !== undefined && c.notes !== '' && <KV label={t('hiring.notes')}>{c.notes}</KV>}
                {p.referral !== null && <KV label={t('hiring.referred_by')}>{[p.referral.referrer_name, p.referral.relationship].filter((x) => x !== '').join(' · ')}</KV>}
              </div>
            </Panel>
            <ResumePanel c={c} canEdit={p.can.edit} />
          </div>
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
            {apps.length === 0 ? (
              <div className="hr-panel">
                <Empty icon={FileText} title={t('hiring.no_applications')} action={p.can.add_to_opening ? <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('hiring.add_to_opening')}</Button> : undefined} />
              </div>
            ) : (
              apps.map((a, i) => (
                <div key={a.id} id={'app-' + a.id}>
                  <ApplicationPanel a={a} c={c} index={i + 3} highlight={a.id === focus} />
                </div>
              ))
            )}
            {team && <TimelinePanel p={p} />}
          </div>
        </div>
      </PageBody>
      <EditDialog open={editing} onClose={() => setEditing(false)} c={c} />
      <AddToOpeningDialog open={adding} onClose={() => setAdding(false)} c={{ ...c, applications: apps.map((a) => ({ id: a.id, status: a.status, stage: a.stage, stage_name: a.stage_name, opening: a.opening, opening_number: a.opening_number, opening_title: a.opening_title })) }} />
    </>
  );
}
