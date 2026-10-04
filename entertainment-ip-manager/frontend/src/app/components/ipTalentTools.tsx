/**
 * Talent tools: the lifecycle step (debut, hiatus, suspension, graduation,
 * termination) with its playbook preview (talents/lifecycle preview=true),
 * the exposure that remains after graduation or termination, the
 * pre-stream check (talents/pre-stream-check) and the identity vault, which
 * only admins and the talent's managers can open.
 */
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Lock, Pencil, Plus, Radio } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { createRecord, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { mergeSelection, useCollection, useLiveReload } from '../lib/live.ts';
import { d10, fmtDate, toPb, today } from '../lib/format.ts';
import { bi, enumLabel, t, tn } from '../lib/i18n.ts';
import { LEVEL_TONE } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { PermissionRec, TalentIdentityRec, TalentRec } from '../lib/records.ts';
import type { Bi, Proposal } from '../lib/shapes.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { ProposalList, useEventLabel } from './events.tsx';
import { RecordPicker } from './pickers.tsx';
import { DateField } from './ipShared.tsx';
import { usePlatformOptions } from './ipTalentForm.tsx';
import { Checkbox, EmptyHint, ErrorBox, Fact, FactGrid, Field, JurChip, Loading, Notice, Pill, Ref, Section, TONE_DOT } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Lifecycle step                                                      */
/* ------------------------------------------------------------------ */

export const LIFECYCLE_CODES = ['DEBUT_SCHEDULED', 'DEBUTED', 'HIATUS', 'SUSPENDED', 'RESUMED', 'GRADUATION_SCHEDULED', 'GRADUATED', 'TERMINATED'] as const;
type LifecycleCode = (typeof LIFECYCLE_CODES)[number];

export interface Exposure {
  characters: number;
  products_on_sale: { id: string; name: string; stage: string; licensee: string }[];
  marks: { id: string; ref: string; jurisdiction: string }[];
  permissions: { id: string; title: string; end_date: string }[];
}

interface LifecycleResult {
  lifecycle: string;
  created: number;
  exposure: Exposure | null;
}

function codeHelp(code: LifecycleCode): string {
  switch (code) {
    case 'DEBUT_SCHEDULED':
      return t('Sets the debut date and lays out the debut preparation tasks.');
    case 'DEBUTED':
      return t('The talent has debuted and is now active.');
    case 'HIATUS':
      return t('Activity pauses. Streams and goods stop; the talent comes back later.');
    case 'SUSPENDED':
      return t('Activity stops while an issue is handled. The reason stays in the audit log only.');
    case 'RESUMED':
      return t('Activity starts again after a hiatus or suspension.');
    case 'GRADUATION_SCHEDULED':
      return t('Announces the graduation and lays out the playbook: notify licensees, order cut-off D-6, last day D, accounts D+30, membership and trademarks D+90, shipping D+180.');
    case 'GRADUATED':
      return t('The last day has passed. The talent becomes an alumna or alumnus.');
    case 'TERMINATED':
      return t('The contract ends early. The reason stays in the audit log only.');
  }
}

/** The step that usually comes next from where the talent is now. */
function nextStep(talent: TalentRec): LifecycleCode {
  switch (talent.lifecycle) {
    case 'pre_debut':
      return d10(talent.debut_date) !== '' ? 'DEBUTED' : 'DEBUT_SCHEDULED';
    case 'active':
      return 'HIATUS';
    case 'hiatus':
    case 'suspended':
      return 'RESUMED';
    case 'graduation_announced':
      return 'GRADUATED';
    default:
      return 'DEBUT_SCHEDULED';
  }
}

export function LifecycleDialog({ talent, onClose }: { talent: TalentRec; onClose: () => void }): React.JSX.Element {
  const eventLabel = useEventLabel();
  const [code, setCode] = useState<LifecycleCode>(() => nextStep(talent));
  const [date, setDate] = useState(today());
  const [graduation, setGraduation] = useState(d10(talent.graduation_date));
  const [debut, setDebut] = useState(d10(talent.debut_date));
  const [reason, setReason] = useState('');
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LifecycleResult | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const prevRef = useRef<Proposal[] | null>(null);
  prevRef.current = proposals;
  useLiveReload(['deadlines', 'rules', 'events'], () => setLiveTick((x) => x + 1), result === null);

  const needsGraduation = code === 'GRADUATION_SCHEDULED';
  const needsDebut = code === 'DEBUT_SCHEDULED';
  const needsReason = code === 'SUSPENDED' || code === 'TERMINATED';
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && (!needsGraduation || graduation !== '') && (!needsDebut || debut !== '');

  useEffect(() => {
    if (!ready || result !== null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const body: Record<string, unknown> = { talent_id: talent.id, code, date, preview: true };
      if (needsGraduation) body['graduation_date'] = graduation;
      if (needsDebut) body['debut_date'] = debut;
      op<{ proposals: Proposal[] }>('talents/lifecycle', body)
        .then((r) => {
          if (cancelled) return;
          const prev = prevRef.current;
          setProposals(r.proposals);
          setSelected((sel) => mergeSelection(sel, prev, r.proposals, (p) => p.selected));
          setPreviewError('');
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setProposals([]);
          setPreviewError(e instanceof Error ? e.message : String(e));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [talent.id, code, date, graduation, debut, needsGraduation, needsDebut, ready, liveTick, result]);

  const changeCode = (c: LifecycleCode): void => {
    setCode(c);
    setProposals(null);
    setSelected(new Set());
    prevRef.current = null;
  };

  const confirmStep = async (): Promise<void> => {
    if (needsReason && reason.trim() === '') {
      toast.error(t('Give the reason. It stays in the audit log only.'));
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        talent_id: talent.id,
        code,
        date,
        skip: (proposals ?? []).filter((p) => !selected.has(p.key)).map((p) => p.key),
        assignees: Object.entries(assignees)
          .filter(([key, a]) => a !== '' && selected.has(key))
          .map(([key, assignee]) => ({ key, assignee })),
      };
      if (needsGraduation) body['graduation_date'] = graduation;
      if (needsDebut) body['debut_date'] = debut;
      if (needsReason) body['reason'] = reason.trim();
      const r = await op<LifecycleResult>('talents/lifecycle', body);
      toast.success(r.created > 0 ? tn(r.created, 'Recorded. {n} playbook task created.', 'Recorded. {n} playbook tasks created.') : t('Recorded.'));
      if (r.exposure !== null) setResult(r);
      else onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (result !== null && result.exposure !== null) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('What still depends on {name}', { name: talent.stage_name })}
        description={t('Review these before the last day: products to stop or sell off, marks to keep or let go, permissions to end.')}
        className="w-[min(94vw,40rem)]"
        footer={<Button onClick={onClose}>{t('Done')}</Button>}
      >
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <ExposureView exposure={result.exposure} />
        </div>
      </Dialog>
    );
  }

  const codeOptions = LIFECYCLE_CODES.map((c) => ({ value: c, label: eventLabel(c) }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Lifecycle step for {name}', { name: talent.stage_name })}
      description={t('Choose what happens. The playbook below shows the dated tasks it lays out; untick any you do not need.')}
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void confirmStep()} loading={busy} disabled={!ready || (needsReason && reason.trim() === '')}>
            {selected.size > 0 ? tn(selected.size, 'Confirm and create {n} task', 'Confirm and create {n} tasks') : t('Confirm')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <p className="text-[13px] text-[var(--agent-app-muted)]">
          {t('Now: {lifecycle}', { lifecycle: enumLabel('talents.lifecycle', talent.lifecycle) || t('Not set') })}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Step|lifecycle')} value={code} options={codeOptions} onChange={(e) => changeCode(e.target.value as LifecycleCode)} />
          <DateField label={t('Date of the step')} value={date} onChange={setDate} help={t('The day it was decided or announced.')} />
          {needsGraduation && <DateField label={t('Last day of activity (graduation date)')} value={graduation} onChange={setGraduation} required />}
          {needsDebut && <DateField label={t('Debut date')} value={debut} onChange={setDebut} required />}
        </div>
        <p className="text-[12.5px] leading-relaxed text-[var(--agent-app-muted)]">{codeHelp(code)}</p>
        {needsReason && (
          <Textarea
            label={t('Reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t('Kept in the audit log only, never shown on the talent page.')}
          />
        )}
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Playbook')}</h4>
          {!ready ? (
            <p className="text-sm text-[var(--agent-app-muted)]">{needsGraduation ? t('Enter the last day of activity to see the playbook.') : needsDebut ? t('Enter the debut date to see the playbook.') : t('Enter the date.')}</p>
          ) : previewError !== '' ? (
            <Notice tone="bad">{previewError}</Notice>
          ) : proposals === null ? (
            <p className="text-sm text-[var(--agent-app-muted)]">{t('Working out the playbook...')}</p>
          ) : proposals.length === 0 ? (
            <p className="text-sm text-[var(--agent-app-muted)]">{t('No playbook tasks for this step. The lifecycle still changes when you confirm.')}</p>
          ) : (
            <ProposalList
              proposals={proposals}
              selected={selected}
              onToggle={(k, v) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (v) n.add(k);
                  else n.delete(k);
                  return n;
                })
              }
              showAssign
              assignees={assignees}
              onAssign={(k, id) => setAssignees((a) => ({ ...a, [k]: id }))}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** What depends on a talent: characters, products on sale, marks, permissions. */
export function ExposureView({ exposure }: { exposure: Exposure }): React.JSX.Element {
  const { on } = useApp();
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <p>{tn(exposure.characters, '{n} character is played by this talent.', '{n} characters are played by this talent.')}</p>
      <div>
        <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Products on sale or in production')}</h4>
        {exposure.products_on_sale.length === 0 ? (
          <p className="text-[var(--agent-app-muted)]">{t('None')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {exposure.products_on_sale.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-2">
                {on('products') ? (
                  <a href={href('product', p.id)} className="min-w-0 truncate hover:underline">
                    {p.name}
                  </a>
                ) : (
                  <span className="min-w-0 truncate">{p.name}</span>
                )}
                <Pill tone="info">{enumLabel('products.stage', p.stage)}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Trademarks')}</h4>
        {exposure.marks.length === 0 ? (
          <p className="text-[var(--agent-app-muted)]">{t('None')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {exposure.marks.map((m) => (
              <li key={m.id}>
                <a href={href('matter', m.id)} className="inline-flex items-center gap-1.5 hover:underline">
                  <JurChip code={m.jurisdiction} />
                  <Ref>{m.ref || t('Open|action')}</Ref>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Active permissions')}</h4>
        {exposure.permissions.length === 0 ? (
          <p className="text-[var(--agent-app-muted)]">{t('None')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {exposure.permissions.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-2">
                {on('permissions') ? (
                  <a href={href('permissions', undefined, { open: p.id })} className="min-w-0 truncate hover:underline">
                    {p.title}
                  </a>
                ) : (
                  <span className="min-w-0 truncate">{p.title}</span>
                )}
                {p.end_date !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{t('Until {date}', { date: fmtDate(p.end_date) })}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pre-stream check                                                    */
/* ------------------------------------------------------------------ */

// The same codes the Permissions page stores (and lib_music.js reads).
const MONETIZATION = ['ads', 'super_chat', 'membership', 'sponsored', 'paid_download'] as const;

function monetizationLabel(m: string): string {
  switch (m) {
    case 'ads':
      return t('Ads|monetization');
    case 'super_chat':
      return t('Super Chat and tips');
    case 'membership':
      return t('Membership');
    case 'sponsored':
      return t('Sponsorship');
    case 'paid_download':
      return t('Paid downloads');
    default:
      return m;
  }
}

interface PreStreamResult {
  verdict: 'allowed' | 'needs_application' | 'blocked';
  permission: { id: string; title: string; guideline_url: string; end_date: string } | null;
  reasons: { level: 'ok' | 'info' | 'warn' | 'block'; text: Bi }[];
}

const VERDICT: Record<PreStreamResult['verdict'], Tone> = { allowed: 'good', needs_application: 'warn', blocked: 'bad' };

function verdictText(v: PreStreamResult['verdict']): string {
  return v === 'allowed' ? t('Allowed|stream') : v === 'needs_application' ? t('Needs an application') : t('Blocked|stream');
}

export function PreStreamDialog({ talent, onClose }: { talent: TalentRec; onClose: () => void }): React.JSX.Element {
  const { on } = useApp();
  const platforms = usePlatformOptions();
  const [title, setTitle] = useState('');
  const [permission, setPermission] = useState('');
  const [platform, setPlatform] = useState('YOUTUBE');
  const [money, setMoney] = useState<string[]>([]);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreStreamResult | null>(null);
  const [error, setError] = useState('');

  const run = async (): Promise<void> => {
    if (title.trim() === '' && permission === '') {
      setError(t('Enter the game or work, or choose a permission.'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await op<PreStreamResult>('talents/pre-stream-check', { talent_id: talent.id, title: title.trim(), permission_id: permission, platform, monetization: money, date });
      setResult(r);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Pre-stream check for {name}', { name: talent.stage_name })}
      description={t('Can this talent stream this game or work, here, with this monetization? The answer names the permission that decides it.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button onClick={() => void run()} loading={busy}>
            <Radio size={14} aria-hidden /> {t('Check')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Game or work')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Title as the publisher writes it')} />
          {on('permissions') && (
            <RecordPicker<PermissionRec>
              collection="permissions"
              label={t('Or a permission on file')}
              value={permission}
              onChange={(id) => setPermission(id)}
              labelOf={(p) => p.title}
              searchFields={['title', 'subject_name']}
              filter='permission_type = "game_title" || permission_type = "platform_blanket"'
            />
          )}
          <Select label={t('Platform')} value={platform} options={platforms} onChange={(e) => setPlatform(e.target.value)} />
          <DateField label={t('Stream date')} value={date} onChange={setDate} />
        </div>
        <Field label={t('Monetization')}>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {MONETIZATION.map((m) => (
              <Checkbox key={m} checked={money.includes(m)} label={monetizationLabel(m)} onChange={(v) => setMoney((l) => (v ? [...l, m] : l.filter((x) => x !== m)))} />
            ))}
          </div>
        </Field>
        {error !== '' && <Notice tone="bad">{error}</Notice>}
        {result !== null && (
          <div className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={VERDICT[result.verdict]} className="text-[13px]">
                {verdictText(result.verdict)}
              </Pill>
              {result.permission !== null &&
                (on('permissions') ? (
                  <a href={href('permissions', undefined, { open: result.permission.id })} className="min-w-0 truncate text-[13px] font-medium hover:underline">
                    {result.permission.title}
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-[13px] font-medium">{result.permission.title}</span>
                ))}
              {result.permission !== null && result.permission.guideline_url !== '' && (
                <a href={result.permission.guideline_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--agent-app-accent)] hover:underline">
                  <ExternalLink size={11} aria-hidden /> {t('Guideline')}
                </a>
              )}
            </div>
            <ul className="flex flex-col gap-1.5">
              {result.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <span className={cn('mt-1.5 inline-block size-1.5 shrink-0 rounded-full', TONE_DOT[LEVEL_TONE[r.level] ?? 'neutral'])} aria-hidden />
                  <span className="min-w-0 break-words">{bi(r.text)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Identity vault                                                      */
/* ------------------------------------------------------------------ */

export function canSeeIdentity(talent: TalentRec, isAdmin: boolean, meId: string | undefined): boolean {
  return isAdmin || (meId !== undefined && talent.managers.includes(meId));
}

export function IdentitySection({ talent }: { talent: TalentRec }): React.JSX.Element {
  const { can, me } = useApp();
  if (!canSeeIdentity(talent, can.admin, me?.id)) {
    return (
      <Section title={t('Legal identity')}>
        <EmptyHint
          compact
          icon={Lock}
          title={t('Restricted|identity')}
          message={t('The legal identity of a performer is visible only to admins and the managers of this talent.')}
        />
      </Section>
    );
  }
  return <IdentityVault talent={talent} />;
}

function IdentityVault({ talent }: { talent: TalentRec }): React.JSX.Element {
  const list = useCollection<TalentIdentityRec>('talent_identity', { filter: `talent = ${q(talent.id)}` });
  const [editing, setEditing] = useState(false);
  const rec = list.records[0] ?? null;
  return (
    <Section
      title={t('Legal identity')}
      meta={t('Admins and managers only')}
      actions={
        rec !== null ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil size={13} aria-hidden /> {t('Edit')}
            </Button>
            <DeleteButton collection="talent_identity" id={rec.id} onDeleted={list.refresh} />
          </>
        ) : undefined
      }
    >
      {list.loading && rec === null ? (
        <Loading />
      ) : list.error !== null && rec === null ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : rec === null ? (
        <EmptyHint
          compact
          icon={Lock}
          title={t('No identity on file')}
          message={t('Record the legal name, contact and payment details here. Nothing from this record appears in lists, searches or exports.')}
          action={
            <Button size="sm" onClick={() => setEditing(true)}>
              <Plus size={13} aria-hidden /> {t('Add identity')}
            </Button>
          }
        />
      ) : (
        <FactGrid cols={2}>
          <Fact label={t('Legal name')} value={rec.legal_name} />
          <Fact label={t('Legal name (kana)')} value={rec.legal_name_kana} />
          <Fact label={t('Date of birth')} value={fmtDate(rec.birth_date)} />
          <Fact label={t('Email|field')} value={rec.email} />
          <Fact label={t('Phone')} value={rec.phone} />
          <Fact label={t('Emergency contact')} value={rec.emergency_contact} />
          <Fact label={t('Address')} value={<span className="whitespace-pre-wrap break-words">{rec.address}</span>} className="sm:col-span-2" />
          <Fact label={t('Payment details')} value={<span className="whitespace-pre-wrap break-words">{rec.payment_note}</span>} className="sm:col-span-2" />
          <Fact label={t('Notes')} value={<span className="whitespace-pre-wrap break-words">{rec.notes}</span>} className="sm:col-span-2" />
        </FactGrid>
      )}
      {editing && <IdentityDialog talent={talent} rec={rec} onClose={() => setEditing(false)} />}
    </Section>
  );
}

function IdentityDialog({ talent, rec, onClose }: { talent: TalentRec; rec: TalentIdentityRec | null; onClose: () => void }): React.JSX.Element {
  const [legalName, setLegalName] = useState(rec?.legal_name ?? '');
  const [kana, setKana] = useState(rec?.legal_name_kana ?? '');
  const [birth, setBirth] = useState(d10(rec?.birth_date));
  const [email, setEmail] = useState(rec?.email ?? '');
  const [phone, setPhone] = useState(rec?.phone ?? '');
  const [address, setAddress] = useState(rec?.address ?? '');
  const [emergency, setEmergency] = useState(rec?.emergency_contact ?? '');
  const [payment, setPayment] = useState(rec?.payment_note ?? '');
  const [notes, setNotes] = useState(rec?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    const data = {
      talent: talent.id,
      legal_name: legalName.trim(),
      legal_name_kana: kana.trim(),
      birth_date: toPb(birth),
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      emergency_contact: emergency.trim(),
      payment_note: payment.trim(),
      notes: notes.trim(),
    };
    try {
      if (rec === null) await createRecord('talent_identity', data);
      else await updateRecord('talent_identity', rec.id, data);
      toast.success(t('Saved'));
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Legal identity of {name}', { name: talent.stage_name })}
      description={t('Private. Only admins and the managers of this talent can read it.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Legal name')} value={legalName} onChange={(e) => setLegalName(e.target.value)} autoComplete="off" />
          <Input label={t('Legal name (kana)')} value={kana} onChange={(e) => setKana(e.target.value)} autoComplete="off" />
          <DateField label={t('Date of birth')} value={birth} onChange={setBirth} />
          <Input label={t('Email|field')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <Input label={t('Phone')} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          <Input label={t('Emergency contact')} value={emergency} onChange={(e) => setEmergency(e.target.value)} autoComplete="off" />
        </div>
        <Textarea label={t('Address')} value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
        <Textarea label={t('Payment details')} value={payment} onChange={(e) => setPayment(e.target.value)} rows={2} placeholder={t('Bank account or invoice details for royalty and fee payments')} />
        <Textarea label={t('Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </Dialog>
  );
}
