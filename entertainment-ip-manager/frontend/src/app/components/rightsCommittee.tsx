/**
 * A production committee (製作委員会): the committee form, the overview
 * with its distribution waterfall, the members and their shares, the
 * windows (窓口権) held on the committee agreement, and the "who decides"
 * tool that names the window holder or the members who must consent.
 */
import { useMemo, useState } from 'react';
import { Gavel, Layers, Pencil, Plus, Search, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, Textarea, cn, toast } from '../../kit/index.ts';
import { useDeleteRecord } from './deleteRecord.tsx';
import { createRecord, errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { addDays, addMonths, d10, fmtDate, fmtMoney, fmtNumber, fmtPct, toPb, today } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, joinList, t, tf } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import type { AgreementRec, CommitteeMemberRec, CommitteeRec, DeadlineRec, GrantRec, PartyRec } from '../lib/records.ts';
import type { WaterfallStep } from '../lib/shapes.ts';
import { href } from '../lib/router.ts';
import { DeadlineList, useDeadlineActions } from './deadlines.tsx';
import { CatalogSelect, DimensionPicker, PartyPicker } from './pickers.tsx';
import { Checkbox, EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, Field, ListRow, Loading, Notice, Pill, Prose, Section, Tag } from './ui.tsx';
import { GrantEditor } from './rightsGrants.tsx';
import { ASSET_EXPAND, CellNum, CellSelect, CellText, DateField, EMPTY_ASSETS, NumField, RowsEditor, num, termText, useDimSummary, useRightsDims } from './rightsShared.tsx';
import type { AssetSel } from './rightsShared.tsx';
import type { DeciderExt } from './rightsCanWe.tsx';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const MEMBER_ROLES = ['lead', 'promotion_lead', 'studio', 'publisher', 'label', 'broadcaster', 'streamer', 'merchandiser', 'member'] as const;

export function memberRoleLabel(r: string): string {
  switch (r) {
    case 'lead':
      return t('Lead company');
    case 'promotion_lead':
      return t('Promotion lead');
    case 'studio':
      return t('Animation studio');
    case 'publisher':
      return t('Publisher');
    case 'label':
      return t('Music label');
    case 'broadcaster':
      return t('Broadcaster');
    case 'streamer':
      return t('Streaming service');
    case 'merchandiser':
      return t('Merchandiser');
    case 'member':
      return t('Member');
    default:
      return r;
  }
}

export function memberName(m: CommitteeMemberRec): string {
  const p = ((m.expand ?? {}) as Record<string, unknown>)['party'] as PartyRec | undefined;
  return m.name || p?.name || '';
}

function stepKindLabel(k: string): string {
  switch (k) {
    case 'fee':
      return t('Fee|step');
    case 'deduction':
      return t('Deduction');
    case 'success_fee':
      return t('Success fee');
    default:
      return k;
  }
}

/* ------------------------------------------------------------------ */
/* Committee form                                                      */
/* ------------------------------------------------------------------ */

export function CommitteeForm({ committee, onClose, onSaved }: { committee: CommitteeRec | null; onClose: () => void; onSaved: (c: CommitteeRec) => void }): React.JSX.Element {
  const { homeCurrency, on } = useApp();
  const c = committee;
  const [name, setName] = useState(c?.name ?? '');
  const [work, setWork] = useState(c?.work ?? '');
  const [franchise, setFranchise] = useState(c?.franchise ?? '');
  const [form, setForm] = useState<string>(c?.form || 'nin_i_kumiai');
  const [status, setStatus] = useState<string>(c?.status || 'forming');
  const [formed, setFormed] = useState(d10(c?.formed_date));
  const [termEnd, setTermEnd] = useState(d10(c?.term_end));
  const [review, setReview] = useState(d10(c?.review_date));
  const [buyback, setBuyback] = useState(d10(c?.buyback_window_end));
  const [fy, setFy] = useState(c?.fiscal_year_end ?? '');
  const [dueDays, setDueDays] = useState<number | null>(c?.distribution_due_days ? c.distribution_due_days : null);
  const [leadPct, setLeadPct] = useState<number | null>(c?.lead_fee_pct ? c.lead_fee_pct : null);
  const [leadBase, setLeadBase] = useState<string>(c?.lead_fee_base || 'net');
  const [promoPct, setPromoPct] = useState<number | null>(c?.promo_fee_pct ? c.promo_fee_pct : null);
  const [consent, setConsent] = useState<string>(c?.consent_default || 'unanimous');
  const [currency, setCurrency] = useState((c?.currency || homeCurrency).toUpperCase());
  const [line, setLine] = useState(c?.copyright_line ?? '');
  const [notes, setNotes] = useState(c?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const opts = (key: string): { value: string; label: string }[] => enumOptions(key).map(([value, label]) => ({ value, label }));

  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      setErr(t('Give the committee a name.'));
      return;
    }
    if (fy !== '' && !/^\d{2}-\d{2}$/.test(fy)) {
      toast.error(t('Write the fiscal year end as MM-DD, for example 03-31.'));
      return;
    }
    setErr('');
    setBusy(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      work,
      franchise,
      form,
      status,
      formed_date: toPb(formed),
      term_end: toPb(termEnd),
      review_date: toPb(review),
      buyback_window_end: toPb(buyback),
      fiscal_year_end: fy,
      distribution_due_days: num(dueDays),
      lead_fee_pct: num(leadPct),
      lead_fee_base: leadBase,
      promo_fee_pct: num(promoPct),
      consent_default: consent,
      currency,
      copyright_line: line.trim(),
      notes,
    };
    try {
      const saved = c === null ? await createRecord<CommitteeRec>('committees', payload) : await updateRecord<CommitteeRec>('committees', c.id, payload);
      toast.success(c === null ? t('Committee created') : t('Committee saved'));
      onSaved(saved);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={c === null ? t('New committee') : t('Edit committee')}
      description={t('The partnership that finances a title, its fees and how members decide uses no window covers.')}
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {c === null ? t('Create committee') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={t('Name')} value={name} error={err !== '' ? err : undefined} onChange={(e) => setName(e.target.value)} placeholder={t('For example: Project Starfall Production Committee')} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(on('titles') || work !== '') && <CatalogSelect kind="work" label={t('Title')} value={work} onChange={setWork} />}
          {(on('franchises') || franchise !== '') && <CatalogSelect kind="franchise" label={t('Franchise')} value={franchise} onChange={setFranchise} />}
          <Select label={t('Form|committee')} value={form} options={opts('committees.form')} onChange={(e) => setForm(e.target.value)} />
          <Select label={t('Status')} value={status} options={opts('committees.status')} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateField label={t('Formed|date')} value={formed} onChange={setFormed} />
          <DateField label={t('Term ends|committee')} value={termEnd} onChange={setTermEnd} />
          <DateField label={t('Review date')} value={review} onChange={setReview} />
          <DateField label={t('Buy-back window ends')} value={buyback} onChange={setBuyback} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('Consent for uses no window covers')} value={consent} options={opts('committees.consent_default')} onChange={(e) => setConsent(e.target.value)} />
          <NumField label={t('Distribution due (days after period end)')} value={dueDays} onChange={setDueDays} placeholder="60" />
          <Input label={t('Fiscal year end (MM-DD)')} value={fy} onChange={(e) => setFy(e.target.value)} placeholder="03-31" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label={t('Lead company fee')} value={leadPct} onChange={setLeadPct} suffix="%" />
          <Select label={t('Lead fee base')} value={leadBase} options={opts('committees.lead_fee_base')} onChange={(e) => setLeadBase(e.target.value)} />
          <NumField label={t('Promotion lead fee')} value={promoPct} onChange={setPromoPct} suffix="%" />
          <Select label={t('Currency')} value={currency} options={CURRENCIES.map((x) => ({ value: x, label: x }))} onChange={(e) => setCurrency(e.target.value)} />
        </div>
        <Input label={t('© line')} value={line} onChange={(e) => setLine(e.target.value)} placeholder={t('For example: ©Author/Publisher, Project Committee')} />
        <Textarea label={t('Notes')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Waterfall                                                           */
/* ------------------------------------------------------------------ */

interface StepRow {
  label: string;
  label_ja: string;
  kind: string;
  pct: number | null;
  amount: number | null;
  base: string;
  cap_pct: number | null;
  threshold: number | null;
  key: string;
}

function WaterfallDialog({ committee, onClose }: { committee: CommitteeRec; onClose: () => void }): React.JSX.Element {
  const [rows, setRows] = useState<StepRow[]>(() =>
    (committee.waterfall ?? []).map((s) => ({
      key: s.key ?? '',
      label: s.label ?? '',
      label_ja: s.label_ja ?? '',
      kind: s.kind ?? 'deduction',
      pct: s.pct ?? null,
      amount: s.amount ?? null,
      base: s.base ?? 'net',
      cap_pct: s.cap_pct ?? null,
      threshold: s.threshold ?? null,
    })),
  );
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    const steps: WaterfallStep[] = rows
      .filter((r) => r.label.trim() !== '' || r.label_ja.trim() !== '')
      .map((r) => {
        const s: WaterfallStep = { label: r.label.trim() || r.label_ja.trim(), kind: r.kind === 'fee' || r.kind === 'success_fee' ? r.kind : 'deduction', base: r.base === 'gross' ? 'gross' : 'net' };
        if (r.key !== '') s.key = r.key;
        if (r.label_ja.trim() !== '') s.label_ja = r.label_ja.trim();
        if (r.pct !== null) s.pct = r.pct;
        if (r.amount !== null) s.amount = r.amount;
        if (r.cap_pct !== null) s.cap_pct = r.cap_pct;
        if (r.threshold !== null) s.threshold = r.threshold;
        return s;
      });
    setBusy(true);
    try {
      await updateRecord('committees', committee.id, { waterfall: steps });
      toast.success(t('Waterfall saved'));
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };
  const kindOpts = ['fee', 'deduction', 'success_fee'].map((k) => ({ value: k, label: stepKindLabel(k) }));
  const baseOpts = enumOptions('committees.lead_fee_base').map(([value, label]) => ({ value, label }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Waterfall steps')}
      description={t('Committee-level steps after the window fees, in order. Each takes a percentage of the gross or of what is left, or a fixed amount.')}
      className="w-[min(96vw,56rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-3 overflow-y-auto pr-1">
        <RowsEditor<StepRow>
          label={t('Steps|waterfall')}
          rows={rows}
          onChange={setRows}
          addLabel={t('Add a step')}
          blank={() => ({ key: '', label: '', label_ja: '', kind: 'deduction', pct: null, amount: null, base: 'net', cap_pct: null, threshold: null })}
          empty={t('No steps. The lead and promotion fees set on the committee still apply.')}
          columns={[
            { key: 'label', label: t('Label|row'), className: 'sm:min-w-[10rem]', render: (r, s) => <CellText value={r.label} onChange={(v) => s({ label: v })} placeholder={t('For example: Studio success fee')} /> },
            { key: 'label_ja', label: t('Japanese label'), className: 'sm:min-w-[9rem]', render: (r, s) => <CellText value={r.label_ja} onChange={(v) => s({ label_ja: v })} placeholder="成功報酬" /> },
            { key: 'kind', label: t('Kind'), render: (r, s) => <CellSelect value={r.kind} options={kindOpts} onChange={(v) => s({ kind: v })} /> },
            { key: 'pct', label: t('Percent'), className: 'sm:max-w-[7rem]', render: (r, s) => <CellNum value={r.pct} onChange={(v) => s({ pct: v })} /> },
            { key: 'amount', label: t('Or amount'), className: 'sm:max-w-[9rem]', render: (r, s) => <CellNum value={r.amount} onChange={(v) => s({ amount: v })} /> },
            { key: 'base', label: t('Base|fee'), className: 'sm:max-w-[7rem]', render: (r, s) => <CellSelect value={r.base} options={baseOpts} onChange={(v) => s({ base: v })} /> },
            { key: 'cap', label: t('Cap %'), className: 'sm:max-w-[6rem]', render: (r, s) => <CellNum value={r.cap_pct} onChange={(v) => s({ cap_pct: v })} /> },
            { key: 'threshold', label: t('After recouping'), className: 'sm:max-w-[9rem]', render: (r, s) => <CellNum value={r.threshold} onChange={(v) => s({ threshold: v })} /> },
          ]}
          help={t('A success fee with an amount under "After recouping" only applies once the cumulative distributions pass it (usually the total investment).')}
        />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export function OverviewTab({ committee: c, onEdit }: { committee: CommitteeRec; onEdit: (() => void) | null }): React.JSX.Element {
  const { can } = useApp();
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `committee = "${c.id}" && status = "open"`, sort: 'due_date' });
  const dl = useDeadlineActions(deadlines.refresh);
  const [waterfall, setWaterfall] = useState(false);
  const steps = c.waterfall ?? [];
  const cur = c.currency;
  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('Terms|agreement tab')}
        actions={
          onEdit !== null ? (
            <Button size="sm" variant="ghost" className="h-7" onClick={onEdit}>
              <Pencil size={13} aria-hidden /> {t('Edit')}
            </Button>
          ) : undefined
        }
      >
        <FactGrid cols={4}>
          <Fact label={t('Form|committee')} value={enumLabel('committees.form', c.form)} />
          <Fact label={t('Consent for uses no window covers')} value={enumLabel('committees.consent_default', c.consent_default)} />
          <Fact label={t('Lead company fee')} value={c.lead_fee_pct > 0 ? t('{pct} of {base}', { pct: fmtPct(c.lead_fee_pct), base: enumLabel('committees.lead_fee_base', c.lead_fee_base || 'net') }) : ''} />
          <Fact label={t('Promotion lead fee')} value={c.promo_fee_pct > 0 ? fmtPct(c.promo_fee_pct) : ''} />
          <Fact label={t('Distribution due')} value={c.distribution_due_days > 0 ? t('{n} days after the period', { n: c.distribution_due_days }) : ''} />
          <Fact label={t('Fiscal year end')} value={c.fiscal_year_end} />
          <Fact label={t('Currency')} value={cur} />
          <Fact label={t('Buy-back window ends')} value={fmtDate(c.buyback_window_end)} />
        </FactGrid>
        <div className="mt-4">
          <div className="text-[11px] text-[var(--agent-app-muted)]">{t('© line')}</div>
          <div className="mt-0.5 break-words text-[13px]">{c.copyright_line !== '' ? c.copyright_line : '-'}</div>
        </div>
        {c.notes !== '' && <Prose className="mt-4 border-t border-[var(--agent-app-border)] pt-3 text-[var(--agent-app-text)]/85">{c.notes}</Prose>}
      </Section>

      <Section
        title={t('Waterfall')}
        meta={steps.length ? String(steps.length) : undefined}
        actions={
          can.rights ? (
            <Button size="sm" variant="outline" onClick={() => setWaterfall(true)}>
              <Pencil size={13} aria-hidden /> {t('Edit steps')}
            </Button>
          ) : undefined
        }
      >
        <ol className="flex flex-col gap-1.5 text-[13px]">
          <li className="text-[var(--agent-app-muted)]">{t('1. Window receipts, minus deductions (original-work fee, studio royalty, expenses), minus window fees.')}</li>
          {c.lead_fee_pct > 0 && !steps.some((s) => s.key === 'lead_fee') && (
            <li>{t('Lead company fee: {pct} of {base}', { pct: fmtPct(c.lead_fee_pct), base: enumLabel('committees.lead_fee_base', c.lead_fee_base || 'net') })}</li>
          )}
          {steps.map((s, i) => (
            <li key={`${s.key ?? ''}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{tf(s, 'label') || s.label}</span>
              <Tag>{stepKindLabel(s.kind ?? 'deduction')}</Tag>
              <span className="text-[var(--agent-app-muted)]">
                {s.amount !== undefined && s.amount > 0
                  ? fmtMoney(s.amount, cur)
                  : s.pct !== undefined && s.pct > 0
                    ? t('{pct} of {base}', { pct: fmtPct(s.pct), base: enumLabel('committees.lead_fee_base', s.base ?? 'net') })
                    : ''}
                {s.cap_pct !== undefined && s.cap_pct > 0 ? `, ${t('capped at {pct}', { pct: fmtPct(s.cap_pct) })}` : ''}
                {s.threshold !== undefined && s.threshold > 0 ? `, ${t('after {amount} is recouped', { amount: fmtMoney(s.threshold, cur) })}` : ''}
              </span>
            </li>
          ))}
          {c.promo_fee_pct > 0 && !steps.some((s) => s.key === 'promo_fee') && <li>{t('Promotion lead fee: {pct} of what is left', { pct: fmtPct(c.promo_fee_pct) })}</li>}
          <li className="text-[var(--agent-app-muted)]">{t('What is left is the pool, paid to members by their share.')}</li>
        </ol>
      </Section>

      <Section title={t('Next deadlines')} meta={deadlines.records.length ? String(deadlines.records.length) : undefined} flush>
        <DeadlineList
          deadlines={deadlines.records.slice(0, 6)}
          actions={dl.actions}
          canEdit={dl.canEdit}
          showSubject={false}
          bulk={false}
          empty={<EmptyHint compact title={t('No open deadlines')} message={t('Reviews, distributions and consent answers due for this committee appear here.')} />}
        />
      </Section>
      {dl.dialogs}
      {waterfall && <WaterfallDialog committee={c} onClose={() => setWaterfall(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

function MemberDialog({ committee, member, onClose }: { committee: CommitteeRec; member: CommitteeMemberRec | null; onClose: () => void }): React.JSX.Element {
  const m = member;
  const [party, setParty] = useState(m?.party ?? '');
  const [name, setName] = useState(m?.name ?? '');
  const [investment, setInvestment] = useState<number | null>(m?.investment ? m.investment : null);
  const [currency, setCurrency] = useState((m?.currency || committee.currency || 'JPY').toUpperCase());
  const [share, setShare] = useState<number | null>(m?.share_pct ? m.share_pct : null);
  const [cshare, setCshare] = useState<number | null>(m?.copyright_share_pct ? m.copyright_share_pct : null);
  const [roles, setRoles] = useState<string[]>(m?.roles ?? ['member']);
  const [inKind, setInKind] = useState(m?.in_kind ?? false);
  const [inKindNote, setInKindNote] = useState(m?.in_kind_note ?? '');
  const [status, setStatus] = useState<string>(m?.status || 'active');
  const [statusDate, setStatusDate] = useState(d10(m?.status_date));
  const [notes, setNotes] = useState(m?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (party === '' && name.trim() === '') {
      toast.error(t('Choose the company, or type its name.'));
      return;
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      committee: committee.id,
      party,
      name: name.trim(),
      investment: num(investment),
      currency,
      share_pct: num(share),
      copyright_share_pct: num(cshare),
      roles,
      in_kind: inKind,
      in_kind_note: inKindNote.trim(),
      status,
      status_date: toPb(statusDate),
      notes: notes.trim(),
    };
    try {
      if (m === null) await createRecord('committee_members', payload);
      else await updateRecord('committee_members', m.id, payload);
      toast.success(t('Member saved'));
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={m === null ? t('Add a member') : t('Edit member')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <PartyPicker label={t('Company|member')} value={party} onChange={(id) => setParty(id)} />
          <Input label={t('Name as shown (optional)')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label={t('Investment')} value={investment} onChange={setInvestment} />
          <Select label={t('Currency')} value={currency} options={CURRENCIES.map((x) => ({ value: x, label: x }))} onChange={(e) => setCurrency(e.target.value)} />
          <NumField label={t('Share|member')} value={share} onChange={setShare} suffix="%" help={t('Share of distributions.')} />
          <NumField label={t('Copyright share')} value={cshare} onChange={setCshare} suffix="%" />
        </div>
        <Field label={t('Roles|member')}>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {MEMBER_ROLES.map((r) => (
              <Checkbox key={r} checked={roles.includes(r)} label={memberRoleLabel(r)} onChange={(v) => setRoles(v ? [...roles, r] : roles.filter((x) => x !== r))} />
            ))}
          </div>
        </Field>
        <div className="flex flex-col gap-2">
          <Switch checked={inKind} onCheckedChange={setInKind} label={t('Contributes in kind (production, airtime, promotion)')} />
          {inKind && <Input aria-label={t('What is contributed')} value={inKindNote} onChange={(e) => setInKindNote(e.target.value)} placeholder={t('What is contributed')} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Status')} value={status} options={enumOptions('committee_members.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
          <DateField label={t('Status since')} value={statusDate} onChange={setStatusDate} />
        </div>
        <Textarea label={t('Notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}

export function MembersTab({ committee }: { committee: CommitteeRec }): React.JSX.Element {
  const { can } = useApp();
  const members = useCollection<CommitteeMemberRec>('committee_members', { filter: `committee = "${committee.id}"`, sort: '-share_pct,created', expand: 'party' });
  const [editing, setEditing] = useState<CommitteeMemberRec | 'new' | null>(null);
  const del = useDeleteRecord();
  const live = members.records.filter((m) => m.status !== 'exited');
  const total = Math.round(live.reduce((s, m) => s + m.share_pct, 0) * 100) / 100;
  const ctotal = Math.round(live.reduce((s, m) => s + m.copyright_share_pct, 0) * 100) / 100;
  const ok = Math.abs(total - 100) < 0.01;
  const invested = live.reduce((s, m) => s + m.investment, 0);

  const remove = (m: CommitteeMemberRec): void =>
    del.ask('committee_members', m.id, undefined, t('To keep the history, mark the member as exited instead.'));

  return (
    <div className="flex flex-col gap-4">
      {del.element}
      {live.length > 0 && (
        <Notice tone={ok ? 'good' : 'warn'}>
          {ok ? t('Shares add up to 100%.') : t('Shares add up to {n}%, not 100%. Distributions cannot be issued until they do.', { n: total })}
          {ctotal > 0 && Math.abs(ctotal - 100) >= 0.01 ? ` ${t('Copyright shares add up to {n}%.', { n: ctotal })}` : ''}
        </Notice>
      )}
      <Section
        title={t('Members')}
        meta={live.length ? `${live.length} · ${fmtMoney(invested, committee.currency)}` : undefined}
        flush
        actions={
          can.rights ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden /> {t('Add a member')}
            </Button>
          ) : undefined
        }
      >
        {members.loading ? (
          <Loading />
        ) : members.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Users}
            title={t('No members yet')}
            message={t('Add each company that invests: its investment, share of distributions and copyright share, and its roles (lead company, studio, publisher, label, broadcaster).')}
            action={can.rights ? <Button size="sm" onClick={() => setEditing('new')}>{t('Add a member')}</Button> : undefined}
          />
        ) : (
          members.records.map((m) => (
            <div key={m.id} className={cn('flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0', m.status === 'exited' && 'opacity-60')}>
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2">
                  {m.party !== '' ? (
                    <a href={href('people', m.party)} className="truncate text-sm font-medium hover:underline">
                      {memberName(m)}
                    </a>
                  ) : (
                    <span className="truncate text-sm font-medium">{memberName(m)}</span>
                  )}
                  {m.status !== 'active' && <EnumPill field="committee_members.status" value={m.status} />}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {(m.roles ?? []).map((r) => (
                    <Tag key={r}>{memberRoleLabel(r)}</Tag>
                  ))}
                  {m.in_kind && <Tag title={m.in_kind_note}>{t('In kind')}</Tag>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-right text-[13px] tabular-nums">
                <div>
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Investment')}</div>
                  <div>{m.investment > 0 ? fmtMoney(m.investment, m.currency || committee.currency) : '-'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Share|member')}</div>
                  <div className="font-medium">{fmtPct(m.share_pct)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Copyright share')}</div>
                  <div>{m.copyright_share_pct > 0 ? fmtPct(m.copyright_share_pct) : '-'}</div>
                </div>
              </div>
              {can.rights && (
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label={t('Edit')} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" onClick={() => setEditing(m)}>
                    <Pencil size={14} />
                  </button>
                  {can.manage && (
                    <button type="button" aria-label={t('Remove')} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => remove(m)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {live.length > 0 && (
          <div className="flex flex-wrap justify-end gap-4 border-t border-[var(--agent-app-border)] px-4 py-2 text-[13px] tabular-nums">
            <span>
              <span className="text-[var(--agent-app-muted)]">{t('Total share')}: </span>
              <span className={cn('font-semibold', ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>{fmtPct(total)}</span>
            </span>
          </div>
        )}
      </Section>
      {editing !== null && <MemberDialog committee={committee} member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

export function WindowsTab({ committee }: { committee: CommitteeRec }): React.JSX.Element {
  const { can } = useApp();
  const agreements = useCollection<AgreementRec>('agreements', { filter: `committee = "${committee.id}" && agreement_type = "committee"`, sort: 'created' });
  const windows = useCollection<GrantRec>('grants', {
    filter: `kind = "window" && agreement.committee = "${committee.id}" && agreement.agreement_type = "committee"`,
    sort: 'created',
    expand: `${ASSET_EXPAND},holders,agreement`,
  });
  const members = useCollection<CommitteeMemberRec>('committee_members', { filter: `committee = "${committee.id}"`, sort: 'created', expand: 'party' });
  const summary = useDimSummary();
  const [editing, setEditing] = useState<{ grant: GrantRec | null; agreement: AgreementRec } | null>(null);
  const [creating, setCreating] = useState(false);
  const del = useDeleteRecord();
  const main = agreements.records.find((a) => a.id === committee.agreement) ?? agreements.records[0];
  const defaultAssets: AssetSel = { ...EMPTY_ASSETS, works: committee.work !== '' ? [committee.work] : [], franchises: committee.franchise !== '' && committee.work === '' ? [committee.franchise] : [] };

  const add = async (): Promise<void> => {
    if (main !== undefined) {
      setEditing({ grant: null, agreement: main });
      return;
    }
    setCreating(true);
    try {
      const a = await createRecord<AgreementRec>('agreements', {
        title: t('{name} committee agreement', { name: committee.name }),
        agreement_type: 'committee',
        direction: 'mutual',
        status: 'active',
        committee: committee.id,
        work: committee.work,
        franchise: committee.franchise,
        currency: committee.currency,
        effective_date: toPb(d10(committee.formed_date)),
        term_start: toPb(d10(committee.formed_date)),
        term_end: toPb(d10(committee.term_end)),
      });
      if (committee.agreement === '') await updateRecord('committees', committee.id, { agreement: a.id });
      toast.success(t('Committee agreement created. Windows are recorded on it.'));
      setEditing({ grant: null, agreement: a });
    } catch {
      /* toast shown by the client */
    } finally {
      setCreating(false);
    }
  };

  const remove = (g: GrantRec): void =>
    del.ask('grants', g.id, undefined, t('Uses this window covered will need every member to agree again.'));

  return (
    <div className="flex flex-col gap-4">
      {del.element}
      <Notice icon={Gavel}>
        {t('A window (窓口) lets one member decide and license a use category for everyone, taking a window fee. Uses no window covers need the committee to consent (Copyright Act Art. 65(2)).')}
      </Notice>
      <Section
        title={t('Windows')}
        meta={windows.records.length ? String(windows.records.length) : undefined}
        flush
        actions={
          <>
            {main !== undefined && (
              <a href={href('agreement', main.id)} className="hidden text-xs font-medium text-[var(--agent-app-accent)] hover:underline sm:inline">
                {t('Committee agreement')}
              </a>
            )}
            {can.rights && can.edit && (
              <Button size="sm" onClick={() => void add()} loading={creating}>
                <Plus size={13} aria-hidden /> {t('Add a window')}
              </Button>
            )}
          </>
        }
      >
        {windows.loading ? (
          <Loading />
        ) : windows.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Layers}
            title={t('No windows yet')}
            message={
              main === undefined
                ? t('Windows are recorded on the committee agreement. Adding the first one creates that agreement for you.')
                : t('Record which member holds each use: domestic merchandise, overseas, video, music, games, streaming.')
            }
            action={can.rights && can.edit ? <Button size="sm" onClick={() => void add()} loading={creating}>{t('Add a window')}</Button> : undefined}
          />
        ) : (
          windows.records.map((g) => {
            const ex = (g.expand ?? {}) as Record<string, unknown>;
            const holders = Array.isArray(ex['holders']) ? (ex['holders'] as PartyRec[]).map((p) => p.name) : [];
            const agr = ex['agreement'] as AgreementRec | undefined;
            const lines = summary(g.dims);
            const term = termText({ term_start: g.term_start, term_end: g.term_end }) || (agr !== undefined ? termText(agr) : '') || t('Committee term');
            return (
              <div key={g.id} className="flex flex-wrap items-start gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="break-words text-sm font-medium">{lines.length > 0 ? lines.map((l) => l.text).join(' / ') : t('Every use')}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--agent-app-muted)]">
                    {lines.map((l) => (
                      <span key={l.key}>
                        {l.label}: {l.text}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-[var(--agent-app-muted)]">{term}</div>
                </div>
                <div className="min-w-0 text-[13px]">
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Window holder')}</div>
                  <div className="font-medium">{holders.length > 0 ? joinList(holders) : '-'}</div>
                  {g.fee_pct > 0 && <div className="text-xs text-[var(--agent-app-muted)]">{t('Window fee {pct} of {base}', { pct: fmtPct(g.fee_pct), base: enumLabel('grants.fee_base', g.fee_base || 'net') })}</div>}
                </div>
                {can.edit && agr !== undefined && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" aria-label={t('Edit')} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" onClick={() => setEditing({ grant: g, agreement: agr })}>
                      <Pencil size={14} />
                    </button>
                    {can.manage && (
                      <button type="button" aria-label={t('Delete')} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => remove(g)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Section>
      {editing !== null && (
        <GrantEditor agreement={editing.agreement} grant={editing.grant} members={members.records} windowOnly defaultAssets={defaultAssets} onClose={() => setEditing(null)} onSaved={windows.refresh} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Who decides                                                         */
/* ------------------------------------------------------------------ */

const WHO_DIMS = ['category', 'media', 'territory', 'channel', 'platform', 'language'];

function sharePct(m: unknown): number | null {
  const v = (m as Record<string, unknown>)['share_pct'];
  return typeof v === 'number' ? v : null;
}

export function WhoDecidesTab({ committee }: { committee: CommitteeRec }): React.JSX.Element {
  const { dimLabel } = useApp();
  const dims = useRightsDims();
  const [use, setUse] = useState<Record<string, string[]>>({ territory: ['JP'] });
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(addDays(addMonths(today(), 12), -1));
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [res, setRes] = useState<DeciderExt | null>(null);
  const [none, setNone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = WHO_DIMS.filter((d) => dims.enabled.includes(d));

  const ask = async (): Promise<void> => {
    if (end < start) {
      toast.error(t('Choose dates where the end comes after the start.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await op<Record<string, unknown>>('committees/who-decides', {
        committee_id: committee.id,
        use: Object.fromEntries(Object.entries(use).filter(([, v]) => v.length > 0)),
        start,
        end,
      });
      if (r['decider'] === null || r['mode'] === undefined) {
        setRes(null);
        setNone(true);
      } else {
        setRes(r as unknown as DeciderExt);
        setNone(false);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const tone = res === null ? 'neutral' : res.mode === 'window' || res.mode === 'shared_window' ? 'good' : res.mode === 'conflict' ? 'bad' : 'info';
  const modeLabel = (m: string): string =>
    m === 'window' ? t('Window holder decides') : m === 'shared_window' ? t('Shared window') : m === 'conflict' ? t('Two windows claim it') : m === 'partial' ? t('Partly a window') : t('Committee consent');

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('Who decides?')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
                <SlidersHorizontal size={13} aria-hidden /> {t('Use|question')}
              </span>
              {list.map((d) => {
                const chosen = use[d] ?? [];
                return (
                  <button
                    key={d}
                    type="button"
                    aria-expanded={openPicker === d}
                    onClick={() => setOpenPicker((o) => (o === d ? null : d))}
                    className={cn(
                      'max-w-full truncate border px-2 py-1 text-xs',
                      chosen.length > 0 ? 'border-[var(--agent-app-accent)]/60 bg-[var(--agent-app-accent)]/10' : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                      openPicker === d && 'border-[var(--agent-app-accent)]',
                    )}
                  >
                    {dims.title(d)}: {chosen.length === 0 ? (d === 'territory' ? t('Worldwide') : t('Any|use')) : joinList(chosen.map((c) => dimLabel(d, c)))}
                  </button>
                );
              })}
            </div>
            {openPicker !== null && (
              <div className="max-w-xl">
                <DimensionPicker key={openPicker} dimension={openPicker} label={dims.title(openPicker)} value={{ include: use[openPicker] ?? [] }} onChange={(v) => setUse((u) => ({ ...u, [openPicker]: v.include ?? [] }))} allowExclude={false} />
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <DateField label={t('From')} value={start} onChange={setStart} />
            <DateField label={t('To')} value={end} onChange={setEnd} />
            <div>
              <Button onClick={() => void ask()} loading={busy}>
                <Search size={14} aria-hidden /> {t('Ask|can we')}
              </Button>
            </div>
          </div>
        </div>
      </Section>
      {error !== '' && <ErrorBox message={error} />}
      {none && <Notice tone="warn">{t('The committee could not be read. Check that it still exists.')}</Notice>}
      {res !== null && (
        <Section title={t('Answer')}>
          <div className="flex flex-col gap-3">
            <div>
              <Pill tone={tone}>{modeLabel(res.mode)}</Pill>
            </div>
            <p className="break-words text-[13px] leading-relaxed">{bi(res.text)}</p>
            {(res.windows ?? []).length > 0 && (
              <div className="flex flex-col border border-[var(--agent-app-border)]">
                {(res.windows ?? []).map((w) => (
                  <div key={w.grant_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--agent-app-border)]/70 px-3 py-2 text-[13px] last:border-0">
                    <span className="font-medium">{joinList(w.holders.map((h) => h.name))}</span>
                    {w.fee_pct > 0 && <span className="text-xs text-[var(--agent-app-muted)]">{t('Window fee {pct} of {base}', { pct: fmtPct(w.fee_pct), base: enumLabel('grants.fee_base', w.fee_base || 'net') })}</span>}
                    <a href={href('agreement', w.agreement_id)} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
                      {t('Committee agreement')}
                    </a>
                  </div>
                ))}
              </div>
            )}
            {(res.mode === 'consent' || res.mode === 'partial' || res.mode === 'conflict') && (res.members ?? []).length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-[var(--agent-app-muted)]">{t('Members who must agree')}</div>
                <ul className="flex flex-wrap gap-1.5">
                  {(res.members ?? [])
                    .filter((m) => m.status !== 'exited')
                    .map((m) => (
                      <li key={m.id} className="border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
                        {m.name}
                        {sharePct(m) !== null ? ` (${fmtPct(sharePct(m))})` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

export function CommitteeDeadlinesTab({ committee }: { committee: CommitteeRec }): React.JSX.Element {
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `committee = "${committee.id}"`, sort: 'due_date' });
  const dl = useDeadlineActions(deadlines.refresh);
  return (
    <Section title={t('Deadlines')} meta={deadlines.records.length ? String(deadlines.records.length) : undefined} flush>
      {deadlines.loading ? (
        <Loading />
      ) : (
        <DeadlineList
          deadlines={deadlines.records}
          actions={dl.actions}
          canEdit={dl.canEdit}
          showSubject={false}
          empty={<EmptyHint compact title={t('No deadlines yet')} message={t('Term reviews, distribution dates and consent answers due for this committee appear here.')} />}
        />
      )}
      {dl.dialogs}
    </Section>
  );
}

/** Every committee's members, grouped by committee (for list pages). */
export function useCommitteeMembers(): { byCommittee: Map<string, CommitteeMemberRec[]>; loading: boolean } {
  const members = useCollection<CommitteeMemberRec>('committee_members', { sort: 'created', expand: 'party' });
  const byCommittee = useMemo(() => {
    const m = new Map<string, CommitteeMemberRec[]>();
    for (const r of members.records) {
      const arr = m.get(r.committee) ?? [];
      arr.push(r);
      m.set(r.committee, arr);
    }
    return m;
  }, [members.records]);
  return { byCommittee, loading: members.loading };
}

export function leadOf(list: CommitteeMemberRec[] | undefined): string {
  const lead = (list ?? []).filter((m) => m.status !== 'exited' && (m.roles ?? []).includes('lead'));
  return joinList(lead.map(memberName));
}

export function MemberCount({ list }: { list: CommitteeMemberRec[] | undefined }): React.JSX.Element {
  const n = (list ?? []).filter((m) => m.status !== 'exited').length;
  return <span className="tabular-nums">{fmtNumber(n)}</span>;
}

export function ListRowCommittee({ c, list, onOpen }: { c: CommitteeRec; list: CommitteeMemberRec[] | undefined; onOpen: () => void }): React.JSX.Element {
  const { nameOf } = useApp();
  const lead = leadOf(list);
  const n = (list ?? []).filter((m) => m.status !== 'exited').length;
  return (
    <ListRow
      onClick={onOpen}
      primary={c.name}
      secondary={[c.work !== '' ? nameOf('work', c.work) : '', enumLabel('committees.form', c.form), lead !== '' ? t('Lead: {name}', { name: lead }) : '', t('{n} members', { n })].filter((x) => x !== '').join(' · ')}
      trailing={<EnumPill field="committees.status" value={c.status} />}
    />
  );
}

