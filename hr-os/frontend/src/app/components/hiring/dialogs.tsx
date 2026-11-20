/**
 * The hiring dialogs that act on applications: close (reject or withdrew)
 * with a reason and an optional message, message candidates, schedule or
 * move an interview, and make or change an offer. Each says what happened
 * and offers the next step.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Checkbox, DayPicker, Dialog, Field, IconButton, Input, MoneyInput, Notice, Picker, Segmented, Select, Textarea, majorParam } from '../ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import { addDays, dayKey } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { parseMoney } from '../../lib/money.ts';
import { toast } from '../../lib/toast.ts';
import type { Interview, Kit, Offer, Reason, Settings, Term, Template } from '../../pages/hiring/types.ts';
import { READS } from '../../pages/hiring/types.ts';
import { PeoplePicker, usePeople, zoneName, ToggleRow } from './bits.tsx';

const WRITES = ['applications', 'candidates', 'interviews', 'interview_feedback', 'offers', 'hiring_events', 'openings'];

function useSettings(skip = false): Settings | null {
  return useOp<Settings>('hiring.settings', {}, ['hiring_config', 'rejection_reasons', 'offer_terms', 'offer_templates'], { name: 'hiring.settings', skip }).data;
}

/* ------------------------------------------------------------ close */

interface CloseResult {
  done: { application: string; name: string; message: string }[];
  skipped: { application: string; name: string; reason: string }[];
  messages: Record<string, number>;
}

export function CloseDialog({ open, onClose, ids, label, mode, onDone }: { open: boolean; onClose: () => void; ids: string[]; label: string; mode: 'rejected' | 'withdrawn'; onDone?: (() => void) | undefined }): React.JSX.Element | null {
  const settings = useSettings(!open);
  const reasons = useMemo(() => (settings?.rejection_reasons ?? []).filter((r: Reason) => !r.archived && (mode === 'withdrawn' ? r.kind === 'candidate' : true)), [settings, mode]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setReason('');
    setNote('');
    setMessage(false);
    setSubject('');
    setBody('');
    setError(null);
  }, [open]);
  const chosen = reasons.find((r) => r.id === reason) ?? null;
  useEffect(() => {
    if (chosen === null) return;
    setSubject(chosen.subject);
    setBody(chosen.message);
    setMessage(chosen.message !== '' && mode === 'rejected');
  }, [chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const emailOn = settings?.email_candidates === true;
  const ok = (mode === 'withdrawn' || reason !== '') && (!message || body.trim() !== '');
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<CloseResult>(mode === 'rejected' ? 'applications.reject' : 'applications.withdraw', { applications: ids, reason: reason === '' ? undefined : reason, note, message, subject, body }, { quiet: true });
      changed(...WRITES);
      const sent = r.messages['queued'] ?? 0;
      const head = mode === 'rejected' ? tn('hiring.rejected_n', r.done.length) : tn('hiring.withdrew_n', r.done.length);
      const tail = r.skipped.length > 0 ? ' ' + t('hiring.skipped_list', { list: r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ') }) : '';
      (r.skipped.length > 0 ? toast.info : toast.success)(head + (sent > 0 ? ' ' + tn('hiring.emails_queued', sent) : '') + tail);
      onDone?.();
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
      title={mode === 'rejected' ? t('hiring.reject_title') : t('hiring.withdraw_title')}
      meta={label}
      width={540}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant={mode === 'rejected' ? 'danger' : 'primary'} icon={mode === 'rejected' ? X : undefined} busy={busy} disabled={!ok} onClick={() => void save()}>
            {mode === 'rejected' ? tn('hiring.reject_n', ids.length) : t('hiring.record_withdrawal')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('hiring.reason')} optional={mode === 'withdrawn'}>
          <Picker value={reason} onChange={(v) => setReason(v)} items={reasons.map((r) => ({ value: r.id, label: r.name, sub: r.kind === 'candidate' ? t('hiring.reason_kind.candidate') : undefined }))} label={t('hiring.reason')} placeholder={t('hiring.choose_reason')} clearable={mode === 'withdrawn'} />
        </Field>
        <Field label={t('hiring.note_team')} optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('hiring.note_team')} minRows={2} />
        </Field>
        <ToggleRow checked={message} onChange={setMessage} label={t('hiring.send_message')} />
        {message && (
          <>
            {!emailOn && <Notice>{t('hiring.email_off_note')}</Notice>}
            <Field label={t('hiring.subject')}>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={t('hiring.subject')} />
            </Field>
            <Field label={t('hiring.message')} hint={t('hiring.placeholders_hint')}>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label={t('hiring.message')} minRows={5} />
            </Field>
          </>
        )}
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------- message */

export function MessageDialog({ open, onClose, ids, label }: { open: boolean; onClose: () => void; ids: string[]; label: string }): React.JSX.Element | null {
  const settings = useSettings(!open);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSubject('');
    setBody('');
    setSend(settings?.email_candidates === true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const emailOn = settings?.email_candidates === true;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ results: Record<string, number> }>('applications.message', { applications: ids, subject, body, send: emailOn && send });
      changed('hiring_events');
      const q = r.results['queued'] ?? 0;
      toast.success(q > 0 ? tn('hiring.emails_queued', q) : tn('hiring.messages_kept', ids.length));
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
      title={t('hiring.message_title')}
      meta={label}
      width={540}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={body.trim() === ''} onClick={() => void save()}>
            {emailOn && send ? t('hiring.send_email') : t('hiring.keep_message')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('hiring.subject')}>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('hiring.subject_default')} aria-label={t('hiring.subject')} />
        </Field>
        <Field label={t('hiring.message')} hint={t('hiring.placeholders_hint')}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label={t('hiring.message')} minRows={6} />
        </Field>
        {emailOn ? <ToggleRow checked={send} onChange={setSend} label={t('hiring.email_it')} /> : <Notice>{t('hiring.email_off_note')}</Notice>}
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------- schedule */

const KINDS = ['video', 'phone', 'onsite', 'technical', 'panel', 'other'] as const;
const MINUTES = ['30', '45', '60', '90'] as const;

export interface ScheduleTarget {
  application: string;
  candidate_name: string;
  opening: string;
  entity: string;
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function ScheduleDialog({ open, onClose, target, interview }: { open: boolean; onClose: () => void; target: ScheduleTarget; interview?: Interview | null | undefined }): React.JSX.Element | null {
  const me = useMe();
  const people = usePeople(!open);
  const kits = useOp<{ kits: Kit[] }>('interview-kits.list', { opening: target.opening }, ['interview_kits'], { name: 'hiring.kits.' + target.opening, skip: !open }).data?.kits ?? [];
  const calendar = useOp<{ calendar: { connected: boolean } }>('hiring.calendar', {}, [], { name: 'hiring.calendar', skip: !open }).data?.calendar.connected === true;
  const entityZone = me.entities.find((e) => e.id === target.entity)?.timezone ?? browserZone();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>('video');
  const [kit, setKit] = useState('');
  const [day, setDay] = useState(addDays(dayKey(), 1));
  const [start, setStart] = useState('10:00');
  const [zone, setZone] = useState(entityZone);
  const [minutes, setMinutes] = useState<string>('45');
  const [panel, setPanel] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [toCal, setToCal] = useState(true);
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTitle(interview?.title ?? '');
    setKind(interview?.kind ?? 'video');
    setKit(interview?.kit ?? '');
    setDay(interview?.day ?? addDays(dayKey(), 1));
    setStart(interview?.start ?? '10:00');
    setZone(interview?.timezone ?? entityZone);
    setMinutes(String(interview?.duration_min ?? 45));
    setPanel(interview?.interviewers.map((i) => i.id) ?? (me.member !== undefined && me.member !== null ? [me.member.id] : []));
    setLocation(interview?.location ?? '');
    setLink(interview?.link ?? '');
    setNote(interview?.note ?? '');
    setError(null);
  }, [open, interview?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosenKit = kits.find((k) => k.id === kit) ?? null;
  useEffect(() => {
    if (chosenKit === null || interview !== undefined && interview !== null) return;
    if (chosenKit.duration_min > 0) setMinutes(String(chosenKit.duration_min));
    if (chosenKit.kind !== '') setKind(chosenKit.kind);
  }, [chosenKit?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const zones = [...new Set([zone, entityZone, ...me.entities.map((e) => e.timezone), browserZone()].filter((z) => z !== ''))];
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(start);
  const linkOk = link === '' || /^https?:\/\/\S+$/i.test(link);
  const ok = day !== '' && timeOk && panel.length > 0 && linkOk;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const params = { day, start, timezone: zone, duration_min: Number(minutes), interviewers: panel, kind, title: title === '' ? undefined : title, kit, location, link, note };
    try {
      if (interview !== undefined && interview !== null) {
        const r = await op<{ interview: Interview; calendar_stale: boolean }>('interviews.update', { interview: interview.id, ...params }, { quiet: true });
        changed(...WRITES);
        toast.success(r.calendar_stale ? t('hiring.interview_moved_cal') : t('hiring.interview_saved'));
      } else {
        const r = await op<{ interview: Interview; calendar: { ok: boolean; error?: string } | null; warnings: { message: string }[] }>('interviews.schedule', { application: target.application, ...params, calendar: calendar && toCal, invite_candidate: invite }, { quiet: true });
        changed(...WRITES);
        if (r.warnings.length > 0) toast.info(r.warnings.map((w) => w.message).join(' '));
        else if (r.calendar !== null && r.calendar.ok === false) toast.info(t('hiring.scheduled_no_cal', { error: r.calendar.error ?? '' }));
        else toast.success(t('hiring.scheduled'), { label: t('hiring.open_interview'), run: () => navigate('/hiring/interviews/' + r.interview.id) });
      }
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
      title={interview ? t('hiring.reschedule_title') : t('hiring.schedule_title')}
      meta={target.candidate_name}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {interview ? t('ui.save') : t('hiring.schedule')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hiring.kit')} optional>
          <Picker value={kit} onChange={(v) => setKit(v)} items={kits.map((k) => ({ value: k.id, label: k.name, sub: tn('hiring.n_criteria', k.criteria.length) }))} label={t('hiring.kit')} placeholder={t('hiring.no_kit')} clearable />
        </Field>
        <Field label={t('hiring.round')} optional>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={chosenKit?.name ?? t('hiring.round_placeholder')} aria-label={t('hiring.round')} />
        </Field>
        <Field label={t('hiring.day')}>
          <DayPicker value={day} onChange={setDay} label={t('hiring.day')} />
        </Field>
        <Field label={t('hiring.start')} error={timeOk ? null : t('hiring.time_format')}>
          <Input value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" placeholder="10:00" aria-label={t('hiring.start')} />
        </Field>
        <Field label={t('hiring.minutes')}>
          <Segmented value={minutes as (typeof MINUTES)[number]} onChange={setMinutes} label={t('hiring.minutes')} size="sm" options={MINUTES.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label={t('hiring.time_zone')}>
          <Select value={zone} onChange={(e) => setZone(e.target.value)} aria-label={t('hiring.time_zone')}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {zoneName(z)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hiring.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('hiring.kind')}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`hiring.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={kind === 'onsite' ? t('hiring.place') : t('hiring.link')} error={linkOk ? null : t('hiring.link_format')} optional>
          {kind === 'onsite' ? <Input value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t('hiring.place')} /> : <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" aria-label={t('hiring.link')} />}
        </Field>
        <Field label={t('hiring.panel')} className="sm:col-span-2">
          <PeoplePicker value={panel} onChange={setPanel} people={people} label={t('hiring.panel')} />
        </Field>
        <Field label={t('hiring.note_panel')} optional className="sm:col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('hiring.note_panel')} minRows={2} />
        </Field>
        {calendar && !interview && (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <ToggleRow checked={toCal} onChange={setToCal} label={t('hiring.add_to_calendar')} />
            {toCal && <ToggleRow checked={invite} onChange={setInvite} label={t('hiring.invite_candidate')} />}
          </div>
        )}
        {error !== null && (
          <Notice tone="bad" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ offer */

export interface OfferTarget {
  application: string;
  candidate_name: string;
  title: string;
  currency: string;
  pay_per: string;
}

interface CompRow {
  name: string;
  amount: number | null;
  per: string;
}

const PER_OPTIONS = ['year', 'month', 'hour'] as const;

export function OfferDialog({ open, onClose, target, offer }: { open: boolean; onClose: () => void; target: OfferTarget; offer?: Offer | null | undefined }): React.JSX.Element | null {
  const settings = useSettings(!open);
  const terms = useMemo(() => (settings?.offer_terms ?? []).filter((x: Term) => !x.archived), [settings]);
  const templates = useMemo(() => (settings?.offer_templates ?? []).filter((x: Template) => !x.archived), [settings]);
  const cur = offer?.currency ?? target.currency;
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [basis, setBasis] = useState<'salary' | 'hourly' | 'daily'>('salary');
  const [per, setPer] = useState<string>('month');
  const [amount, setAmount] = useState<number | null>(null);
  const [comps, setComps] = useState<CompRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [template, setTemplate] = useState('');
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTitle(offer?.title ?? target.title);
    setStart(offer?.start_day ?? '');
    setBasis(offer?.pay_basis ?? (target.pay_per === 'hour' ? 'hourly' : 'salary'));
    setPer(offer?.pay_per ?? (target.pay_per !== '' ? target.pay_per : 'month'));
    setAmount(offer?.amount_minor ?? null);
    setComps((offer?.components ?? []).map((c) => ({ name: c.name, amount: c.amount_minor, per: c.per })));
    setPicked(offer ? offer.terms.map((x) => x.term).filter((x) => x !== '') : []);
    setTemplate(offer?.template ?? '');
    setExpires(offer?.expires_day ?? addDays(dayKey(), 7));
    setNote(offer?.note ?? '');
    setError(null);
  }, [open, offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && !offer && picked.length === 0 && terms.length > 0) setPicked(terms.slice(0, 2).map((x) => x.id));
  }, [open, terms.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const compsOk = comps.every((c) => c.name.trim() !== '' && c.amount !== null && c.amount > 0);
  const ok = title.trim() !== '' && amount !== null && amount > 0 && compsOk;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const params = {
      title,
      start_day: start,
      pay_basis: basis,
      amount: majorParam(amount, cur),
      pay_per: basis === 'hourly' ? 'hour' : basis === 'daily' ? 'day' : per,
      components: comps.map((c) => ({ name: c.name, amount: majorParam(c.amount, cur), per: c.per })),
      terms: picked,
      template,
      expires_day: expires,
      note,
    };
    try {
      if (offer) {
        await op('offers.update', { offer: offer.id, ...params }, { quiet: true });
        changed('offers');
        toast.success(t('hiring.offer_saved'));
      } else {
        const r = await op<{ offer: Offer }>('offers.create', { application: target.application, ...params }, { quiet: true });
        changed('offers', 'applications', 'hiring_events');
        toast.success(t('hiring.offer_drafted'));
        navigate('/hiring/offers/' + r.offer.id);
      }
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
      title={offer ? t('hiring.edit_offer') : t('hiring.make_offer')}
      meta={target.candidate_name}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {offer ? t('ui.save') : t('hiring.draft_offer')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hiring.job_title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('hiring.job_title')} />
        </Field>
        <Field label={t('hiring.start_day')}>
          <DayPicker value={start} onChange={setStart} label={t('hiring.start_day')} min={dayKey()} />
        </Field>
        <Field label={t('hiring.pay_basis')}>
          <Segmented value={basis} onChange={setBasis} label={t('hiring.pay_basis')} size="sm" options={(['salary', 'hourly', 'daily'] as const).map((b) => ({ value: b, label: t(`hiring.basis.${b}`) }))} />
        </Field>
        <Field label={t('hiring.pay_with_currency', { currency: cur })}>
          <div className="flex items-center gap-2">
            <MoneyInput value={amount} onChange={setAmount} currency={cur} label={t('hiring.amount')} className="min-w-0 flex-1" />
            {basis === 'salary' && <Segmented value={per as (typeof PER_OPTIONS)[number]} onChange={setPer} label={t('hiring.per')} size="sm" options={(['year', 'month'] as const).map((p) => ({ value: p, label: t(`hiring.per.${p}`) }))} />}
          </div>
        </Field>
        <Field label={t('hiring.components')} optional className="sm:col-span-2">
          <div className="flex flex-col gap-2">
            {comps.map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_32px] items-center gap-2">
                <Input value={c.name} onChange={(e) => setComps(comps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={t('hiring.component_placeholder')} aria-label={t('hiring.component_name')} />
                <MoneyInput value={c.amount} onChange={(v) => setComps(comps.map((x, j) => (j === i ? { ...x, amount: v } : x)))} currency={cur} label={t('hiring.amount')} />
                <Select value={c.per} onChange={(e) => setComps(comps.map((x, j) => (j === i ? { ...x, per: e.target.value } : x)))} aria-label={t('hiring.per')}>
                  {(['once', 'year', 'month', 'hour'] as const).map((p) => (
                    <option key={p} value={p}>
                      {t(`hiring.per.${p}`)}
                    </option>
                  ))}
                </Select>
                <IconButton icon={Trash2} label={t('ui.remove')} onClick={() => setComps(comps.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setComps([...comps, { name: '', amount: null, per: 'once' }])}>
                {t('hiring.add_component')}
              </Button>
            </div>
          </div>
        </Field>
        <Field label={t('hiring.terms')} optional className="sm:col-span-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {terms.map((x) => (
              <Checkbox key={x.id} checked={picked.includes(x.id)} onChange={(v) => setPicked(v ? [...picked, x.id] : picked.filter((p) => p !== x.id))} label={x.title} />
            ))}
          </div>
        </Field>
        <Field label={t('hiring.letter_template')}>
          <Select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label={t('hiring.letter_template')}>
            <option value="">{t('hiring.default_template')}</option>
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hiring.answer_by')}>
          <DayPicker value={expires} onChange={setExpires} label={t('hiring.answer_by')} clearable />
        </Field>
        <Field label={t('hiring.note_team')} optional className="sm:col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('hiring.note_team')} minRows={2} />
        </Field>
        {error !== null && (
          <Notice tone="bad" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/** Parse money typed into a plain input (settings rows). */
export function moneyOf(text: string, currency: string): number | null {
  return parseMoney(text, currency);
}

export { READS };
