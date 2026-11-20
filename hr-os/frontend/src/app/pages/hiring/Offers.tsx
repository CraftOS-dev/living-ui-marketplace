/**
 * Offers: the list (open ones first), one offer (its terms beside the
 * letter, the one next step for its status: send for approval, send,
 * record the answer, hire), and the printable letter. Hire opens the
 * kernel's hire page filled from the offer; the hire links back here.
 */
import { useMemo, useState } from 'react';
import { Check, CheckCheck, FileSignature, MoreHorizontal, PencilLine, Printer, Send, Undo2, UserCheck, X } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, Field, LoadError, Picker, Loading, Menu, MenuItem, MenuSep, Money, Notice, PageBody, PageHeader, Panel, Segmented, Tag, Textarea, confirmAsk } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { OfferDialog } from '../../components/hiring/dialogs.tsx';
import { Markdown } from '../../components/hiring/Markdown.tsx';
import { KV, PayAmount, Status, statusLabel, ToggleRow } from '../../components/hiring/bits.tsx';
import { PrintHead } from '../print/index.tsx';
import { op } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import type { HireDraft, Offer, Settings } from './types.ts';
import { READS } from './types.ts';

/** The kernel hire page, filled from an accepted offer (from_application links the hire back). */
export function hireLink(h: HireDraft): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(h)) if (v !== '' && v !== undefined) q.set(k, v);
  return '/people/new?' + q.toString();
}

/* ---------------------------------------------------------------- list */

export function OffersPage({ query }: PageProps): React.JSX.Element {
  const view = query.get('status') ?? 'open';
  const live = useOp<{ offers: Offer[]; total: number }>('offers.list', { status: view, limit: 300 }, READS, { name: 'hiring.offers' });
  const columns: Column<Offer>[] = useMemo(
    () => [
      { key: 'name', label: t('hiring.col.candidate'), width: 'minmax(180px,1.4fr)', sort: (r) => r.candidate_name, phone: 'title', render: (r) => <span className="hr-wrap font-medium">{r.candidate_name}</span> },
      { key: 'title', label: t('hiring.col.title'), width: 'minmax(160px,1.4fr)', sort: (r) => r.title, phone: 'sub', render: (r) => r.title },
      { key: 'pay', label: t('hiring.col.pay'), width: '150px', align: 'right', mono: true, sort: (r) => r.amount_minor ?? 0, hideBelow: 'lg', phone: 'hide', render: (r) => (r.amount_minor !== null ? <Money minor={r.amount_minor} currency={r.currency} format={{ display: 'code' }} /> : '') },
      { key: 'start', label: t('hiring.col.start'), width: '110px', mono: true, sort: (r) => r.start_day, hideBelow: 'lg', phone: 'hide', render: (r) => fmtDay(r.start_day) },
      { key: 'status', label: t('hiring.col.status'), width: '130px', sort: (r) => r.status, phone: 'end', render: (r) => <Status kind="offer" status={r.status} /> },
    ],
    [],
  );
  const d = live.data;
  return (
    <>
      <PageHeader title={t('hiring.offers')} meta={d !== null ? tn('hiring.meta_offers', d.total) : undefined} />
      <PageBody>
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <Segmented value={view} onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })} label={t('hiring.col.status')} size="sm" options={(['open', 'accepted', 'declined', 'all'] as const).map((v) => ({ value: v, label: t(`hiring.oview.${v}`) }))} />
          </div>
          {d === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <DataTable label={t('hiring.offers')} columns={columns} rows={d.offers} rowKey={(r) => r.id} rowHref={(r) => `#/hiring/offers/${r.id}`} empty={<Empty icon={FileSignature} title={view === 'open' ? t('hiring.no_offers') : t('hiring.none_match')}>{view === 'open' ? t('hiring.no_offers_text') : undefined}</Empty>} />
          )}
        </div>
      </PageBody>
    </>
  );
}

/* ---------------------------------------------------------------- page */

/** A hire made outside the offer flow: pick the new employment and link it to this application. */
function LinkHireDialog({ open, onClose, offer }: { open: boolean; onClose: () => void; offer: Offer }): React.JSX.Element | null {
  const dir = useOp<{ people: { employment: string; name: string; number: string; title: string; start_day: string; entity_name: string }[] }>('people.directory', { status: 'all', q: offer.candidate_name.split(' ')[0], limit: 50 }, ['employees', 'employments'], { name: 'hiring.link.dir', skip: !open });
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('applications.link-hire', { application: offer.application, employment: pick });
      changed('offers', 'applications', 'openings', 'requisitions', 'hiring_events');
      toast.success(t('hiring.linked'));
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
      title={t('hiring.link_hire')}
      meta={offer.candidate_name}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={pick === ''} onClick={() => void save()}>
            {t('hiring.link_it')}
          </Button>
        </>
      }
    >
      <Field label={t('hiring.the_employment')}>
        <Picker value={pick} onChange={(v) => setPick(v)} items={(dir.data?.people ?? []).map((p) => ({ value: p.employment, label: p.name, sub: [p.number, p.title, p.entity_name, p.start_day].filter((x) => x !== '').join(' · '), person: true }))} label={t('hiring.the_employment')} />
      </Field>
    </Dialog>
  );
}

function AnswerDialog({ open, onClose, offer }: { open: boolean; onClose: () => void; offer: Offer }): React.JSX.Element | null {
  const [answer, setAnswer] = useState<'accepted' | 'declined'>('accepted');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ offer: Offer; hire: HireDraft | null }>('offers.respond', { offer: offer.id, answer, reason });
      changed('offers', 'applications', 'hiring_events');
      if (answer === 'accepted') toast.success(t('hiring.accepted_next'), r.offer.can.hire && r.hire !== null ? { label: t('hiring.hire'), run: () => navigate(hireLink(r.hire as HireDraft)) } : undefined);
      else toast.success(t('hiring.declined_recorded'));
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
      title={t('hiring.record_answer')}
      meta={offer.candidate_name}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" icon={answer === 'accepted' ? CheckCheck : X} busy={busy} onClick={() => void save()}>
            {answer === 'accepted' ? t('hiring.mark_accepted') : t('hiring.mark_declined')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented value={answer} onChange={setAnswer} label={t('hiring.answer')} options={[{ value: 'accepted', label: t('hiring.accepted'), icon: Check }, { value: 'declined', label: t('hiring.declined'), icon: X }]} />
        {answer === 'declined' && (
          <Field label={t('hiring.why_declined')} optional>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('hiring.why_declined')} minRows={2} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function SendDialog({ open, onClose, offer, emailOn }: { open: boolean; onClose: () => void; offer: Offer; emailOn: boolean }): React.JSX.Element | null {
  const [email, setEmail] = useState(emailOn && offer.candidate_email !== '');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ email: string }>('offers.send', { offer: offer.id, email });
      changed('offers', 'hiring_events');
      toast.success(r.email === 'queued' ? t('hiring.offer_emailed') : t('hiring.offer_marked_sent'));
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
      title={t('hiring.send_offer')}
      meta={offer.candidate_name}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" icon={Send} busy={busy} onClick={() => void save()}>
            {email ? t('hiring.email_offer') : t('hiring.mark_sent')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px]">{t('hiring.send_offer_text')}</p>
        {emailOn && offer.candidate_email !== '' ? <ToggleRow checked={email} onChange={setEmail} label={t('hiring.email_to', { email: offer.candidate_email })} /> : <Notice>{offer.candidate_email === '' ? t('hiring.no_email_on_file') : t('hiring.email_off_note')}</Notice>}
      </div>
    </Dialog>
  );
}

export function OfferPage({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const live = useOp<{ offer: Offer }>('offers.get', { offer: id }, READS, { name: 'hiring.offer' });
  const settings = useOp<Settings>('hiring.settings', {}, ['hiring_config'], { name: 'hiring.settings' }).data;
  const [editing, setEditing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [sending, setSending] = useState(false);
  const [linking, setLinking] = useState(false);
  const o = live.data?.offer ?? null;
  if (o === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const submit = async (): Promise<void> => {
    try {
      const r = await op<{ offer: Offer }>('offers.submit', { offer: o.id });
      changed('offers', 'approvals');
      toast.success(r.offer.status === 'approved' ? t('hiring.offer_auto_approved') : t('hiring.offer_sent_for_approval'));
    } catch {
      /* toast shown */
    }
  };
  const withdraw = async (): Promise<void> => {
    if (!(await confirmAsk(t('hiring.withdraw_offer_text'), t('hiring.withdraw_offer'), t('hiring.withdraw_offer')))) return;
    try {
      await op('offers.withdraw', { offer: o.id });
      changed('offers', 'approvals', 'hiring_events');
      toast.success(t('hiring.offer_withdrawn'));
    } catch {
      /* toast shown */
    }
  };
  const primary =
    o.can.submit ? (
      <Button variant="primary" icon={Send} onClick={() => void submit()}>
        {t('hiring.send_for_approval')}
      </Button>
    ) : o.can.send ? (
      <Button variant="primary" icon={Send} onClick={() => setSending(true)}>
        {t('hiring.send_offer')}
      </Button>
    ) : o.can.respond ? (
      <Button variant="primary" icon={Check} onClick={() => setAnswering(true)}>
        {t('hiring.record_answer')}
      </Button>
    ) : o.can.hire && o.hire ? (
      <Button variant="primary" icon={UserCheck} onClick={() => navigate(hireLink(o.hire as HireDraft))}>
        {t('hiring.hire_name', { name: o.candidate_name })}
      </Button>
    ) : null;
  const meta = [o.number, o.opening_number + ' ' + o.opening_title, statusLabel('offer', o.status)].join(' · ');
  return (
    <>
      <PageHeader title={t('hiring.offer_for', { name: o.candidate_name })} meta={meta} back="#/hiring/offers">
        {primary}
        <Menu icon={MoreHorizontal} label={t('ui.more')} width={220}>
          {(close) => (
            <>
              {o.can.edit && (
                <MenuItem icon={PencilLine} onClick={() => (close(), setEditing(true))}>
                  {t('hiring.edit_offer')}
                </MenuItem>
              )}
              {o.letter !== undefined && (
                <MenuItem icon={Printer} onClick={() => (close(), navigate('/print/hiring/offer/' + o.id))}>
                  {t('hiring.print_letter')}
                </MenuItem>
              )}
              <MenuItem onClick={() => (close(), navigate('/hiring/candidates/' + o.candidate, { application: o.application }))}>{t('hiring.open_candidate')}</MenuItem>
              {o.status === 'accepted' && o.employment === '' && o.can.hire && <MenuItem onClick={() => (close(), setLinking(true))}>{t('hiring.link_hire')}</MenuItem>}
              {o.can.withdraw && (
                <>
                  <MenuSep />
                  <MenuItem icon={Undo2} danger onClick={() => (close(), void withdraw())}>
                    {t('hiring.withdraw_offer')}
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Menu>
      </PageHeader>
      <PageBody>
        {o.status === 'pending' && <Notice className="mb-3">{t('hiring.waiting_approval')}</Notice>}
        {o.status === 'draft' && o.approval_status === 'rejected' && <Notice tone="warn" className="mb-3">{t('hiring.approval_declined', { note: o.approval_note })}</Notice>}
        {o.status === 'accepted' && o.employment === '' && !o.can.hire && <Notice className="mb-3">{t('hiring.hr_hires_here')}</Notice>}
        {o.employment !== '' && (
          <Notice tone="good" className="mb-3" action={<Button size="sm" onClick={() => navigate('/people/' + o.employment_number.split('-')[0])}>{t('hiring.open_profile')}</Button>}>
            {t('hiring.hired_as', { number: o.employment_number })}
          </Notice>
        )}
        {o.issues.length > 0 && (
          <Notice tone="warn" className="mb-3">
            {o.issues.map((i) => i.message).join(' ')}
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <Panel index="01" label={t('hiring.offer')} className="lg:col-span-5">
            <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
              <KV label={t('hiring.job_title')}>{o.title}</KV>
              <KV label={t('hiring.pay')}>{o.amount_minor !== null ? <PayAmount minor={o.amount_minor} currency={o.currency} per={o.pay_per} /> : t('ui.pay_hidden')}</KV>
              {o.components.length > 0 && (
                <KV label={t('hiring.components')}>
                  <span className="flex flex-col">
                    {o.components.map((c, i) => (
                      <span key={i}>
                        {c.name}: <PayAmount minor={c.amount_minor} currency={o.currency} per={c.per} />
                      </span>
                    ))}
                  </span>
                </KV>
              )}
              <KV label={t('hiring.start_day')}>{o.start_day !== '' ? fmtDay(o.start_day, { year: 'always' }) : t('hiring.not_set')}</KV>
              {o.department_name !== '' && <KV label={t('hiring.department')}>{o.department_name}</KV>}
              {o.location_name !== '' && <KV label={t('hiring.location')}>{o.location_name}</KV>}
              {o.employment_type_name !== '' && <KV label={t('hiring.employment_type')}>{o.employment_type_name}</KV>}
              <KV label={t('hiring.entity')}>{o.entity_name}</KV>
              {o.terms.length > 0 && (
                <KV label={t('hiring.terms')}>
                  <span className="flex flex-wrap gap-1">
                    {o.terms.map((x, i) => (
                      <Tag key={i}>{x.title}</Tag>
                    ))}
                  </span>
                </KV>
              )}
              {o.expires_day !== '' && <KV label={t('hiring.answer_by')}>{fmtDay(o.expires_day)}</KV>}
              {o.sent_at !== '' && <KV label={t('hiring.sent')}>{fmtDay(o.sent_at)}</KV>}
              {o.decline_reason !== '' && <KV label={t('hiring.why_declined')}>{o.decline_reason}</KV>}
              {o.note !== '' && <KV label={t('hiring.note')}>{o.note}</KV>}
              <KV label={t('hiring.made_by')}>{o.created_by_name}</KV>
            </div>
          </Panel>
          <Panel index="02" label={o.letter_frozen ? t('hiring.letter_sent') : t('hiring.letter_preview')} className="lg:col-span-7" aside={o.letter !== undefined ? <Button size="sm" variant="ghost" icon={Printer} onClick={() => navigate('/print/hiring/offer/' + o.id)}>{t('hiring.print')}</Button> : undefined}>
            {o.letter === undefined ? <p className="text-[13px] text-[var(--hr-muted)]">{t('ui.pay_hidden')}</p> : <Markdown text={o.letter} />}
          </Panel>
        </div>
      </PageBody>
      {editing && <OfferDialog open onClose={() => setEditing(false)} target={{ application: o.application, candidate_name: o.candidate_name, title: o.title, currency: o.currency, pay_per: o.pay_per }} offer={o} />}
      <AnswerDialog open={answering} onClose={() => setAnswering(false)} offer={o} />
      <SendDialog open={sending} onClose={() => setSending(false)} offer={o} emailOn={settings?.email_candidates === true} />
      <LinkHireDialog open={linking} onClose={() => setLinking(false)} offer={o} />
    </>
  );
}

/* --------------------------------------------------------------- print */

export function OfferPrint({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const live = useOp<{ markdown: string; entity_name: string; number: string; candidate_name: string; title: string; frozen: boolean }>('offers.letter', { offer: id }, ['offers'], { name: 'hiring.letter' });
  const d = live.data;
  if (d === null) return <p className="text-[12px] text-[#555]">{live.error ?? t('ui.loading')}</p>;
  return (
    <div className="text-[#111]">
      <PrintHead entity={d.entity_name} title={t('hiring.offer_letter')} meta={d.number} />
      <Markdown text={d.markdown} print className="text-[12px]" />
    </div>
  );
}
