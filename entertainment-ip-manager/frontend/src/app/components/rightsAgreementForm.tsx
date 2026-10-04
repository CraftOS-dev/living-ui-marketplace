/**
 * The agreement form: the common fields for a new agreement, and every
 * term grouped (money, licensing, term, creator, talent, other) for an
 * existing one. The reference is derived by the server. Also the "From a
 * contract" dialog: upload the contract and CraftBot proposes the
 * agreement in the Inbox.
 */
import { useRef, useState } from 'react';
import { Bot, Upload } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, Textarea, cn, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { d10, toPb, today } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import { ENUM_LABEL } from '../lib/enums.ts';
import { JA } from '../locales/ja/index.ts';
import { href } from '../lib/router.ts';
import type { AgreementRec, CommitteeRec, DocumentRec } from '../lib/records.ts';
import type { StageTemplate } from '../lib/shapes.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { CatalogSelect, PartyPicker, UserSelect } from './pickers.tsx';
import { Checkbox, Field, Notice, Segmented } from './ui.tsx';
import { CellDate, CellNum, CellSelect, CellText, DateField, NumField, RowsEditor, num } from './rightsShared.tsx';

export type FormGroup = 'basics' | 'money' | 'licensing' | 'term' | 'creator' | 'talent' | 'other';

interface TierRow {
  from: number | null;
  to: number | null;
  rate: number | null;
}
interface PayRow {
  date: string;
  amount: number | null;
  label: string;
}
interface DelRow {
  date: string;
  label: string;
}
interface StageRow {
  key: string;
  sla_days: number | null;
  reviewers: string[];
}
interface ShareRow {
  category: string;
  pct: number | null;
}
interface PostTerm {
  archives: string;
  merch_sell_off_days: number | null;
  music: string;
  voice: string;
  notes: string;
}

export interface AgreementDraft {
  title: string;
  agreement_type: string;
  direction: string;
  status: string;
  counterparty: string;
  agent: string;
  our_entity: string;
  franchise: string;
  work: string;
  committee: string;
  responsible: string;
  signed_date: string;
  effective_date: string;
  term_start: string;
  term_end: string;
  perpetual: boolean;
  auto_renew: boolean;
  renewal_notice_days: number | null;
  exclusivity: string;
  territory_summary: string;
  currency: string;
  royalty_basis: string;
  royalty_rate: number | null;
  rate_tiers: TierRow[];
  deduction_cap_pct: number | null;
  flat_fee: number | null;
  advance: number | null;
  minimum_guarantee: number | null;
  mg_recoupable: boolean;
  cross_collateral: boolean;
  payment_schedule: PayRow[];
  reporting_frequency: string;
  report_due_days: number | null;
  late_interest_pct: number | null;
  audit_threshold_pct: number | null;
  approval_stages: StageRow[];
  approval_sla_days: number | null;
  approval_timeout: string;
  original_approval_required: boolean;
  talent_approval_required: boolean;
  copyright_notice: string;
  style_guide_version: string;
  samples_owed: number | null;
  sublicense_allowed: boolean;
  sell_off_days: number | null;
  sell_off_on_expiry_only: boolean;
  option_period_end: string;
  option_extension_fee: number | null;
  reversion_date: string;
  completion_deadline: string;
  sequel_negotiation_end: string;
  delivery_schedule: DelRow[];
  author_grant: boolean;
  art27_28: boolean;
  moral_rights_waiver: boolean;
  payment_due_days: number | null;
  stage_name_clause: string;
  non_compete: boolean;
  post_term: PostTerm;
  revenue_share: ShareRow[];
  governing_law: string;
  summary: string;
  notes: string;
}

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(rec) : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
function nn(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function zeroNull(n: number): number | null {
  return n === 0 ? null : n;
}

/** Plain text of a rich-text field. */
export function plainText(html: string): string {
  if (html.trim() === '' || !html.includes('<')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').trim();
}

function fromRecord(a: AgreementRec | null, home: string, defaults: Partial<AgreementDraft>): AgreementDraft {
  const pt = rec(a?.post_term);
  return {
    title: a?.title ?? '',
    agreement_type: a?.agreement_type ?? '',
    direction: a?.direction ?? '',
    status: a?.status || 'draft',
    counterparty: a?.counterparty ?? '',
    agent: a?.agent ?? '',
    our_entity: a?.our_entity ?? '',
    franchise: a?.franchise ?? '',
    work: a?.work ?? '',
    committee: a?.committee ?? '',
    responsible: a?.responsible ?? '',
    signed_date: d10(a?.signed_date),
    effective_date: d10(a?.effective_date),
    term_start: d10(a?.term_start),
    term_end: d10(a?.term_end),
    perpetual: a?.perpetual ?? false,
    auto_renew: a?.auto_renew ?? false,
    renewal_notice_days: zeroNull(a?.renewal_notice_days ?? 0),
    exclusivity: a?.exclusivity ?? '',
    territory_summary: a?.territory_summary ?? '',
    currency: (a?.currency || home).toUpperCase(),
    royalty_basis: a?.royalty_basis ?? '',
    royalty_rate: zeroNull(a?.royalty_rate ?? 0),
    rate_tiers: arr(a?.rate_tiers).map((x) => ({ from: nn(x['from'] ?? x['from_qty']), to: nn(x['to']), rate: nn(x['rate']) })),
    deduction_cap_pct: zeroNull(a?.deduction_cap_pct ?? 0),
    flat_fee: zeroNull(a?.flat_fee ?? 0),
    advance: zeroNull(a?.advance ?? 0),
    minimum_guarantee: zeroNull(a?.minimum_guarantee ?? 0),
    mg_recoupable: a?.mg_recoupable ?? false,
    cross_collateral: a?.cross_collateral ?? false,
    payment_schedule: arr(a?.payment_schedule).map((x) => ({ date: d10(str(x['date'])), amount: nn(x['amount']), label: str(x['label']) })),
    reporting_frequency: a?.reporting_frequency ?? '',
    report_due_days: zeroNull(a?.report_due_days ?? 0),
    late_interest_pct: zeroNull(a?.late_interest_pct ?? 0),
    audit_threshold_pct: zeroNull(a?.audit_threshold_pct ?? 0),
    approval_stages: arr(a?.approval_stages).map((x) => ({
      key: str(x['key']),
      sla_days: nn(x['sla_days']),
      reviewers: Array.isArray(x['reviewers']) ? (x['reviewers'] as unknown[]).map(str) : [],
    })),
    approval_sla_days: zeroNull(a?.approval_sla_days ?? 0),
    approval_timeout: a?.approval_timeout ?? '',
    original_approval_required: a?.original_approval_required ?? false,
    talent_approval_required: a?.talent_approval_required ?? false,
    copyright_notice: a?.copyright_notice ?? '',
    style_guide_version: a?.style_guide_version ?? '',
    samples_owed: zeroNull(a?.samples_owed ?? 0),
    sublicense_allowed: a?.sublicense_allowed ?? false,
    sell_off_days: zeroNull(a?.sell_off_days ?? 0),
    sell_off_on_expiry_only: a?.sell_off_on_expiry_only ?? false,
    option_period_end: d10(a?.option_period_end),
    option_extension_fee: zeroNull(a?.option_extension_fee ?? 0),
    reversion_date: d10(a?.reversion_date),
    completion_deadline: d10(a?.completion_deadline),
    sequel_negotiation_end: d10(a?.sequel_negotiation_end),
    delivery_schedule: arr(a?.delivery_schedule).map((x) => ({ date: d10(str(x['date'])), label: str(x['label']) || str(x['item']) })),
    author_grant: a?.author_grant ?? false,
    art27_28: a?.art27_28 ?? false,
    moral_rights_waiver: a?.moral_rights_waiver ?? false,
    payment_due_days: zeroNull(a?.payment_due_days ?? 0),
    stage_name_clause: a?.stage_name_clause ?? '',
    non_compete: a?.non_compete ?? false,
    post_term: {
      archives: str(pt['archives']),
      merch_sell_off_days: nn(pt['merch_sell_off_days']),
      music: str(pt['music']),
      voice: str(pt['voice']),
      notes: str(pt['notes']),
    },
    revenue_share: arr(a?.revenue_share).map((x) => ({ category: str(x['category']), pct: nn(x['pct']) })),
    governing_law: a?.governing_law ?? '',
    summary: a?.summary ?? '',
    notes: plainText(a?.notes ?? ''),
    ...defaults,
  };
}

const STAGE_KEYS = Object.keys(ENUM_LABEL['approvals.stage'] ?? {});

function stageEnglish(key: string): string {
  const raw = ENUM_LABEL['approvals.stage']?.[key] ?? key;
  return raw.split('|')[0] ?? raw;
}

function toPayload(d: AgreementDraft, group: 'basics' | 'all'): Record<string, unknown> {
  const basics: Record<string, unknown> = {
    title: d.title.trim(),
    agreement_type: d.agreement_type,
    direction: d.direction,
    status: d.status,
    counterparty: d.counterparty,
    agent: d.agent,
    our_entity: d.our_entity.trim(),
    franchise: d.franchise,
    work: d.work,
    committee: d.committee,
    responsible: d.responsible,
    signed_date: toPb(d.signed_date),
    effective_date: toPb(d.effective_date),
    term_start: toPb(d.term_start),
    term_end: d.perpetual ? '' : toPb(d.term_end),
    perpetual: d.perpetual,
    exclusivity: d.exclusivity,
    currency: d.currency,
  };
  if (group === 'basics') return basics;
  const pt = d.post_term;
  const postTerm: Record<string, unknown> = {};
  if (pt.archives.trim() !== '') postTerm['archives'] = pt.archives.trim();
  if (pt.merch_sell_off_days !== null) postTerm['merch_sell_off_days'] = pt.merch_sell_off_days;
  if (pt.music.trim() !== '') postTerm['music'] = pt.music.trim();
  if (pt.voice.trim() !== '') postTerm['voice'] = pt.voice.trim();
  if (pt.notes.trim() !== '') postTerm['notes'] = pt.notes.trim();
  return {
    ...basics,
    auto_renew: d.auto_renew,
    renewal_notice_days: num(d.renewal_notice_days),
    territory_summary: d.territory_summary.trim(),
    royalty_basis: d.royalty_basis,
    royalty_rate: num(d.royalty_rate),
    // The pricing engine reads from_qty; from/to keep the band readable.
    rate_tiers: d.rate_tiers
      .filter((r) => r.rate !== null)
      .map((r) => ({ from: num(r.from), from_qty: num(r.from), ...(r.to !== null ? { to: r.to } : {}), rate: num(r.rate) })),
    deduction_cap_pct: num(d.deduction_cap_pct),
    flat_fee: num(d.flat_fee),
    advance: num(d.advance),
    minimum_guarantee: num(d.minimum_guarantee),
    mg_recoupable: d.mg_recoupable,
    cross_collateral: d.cross_collateral,
    payment_schedule: d.payment_schedule.filter((r) => r.date !== '').map((r) => ({ date: r.date, amount: num(r.amount), ...(r.label.trim() !== '' ? { label: r.label.trim() } : {}) })),
    reporting_frequency: d.reporting_frequency,
    report_due_days: num(d.report_due_days),
    late_interest_pct: num(d.late_interest_pct),
    audit_threshold_pct: num(d.audit_threshold_pct),
    approval_stages: d.approval_stages
      .filter((s) => s.key !== '')
      .map((s): StageTemplate => {
        const en = stageEnglish(s.key);
        return { key: s.key, label: en, label_ja: JA[ENUM_LABEL['approvals.stage']?.[s.key] ?? ''] ?? en, sla_days: num(s.sla_days), reviewers: (s.reviewers.length > 0 ? s.reviewers : ['internal']) as NonNullable<StageTemplate['reviewers']> };
      }),
    approval_sla_days: num(d.approval_sla_days),
    approval_timeout: d.approval_timeout,
    original_approval_required: d.original_approval_required,
    talent_approval_required: d.talent_approval_required,
    copyright_notice: d.copyright_notice.trim(),
    style_guide_version: d.style_guide_version.trim(),
    samples_owed: num(d.samples_owed),
    sublicense_allowed: d.sublicense_allowed,
    sell_off_days: num(d.sell_off_days),
    sell_off_on_expiry_only: d.sell_off_on_expiry_only,
    option_period_end: toPb(d.option_period_end),
    option_extension_fee: num(d.option_extension_fee),
    reversion_date: toPb(d.reversion_date),
    completion_deadline: toPb(d.completion_deadline),
    sequel_negotiation_end: toPb(d.sequel_negotiation_end),
    // The obligation engine reads item; label is the same text.
    delivery_schedule: d.delivery_schedule.filter((r) => r.date !== '').map((r) => ({ date: r.date, label: r.label.trim(), item: r.label.trim() })),
    author_grant: d.author_grant,
    art27_28: d.art27_28,
    moral_rights_waiver: d.moral_rights_waiver,
    payment_due_days: num(d.payment_due_days),
    stage_name_clause: d.stage_name_clause,
    non_compete: d.non_compete,
    post_term: Object.keys(postTerm).length > 0 ? postTerm : null,
    revenue_share: d.revenue_share.filter((r) => r.category.trim() !== '' || r.pct !== null).map((r) => ({ category: r.category.trim(), pct: num(r.pct) })),
    governing_law: d.governing_law.trim(),
    summary: d.summary.trim(),
    notes: d.notes,
  };
}

const REVIEWER_KINDS = ['internal', 'committee', 'original', 'talent', 'reviewer'] as const;
function reviewerLabel(k: string): string {
  switch (k) {
    case 'internal':
      return t('Our licensing team');
    case 'committee':
      return t('Committee');
    case 'original':
      return t('Original author side');
    case 'talent':
      return t('Talent');
    case 'reviewer':
      return t('Outside reviewer');
    default:
      return k;
  }
}

function groupLabel(g: FormGroup): string {
  switch (g) {
    case 'basics':
      return t('Basics|form');
    case 'money':
      return t('Money|terms');
    case 'licensing':
      return t('Licensing');
    case 'term':
      return t('Term|agreement');
    case 'creator':
      return t('Creator|terms');
    case 'talent':
      return t('Talent');
    default:
      return t('Other');
  }
}

export function AgreementForm({
  agreement,
  initialGroup = 'basics',
  defaults,
  onClose,
  onSaved,
}: {
  agreement: AgreementRec | null;
  initialGroup?: FormGroup | undefined;
  defaults?: Partial<AgreementDraft> | undefined;
  onClose: () => void;
  onSaved: (rec: AgreementRec) => void;
}): React.JSX.Element {
  const { homeCurrency, on } = useApp();
  const committees = useCollection<CommitteeRec>('committees', { sort: 'name' });
  const [d, setD] = useState<AgreementDraft>(() => fromRecord(agreement, homeCurrency, defaults ?? {}));
  const [group, setGroup] = useState<FormGroup>(agreement === null ? 'basics' : initialGroup);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof AgreementDraft>(k: K, v: AgreementDraft[K]): void => setD((x) => ({ ...x, [k]: v }));
  const isNew = agreement === null;

  const save = async (): Promise<void> => {
    const e: Record<string, string> = {};
    if (d.title.trim() === '') e['title'] = t('Give the agreement a title.');
    if (d.agreement_type === '') e['agreement_type'] = t('Choose the type.');
    if (d.direction === '') e['direction'] = t('Choose the direction.');
    if (!d.perpetual && d.term_start !== '' && d.term_end !== '' && d.term_end < d.term_start) e['term_end'] = t('The end must be after the start.');
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setGroup('basics');
      return;
    }
    setBusy(true);
    try {
      const payload = toPayload(d, isNew ? 'basics' : 'all');
      const saved = isNew ? await createRecord<AgreementRec>('agreements', payload) : await updateRecord<AgreementRec>('agreements', agreement.id, payload);
      toast.success(isNew ? t('Agreement created') : t('Agreement saved. Obligations follow the new terms.'));
      onSaved(saved);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  const groups: FormGroup[] = isNew ? ['basics'] : ['basics', 'money', 'licensing', 'term', 'creator', 'talent', 'other'];
  const opts = (key: string): { value: string; label: string }[] => enumOptions(key).map(([value, label]) => ({ value, label }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? t('New agreement') : t('Edit agreement')}
      description={isNew ? t('Start with the essentials. Money, licensing and term details can be added once it is saved.') : t('Every change is kept in the history. Obligation deadlines follow the terms.')}
      className="w-[min(94vw,48rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {isNew ? t('Create agreement') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {groups.length > 1 && (
          <div className="overflow-x-auto">
            <Segmented<FormGroup> value={group} onChange={setGroup} ariaLabel={t('Section|form')} size="sm" options={groups.map((g) => ({ value: g, label: groupLabel(g) }))} />
          </div>
        )}
        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          {group === 'basics' && (
            <>
              <Input label={t('Title|field')} value={d.title} error={errors['title']} onChange={(e) => set('title', e.target.value)} placeholder={t('For example: Merchandise licence, acrylic goods, Taiwan')} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label={t('Agreement type')} value={d.agreement_type} error={errors['agreement_type']} placeholder={t('Choose')} options={opts('agreements.agreement_type')} onChange={(e) => set('agreement_type', e.target.value)} />
                <Select label={t('Direction')} value={d.direction} error={errors['direction']} placeholder={t('Choose')} options={opts('agreements.direction')} onChange={(e) => set('direction', e.target.value)} />
                <Select label={t('Status')} value={d.status} options={opts('agreements.status')} onChange={(e) => set('status', e.target.value)} />
              </div>
              <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">{t('In: we receive rights (original work, creators, music). Out: we grant them (licensees, platforms). Mutual: committee and co-production agreements.')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <PartyPicker label={t('Counterparty')} value={d.counterparty} onChange={(id) => set('counterparty', id)} />
                <PartyPicker label={t('Agent for the counterparty')} value={d.agent} onChange={(id) => set('agent', id)} />
                <Input label={t('Our contracting entity')} value={d.our_entity} onChange={(e) => set('our_entity', e.target.value)} />
                <UserSelect label={t('Responsible')} value={d.responsible} onChange={(id) => set('responsible', id)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(on('franchises') || d.franchise !== '') && <CatalogSelect kind="franchise" label={t('Franchise')} value={d.franchise} onChange={(id) => set('franchise', id)} />}
                {(on('titles') || d.work !== '') && <CatalogSelect kind="work" label={t('Title')} value={d.work} onChange={(id) => set('work', id)} />}
                {(on('committees') || d.committee !== '') && (
                  <Select label={t('Committee')} value={d.committee} placeholder={t('None')} options={committees.records.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => set('committee', e.target.value)} />
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DateField label={t('Signed')} value={d.signed_date} onChange={(v) => set('signed_date', v)} />
                <DateField label={t('Effective')} value={d.effective_date} onChange={(v) => set('effective_date', v)} />
                <DateField label={t('Term starts')} value={d.term_start} onChange={(v) => set('term_start', v)} />
                <DateField label={t('Term ends')} value={d.term_end} error={errors['term_end']} disabled={d.perpetual} onChange={(v) => set('term_end', v)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-end pb-2">
                  <Switch checked={d.perpetual} onCheckedChange={(v) => set('perpetual', v)} label={t('No end date')} />
                </div>
                <Select label={t('Exclusivity')} value={d.exclusivity} placeholder={t('Not set')} options={opts('agreements.exclusivity')} onChange={(e) => set('exclusivity', e.target.value)} />
                <Select label={t('Currency')} value={d.currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={(e) => set('currency', e.target.value)} />
              </div>
            </>
          )}

          {group === 'money' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label={t('Royalty basis')} value={d.royalty_basis} placeholder={t('Not set')} options={opts('agreements.royalty_basis')} onChange={(e) => set('royalty_basis', e.target.value)} />
                <NumField label={t('Royalty rate')} value={d.royalty_rate} onChange={(v) => set('royalty_rate', v)} suffix="%" />
                <NumField label={t('Deduction cap')} value={d.deduction_cap_pct} onChange={(v) => set('deduction_cap_pct', v)} suffix="%" help={t('For net bases: the most the licensee may deduct.')} />
              </div>
              <RowsEditor<TierRow>
                label={t('Rate tiers')}
                rows={d.rate_tiers}
                onChange={(rows) => set('rate_tiers', rows)}
                blank={() => ({ from: null, to: null, rate: null })}
                empty={t('One rate for every quantity. Add tiers when the rate steps up with volume.')}
                columns={[
                  { key: 'from', label: t('From quantity'), render: (r, s) => <CellNum value={r.from} onChange={(v) => s({ from: v })} /> },
                  { key: 'to', label: t('To quantity'), render: (r, s) => <CellNum value={r.to} onChange={(v) => s({ to: v })} /> },
                  { key: 'rate', label: t('Rate %'), render: (r, s) => <CellNum value={r.rate} onChange={(v) => s({ rate: v })} /> },
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <NumField label={t('Flat fee')} value={d.flat_fee} onChange={(v) => set('flat_fee', v)} suffix={d.currency} />
                <NumField label={t('Advance')} value={d.advance} onChange={(v) => set('advance', v)} suffix={d.currency} />
                <NumField label={t('Minimum guarantee (MG)')} value={d.minimum_guarantee} onChange={(v) => set('minimum_guarantee', v)} suffix={d.currency} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Switch checked={d.mg_recoupable} onCheckedChange={(v) => set('mg_recoupable', v)} label={t('MG and advance are recoupable against royalties')} />
                <Switch checked={d.cross_collateral} onCheckedChange={(v) => set('cross_collateral', v)} label={t('Cross-collateralized with other agreements')} />
              </div>
              <RowsEditor<PayRow>
                label={t('Payment schedule')}
                rows={d.payment_schedule}
                onChange={(rows) => set('payment_schedule', rows)}
                blank={() => ({ date: '', amount: null, label: '' })}
                empty={t('No scheduled payments. Each row becomes a payment deadline.')}
                columns={[
                  { key: 'date', label: t('Date'), render: (r, s) => <CellDate value={r.date} onChange={(v) => s({ date: v })} /> },
                  { key: 'amount', label: t('Amount'), render: (r, s) => <CellNum value={r.amount} onChange={(v) => s({ amount: v })} /> },
                  { key: 'label', label: t('Label|row'), className: 'sm:min-w-[12rem]', render: (r, s) => <CellText value={r.label} onChange={(v) => s({ label: v })} placeholder={t('For example: MG first instalment')} /> },
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Select label={t('Reporting')} value={d.reporting_frequency} placeholder={t('Not set')} options={opts('agreements.reporting_frequency')} onChange={(e) => set('reporting_frequency', e.target.value)} />
                <NumField label={t('Report due (days after period)')} value={d.report_due_days} onChange={(v) => set('report_due_days', v)} />
                <NumField label={t('Late interest')} value={d.late_interest_pct} onChange={(v) => set('late_interest_pct', v)} suffix={t('% a year')} />
                <NumField label={t('Audit threshold')} value={d.audit_threshold_pct} onChange={(v) => set('audit_threshold_pct', v)} suffix="%" help={t('Underpayment above this shifts the audit cost to the licensee.')} />
              </div>
            </>
          )}

          {group === 'licensing' && (
            <>
              <RowsEditor<StageRow>
                label={t('Approval stages (overrides the default)')}
                rows={d.approval_stages}
                onChange={(rows) => set('approval_stages', rows)}
                blank={() => ({ key: '', sla_days: null, reviewers: ['internal'] })}
                empty={t('The organization default stages apply.')}
                columns={[
                  {
                    key: 'key',
                    label: t('Stage|approval'),
                    render: (r, s) => <CellSelect value={r.key} placeholder={t('Choose')} options={STAGE_KEYS.map((k) => ({ value: k, label: enumLabel('approvals.stage', k) }))} onChange={(v) => s({ key: v })} />,
                  },
                  { key: 'sla', label: t('Days to answer'), className: 'sm:max-w-[8rem]', render: (r, s) => <CellNum value={r.sla_days} onChange={(v) => s({ sla_days: v })} /> },
                  {
                    key: 'reviewers',
                    label: t('Who reviews|approval'),
                    className: 'basis-full',
                    render: (r, s) => (
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {REVIEWER_KINDS.map((k) => (
                          <Checkbox key={k} checked={r.reviewers.includes(k)} label={reviewerLabel(k)} onChange={(v) => s({ reviewers: v ? [...r.reviewers, k] : r.reviewers.filter((x) => x !== k) })} />
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <NumField label={t('Approval answer time (business days)')} value={d.approval_sla_days} onChange={(v) => set('approval_sla_days', v)} />
                <Select label={t('If nobody answers in time')} value={d.approval_timeout} placeholder={t('Not set')} options={opts('agreements.approval_timeout')} onChange={(e) => set('approval_timeout', e.target.value)} />
                <NumField label={t('Samples owed')} value={d.samples_owed} onChange={(v) => set('samples_owed', v)} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Switch checked={d.original_approval_required} onCheckedChange={(v) => set('original_approval_required', v)} label={t('Original author side must approve')} />
                <Switch checked={d.talent_approval_required} onCheckedChange={(v) => set('talent_approval_required', v)} label={t('Talent must approve')} />
                <Switch checked={d.sublicense_allowed} onCheckedChange={(v) => set('sublicense_allowed', v)} label={t('Sublicensing allowed')} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={t('© notice to print')} value={d.copyright_notice} onChange={(e) => set('copyright_notice', e.target.value)} placeholder={t('For example: ©Author/Publisher, Project Committee')} />
                <Input label={t('Style guide version')} value={d.style_guide_version} onChange={(e) => set('style_guide_version', e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumField label={t('Sell-off period (days)')} value={d.sell_off_days} onChange={(v) => set('sell_off_days', v)} />
                <div className="flex items-end pb-2">
                  <Switch checked={d.sell_off_on_expiry_only} onCheckedChange={(v) => set('sell_off_on_expiry_only', v)} label={t('Only on natural expiry, not on termination')} />
                </div>
              </div>
            </>
          )}

          {group === 'term' && (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Switch checked={d.perpetual} onCheckedChange={(v) => set('perpetual', v)} label={t('No end date')} />
                <Switch checked={d.auto_renew} onCheckedChange={(v) => set('auto_renew', v)} label={t('Renews automatically')} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumField label={t('Renewal notice (days)')} value={d.renewal_notice_days} onChange={(v) => set('renewal_notice_days', v)} help={d.auto_renew ? t('Days before the end to stop the renewal.') : t('Days before the end to ask for a renewal.')} />
                <DateField label={t('Option period ends')} value={d.option_period_end} onChange={(v) => set('option_period_end', v)} />
                <NumField label={t('Option extension fee')} value={d.option_extension_fee} onChange={(v) => set('option_extension_fee', v)} suffix={d.currency} />
                <DateField label={t('Rights revert on')} value={d.reversion_date} onChange={(v) => set('reversion_date', v)} />
                <DateField label={t('Completion or release deadline')} value={d.completion_deadline} onChange={(v) => set('completion_deadline', v)} />
                <DateField label={t('Sequel first negotiation ends')} value={d.sequel_negotiation_end} onChange={(v) => set('sequel_negotiation_end', v)} />
              </div>
              <RowsEditor<DelRow>
                label={t('Delivery schedule')}
                rows={d.delivery_schedule}
                onChange={(rows) => set('delivery_schedule', rows)}
                blank={() => ({ date: '', label: '' })}
                empty={t('No deliveries scheduled. Each row becomes a delivery deadline.')}
                columns={[
                  { key: 'date', label: t('Date'), render: (r, s) => <CellDate value={r.date} onChange={(v) => s({ date: v })} /> },
                  { key: 'label', label: t('What is delivered'), className: 'sm:min-w-[14rem]', render: (r, s) => <CellText value={r.label} onChange={(v) => s({ label: v })} placeholder={t('For example: final master, episodes 1 to 6')} /> },
                ]}
              />
            </>
          )}

          {group === 'creator' && (
            <>
              <div className="flex flex-col gap-2">
                <Switch checked={d.author_grant} onCheckedChange={(v) => set('author_grant', v)} label={t('Grant by an individual author (US termination rights apply)')} />
                <Switch checked={d.art27_28} onCheckedChange={(v) => set('art27_28', v)} label={t('Assignment names Articles 27 and 28 (adaptation rights)')} />
                <Switch checked={d.moral_rights_waiver} onCheckedChange={(v) => set('moral_rights_waiver', v)} label={t('Creator agrees not to exercise moral rights')} />
              </div>
              {!d.art27_28 && (d.agreement_type === 'creator_commission' || d.agreement_type === 'assignment') && (
                <Notice tone="warn">{t('Without Articles 27 and 28 named, adaptation rights are presumed to stay with the creator (Art. 61(2)).')}</Notice>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <NumField label={t('Payment due (days after delivery)')} value={d.payment_due_days} onChange={(v) => set('payment_due_days', v)} />
              </div>
              {d.payment_due_days !== null && d.payment_due_days > 60 && (
                <Notice tone="warn">{t('More than 60 days. The Freelance Act requires payment within 60 days of delivery for individual creators.')}</Notice>
              )}
            </>
          )}

          {group === 'talent' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label={t('Stage name')} value={d.stage_name_clause} placeholder={t('Not set')} options={opts('agreements.stage_name_clause')} onChange={(e) => set('stage_name_clause', e.target.value)} />
                <div className="flex items-end pb-2">
                  <Switch checked={d.non_compete} onCheckedChange={(v) => set('non_compete', v)} label={t('Non-compete after the term')} />
                </div>
              </div>
              <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
                <span className="text-[13px] font-medium">{t('After the term')}</span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={t('Archives (streams and videos)')} value={d.post_term.archives} onChange={(e) => set('post_term', { ...d.post_term, archives: e.target.value })} placeholder={t('For example: stay public, no new monetization')} />
                  <NumField label={t('Merchandise sell-off (days)')} value={d.post_term.merch_sell_off_days} onChange={(v) => set('post_term', { ...d.post_term, merch_sell_off_days: v })} />
                  <Input label={t('Music')} value={d.post_term.music} onChange={(e) => set('post_term', { ...d.post_term, music: e.target.value })} />
                  <Input label={t('Voice|post term')} value={d.post_term.voice} onChange={(e) => set('post_term', { ...d.post_term, voice: e.target.value })} />
                </div>
                <Textarea label={t('Other notes')} rows={2} value={d.post_term.notes} onChange={(e) => set('post_term', { ...d.post_term, notes: e.target.value })} />
              </div>
              <RowsEditor<ShareRow>
                label={t('Revenue share')}
                rows={d.revenue_share}
                onChange={(rows) => set('revenue_share', rows)}
                blank={() => ({ category: '', pct: null })}
                empty={t('No revenue share recorded.')}
                columns={[
                  { key: 'category', label: t('Revenue type'), className: 'sm:min-w-[12rem]', render: (r, s) => <CellText value={r.category} onChange={(v) => s({ category: v })} placeholder={t('For example: super chat, merchandise')} /> },
                  { key: 'pct', label: t('Talent share %'), render: (r, s) => <CellNum value={r.pct} onChange={(v) => s({ pct: v })} /> },
                ]}
              />
            </>
          )}

          {group === 'other' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={t('Governing law')} value={d.governing_law} onChange={(e) => set('governing_law', e.target.value)} placeholder={t('For example: Japan, Tokyo District Court')} />
                <Input label={t('Territory in words')} value={d.territory_summary} onChange={(e) => set('territory_summary', e.target.value)} />
              </div>
              <Textarea label={t('Summary')} rows={4} value={d.summary} onChange={(e) => set('summary', e.target.value)} />
              <Textarea label={t('Notes')} rows={4} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* From a contract                                                     */
/* ------------------------------------------------------------------ */

export function ContractReadDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { me } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const submit = async (): Promise<void> => {
    if (file === null) {
      toast.error(t('Choose a file first.'));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', file.name.replace(/\.[^.]+$/, '') || file.name);
      fd.append('doc_type', 'contract');
      fd.append('doc_date', toPb(today()));
      fd.append('source', 'upload');
      if (me !== null) fd.append('uploaded_by', me.id);
      const doc = await createRecord<DocumentRec>('documents', fd);
      const id = await handToCraftBot('agreement_extraction_requested', { document_id: doc.id });
      if (id !== null) setRequestId(id);
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
      title={t('From a contract')}
      description={t('Upload the contract. CraftBot reads it and proposes the agreement, its grants and obligations in the Inbox for you to review.')}
      className="w-[min(94vw,34rem)]"
      footer={
        requestId === null ? (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={file === null}>
              <Bot size={14} aria-hidden /> {t('Upload and read')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('Close')}</Button>
        )
      }
    >
      {requestId === null ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') input.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) setFile(f);
          }}
          className={cn('flex flex-col items-center gap-1.5 border border-dashed px-4 py-8 text-center text-[13px]', drag ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]')}
        >
          <Upload size={18} className="text-[var(--agent-app-muted)]" aria-hidden />
          {file !== null ? <span className="break-all font-medium">{file.name}</span> : <span>{t('Drop the contract here or click to choose (PDF, image, Word)')}</span>}
          <input
            ref={input}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AgentStatus requestId={requestId} workingText={t('CraftBot is reading the contract...')} doneText={t('CraftBot filed a proposal in the Inbox.')} />
          <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{t('Nothing is created until a person accepts the proposal in the Inbox. You can close this window.')}</p>
          <a href={href('inbox')} onClick={onClose} className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline">
            {t('Open the Inbox')}
          </a>
        </div>
      )}
    </Dialog>
  );
}
