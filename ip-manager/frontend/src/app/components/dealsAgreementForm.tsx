/**
 * Create or edit an agreement: basics, term, option, money, author grant
 * and notes. Saving lets the server turn the dates into obligation
 * deadlines (option end, notice, payments, royalty reports, sell-off).
 */
import { useState } from 'react';
import { Plus, Trash2, UserPlus, X } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { AGREEMENT_TYPE_LABEL, CURRENCIES, DIRECTION_LABEL } from '../lib/labels.ts';
import type { AgreementRec, AgreementType, PartyRec } from '../lib/types.ts';
import { RecordPicker, UserSelect } from './pickers.tsx';
import { Field, Notice, Segmented } from './ui.tsx';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_STATUS_LABEL,
  DateField,
  EXCLUSIVITY_LABEL,
  FormSection,
  NumberField,
  REPORTING_LABEL,
  num,
  numStr,
} from './dealsShared.tsx';
import type { AgreementStatus } from './dealsShared.tsx';

const PARTY_SEARCH = ['name', 'organization', 'email'];
const partyLabel = (p: PartyRec): string => (p.organization !== '' && p.kind === 'person' ? `${p.name} (${p.organization})` : p.name);

const TYPE_OPTIONS = Object.entries(AGREEMENT_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const DIRECTION_OPTIONS = Object.entries(DIRECTION_LABEL).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = AGREEMENT_STATUSES.map((s) => ({ value: s, label: AGREEMENT_STATUS_LABEL[s] }));
const EXCLUSIVITY_OPTIONS = Object.entries(EXCLUSIVITY_LABEL).map(([value, label]) => ({ value, label }));
const REPORTING_OPTIONS = Object.entries(REPORTING_LABEL).map(([value, label]) => ({ value, label }));

interface PayRow {
  key: string;
  date: string;
  amount: string;
  label: string;
}

interface Draft {
  title: string;
  agreement_type: AgreementType;
  direction: AgreementRec['direction'];
  status: AgreementStatus;
  counterparty: string;
  our_entity: string;
  property: string;
  responsible: string;
  signed_date: string;
  effective_date: string;
  term_start: string;
  term_end: string;
  perpetual: boolean;
  auto_renew: boolean;
  renewal_notice_days: string;
  exclusivity: string;
  territory_summary: string;
  governing_law: string;
  reversion_date: string;
  sell_off_days: string;
  option_period_end: string;
  option_extension_fee: string;
  currency: string;
  royalty_rate: string;
  royalty_basis: string;
  flat_fee: string;
  advance: string;
  minimum_guarantee: string;
  reporting_frequency: string;
  report_due_days: string;
  payments: PayRow[];
  author_grant: boolean;
  covers_publication: boolean;
  summary: string;
  notes: string;
}

let rowSeq = 0;
function rowKey(): string {
  rowSeq += 1;
  return `pay-${rowSeq}`;
}

function fromRecord(a: AgreementRec | null, homeCurrency: string, me: string): Draft {
  return {
    title: a?.title ?? '',
    agreement_type: a?.agreement_type ?? 'license_out',
    direction: a?.direction ?? 'out',
    status: a?.status ?? 'draft',
    counterparty: a?.counterparty ?? '',
    our_entity: a?.our_entity ?? '',
    property: a?.property ?? '',
    responsible: a?.responsible ?? me,
    signed_date: d10(a?.signed_date),
    effective_date: d10(a?.effective_date),
    term_start: d10(a?.term_start),
    term_end: d10(a?.term_end),
    perpetual: a?.perpetual ?? false,
    auto_renew: a?.auto_renew ?? false,
    renewal_notice_days: numStr(a?.renewal_notice_days),
    exclusivity: a?.exclusivity ?? '',
    territory_summary: a?.territory_summary ?? '',
    governing_law: a?.governing_law ?? '',
    reversion_date: d10(a?.reversion_date),
    sell_off_days: numStr(a?.sell_off_days),
    option_period_end: d10(a?.option_period_end),
    option_extension_fee: numStr(a?.option_extension_fee),
    currency: (a?.currency ?? '') !== '' ? (a?.currency ?? homeCurrency).toUpperCase() : homeCurrency,
    royalty_rate: numStr(a?.royalty_rate),
    royalty_basis: a?.royalty_basis ?? '',
    flat_fee: numStr(a?.flat_fee),
    advance: numStr(a?.advance),
    minimum_guarantee: numStr(a?.minimum_guarantee),
    reporting_frequency: a?.reporting_frequency ?? '',
    report_due_days: numStr(a?.report_due_days),
    payments: (a?.payment_schedule ?? []).map((p) => ({ key: rowKey(), date: d10(p.date), amount: numStr(p.amount), label: p.label ?? '' })),
    author_grant: a?.author_grant ?? false,
    covers_publication: a?.covers_publication ?? false,
    summary: a?.summary ?? '',
    notes: a?.notes ?? '',
  };
}

/** Party role implied by the deal direction (who the counterparty is to us). */
function roleFor(direction: string): string {
  if (direction === 'in') return 'licensor';
  if (direction === 'out') return 'licensee';
  return 'other';
}

export function AgreementForm({
  agreement,
  onClose,
  onSaved,
}: {
  agreement?: AgreementRec | null | undefined;
  onClose: () => void;
  onSaved?: ((a: AgreementRec) => void) | undefined;
}): React.JSX.Element {
  const { homeCurrency, properties, vocab, me } = useApp();
  const editing = agreement !== undefined && agreement !== null;
  const [d, setD] = useState<Draft>(() => fromRecord(agreement ?? null, homeCurrency, editing ? '' : (me?.id ?? '')));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [party, setParty] = useState<{ name: string; kind: 'organization' | 'person' } | null>(null);
  const [partyBusy, setPartyBusy] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setD((p) => ({ ...p, [k]: v }));
  const setRow = (key: string, patch: Partial<PayRow>): void =>
    setD((p) => ({ ...p, payments: p.payments.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  const currencies = CURRENCIES.includes(d.currency) || d.currency === '' ? CURRENCIES : [d.currency, ...CURRENCIES];

  const createParty = async (): Promise<void> => {
    if (party === null || party.name.trim() === '') {
      toast.error('Enter the name of the person or company.');
      return;
    }
    setPartyBusy(true);
    try {
      const rec = await createRecord<PartyRec>('parties', { name: party.name.trim(), kind: party.kind, roles: [roleFor(d.direction)] });
      set('counterparty', rec.id);
      setParty(null);
      toast.success(`Added ${rec.name}`);
    } catch {
      /* toast shown by the client */
    } finally {
      setPartyBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    const errs: Record<string, string> = {};
    if (d.title.trim() === '') errs['title'] = 'Give the agreement a title.';
    if (!d.perpetual && d.term_start !== '' && d.term_end !== '' && d.term_end <= d.term_start) errs['term_end'] = 'The term must end after it starts.';
    const rows = d.payments.filter((r) => r.date !== '' || r.amount !== '' || r.label.trim() !== '');
    if (rows.some((r) => r.date === '')) errs['payments'] = 'Every payment needs a date.';
    setErrors(errs);
    const first = Object.values(errs)[0];
    if (first !== undefined) {
      toast.error(first);
      return;
    }
    const payload: Record<string, unknown> = {
      title: d.title.trim(),
      agreement_type: d.agreement_type,
      direction: d.direction,
      status: d.status,
      counterparty: d.counterparty,
      our_entity: d.our_entity.trim(),
      property: d.property,
      responsible: d.responsible,
      signed_date: toPb(d.signed_date),
      effective_date: toPb(d.effective_date),
      term_start: toPb(d.term_start),
      term_end: d.perpetual ? '' : toPb(d.term_end),
      perpetual: d.perpetual,
      auto_renew: d.auto_renew,
      renewal_notice_days: num(d.renewal_notice_days),
      exclusivity: d.exclusivity,
      territory_summary: d.territory_summary.trim(),
      governing_law: d.governing_law.trim(),
      reversion_date: toPb(d.reversion_date),
      sell_off_days: num(d.sell_off_days),
      option_period_end: toPb(d.option_period_end),
      option_extension_fee: num(d.option_extension_fee),
      currency: d.currency,
      royalty_rate: num(d.royalty_rate),
      royalty_basis: d.royalty_basis.trim(),
      flat_fee: num(d.flat_fee),
      advance: num(d.advance),
      minimum_guarantee: num(d.minimum_guarantee),
      reporting_frequency: d.reporting_frequency,
      report_due_days: num(d.report_due_days),
      payment_schedule: rows
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ date: r.date, amount: num(r.amount), label: r.label.trim() })),
      author_grant: d.author_grant,
      covers_publication: d.author_grant ? d.covers_publication : false,
      summary: d.summary.trim(),
      notes: d.notes,
    };
    setBusy(true);
    try {
      const rec = editing
        ? await updateRecord<AgreementRec>('agreements', agreement.id, payload)
        : await createRecord<AgreementRec>('agreements', payload);
      toast.success('Saved. Obligation deadlines updated.');
      onSaved?.(rec);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  const reporting = d.reporting_frequency !== '' && d.reporting_frequency !== 'none';

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? `Edit ${agreement.ref || 'agreement'}` : 'New agreement'}
      description="Dates you enter here become deadlines automatically: option end, notice periods, payments, royalty reports, sell-off and reversion."
      className="w-[min(96vw,52rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {editing ? 'Save changes' : 'Create agreement'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[68vh] flex-col gap-5 overflow-y-auto pr-1">
        <FormSection title="Basics">
          <Input
            label="Title"
            value={d.title}
            autoFocus={!editing}
            placeholder="For example: Starfall plush licence, Kaito Toys"
            error={errors['title']}
            onChange={(e) => set('title', e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Type" value={d.agreement_type} options={TYPE_OPTIONS} onChange={(e) => set('agreement_type', e.target.value as AgreementType)} />
            <Field label="Direction" help="Rights in: you receive rights (acquisitions, options, licences in). Rights out: you grant rights to someone else.">
              <Select value={d.direction} options={DIRECTION_OPTIONS} onChange={(e) => set('direction', e.target.value as AgreementRec['direction'])} />
            </Field>
            <Select label="Status" value={d.status} options={STATUS_OPTIONS} onChange={(e) => set('status', e.target.value as AgreementStatus)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <RecordPicker<PartyRec>
                collection="parties"
                label="Counterparty"
                value={d.counterparty}
                onChange={(id) => set('counterparty', id)}
                labelOf={partyLabel}
                searchFields={PARTY_SEARCH}
                placeholder="Search people and companies"
              />
              {party === null ? (
                <button
                  type="button"
                  className="inline-flex w-fit items-center gap-1 text-xs font-medium text-[var(--agent-app-accent)] hover:underline"
                  onClick={() => setParty({ name: '', kind: 'organization' })}
                >
                  <UserPlus size={12} aria-hidden /> New person or company
                </button>
              ) : (
                <div className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Segmented
                      size="sm"
                      value={party.kind}
                      options={[
                        { value: 'organization', label: 'Company' },
                        { value: 'person', label: 'Person' },
                      ]}
                      onChange={(v) => setParty({ ...party, kind: v })}
                      ariaLabel="Kind"
                    />
                    <button type="button" aria-label="Cancel new counterparty" className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" onClick={() => setParty(null)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Name"
                      value={party.name}
                      autoFocus
                      placeholder={party.kind === 'person' ? 'Full name' : 'Company name'}
                      onChange={(e) => setParty({ ...party, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createParty();
                        }
                      }}
                    />
                    <Button size="sm" className="h-9 shrink-0" loading={partyBusy} onClick={() => void createParty()}>
                      Add
                    </Button>
                  </div>
                  <p className="text-[11px] text-[var(--agent-app-muted)]">Added to People as a {roleFor(d.direction)}. Contact details can be filled in there.</p>
                </div>
              )}
            </div>
            <Input label="Our contracting entity" value={d.our_entity} placeholder="For example: Lantern Bay Studios LLC" onChange={(e) => set('our_entity', e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={vocab.property}
              value={d.property}
              placeholder="None"
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(e) => set('property', e.target.value)}
            />
            <UserSelect label="Responsible" value={d.responsible} onChange={(id) => set('responsible', id)} />
          </div>
        </FormSection>

        <FormSection title="Term" help="Leave a date empty when the agreement does not say. Obligation deadlines are only created for dates that are filled in.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DateField label="Signed" value={d.signed_date} onChange={(v) => set('signed_date', v)} />
            <DateField label="Effective" value={d.effective_date} onChange={(v) => set('effective_date', v)} />
            <DateField label="Term start" value={d.term_start} onChange={(v) => set('term_start', v)} />
            <DateField label="Term end" value={d.perpetual ? '' : d.term_end} disabled={d.perpetual} error={errors['term_end']} onChange={(v) => set('term_end', v)} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Switch checked={d.perpetual} onCheckedChange={(v) => set('perpetual', v)} label="Perpetual (no end date)" />
            <Switch checked={d.auto_renew} onCheckedChange={(v) => set('auto_renew', v)} label="Renews automatically" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Renewal notice"
              value={d.renewal_notice_days}
              suffix="days"
              help={d.auto_renew ? 'Notice needed to stop the renewal.' : 'Notice needed to renew.'}
              onChange={(v) => set('renewal_notice_days', v)}
            />
            <Select label="Exclusivity" value={d.exclusivity} placeholder="Not set" options={EXCLUSIVITY_OPTIONS} onChange={(e) => set('exclusivity', e.target.value)} />
            <DateField label="Reversion date" value={d.reversion_date} help="When the rights come back." onChange={(v) => set('reversion_date', v)} />
            <NumberField label="Sell-off period" value={d.sell_off_days} suffix="days" help="After the term ends." onChange={(v) => set('sell_off_days', v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Territory in words" value={d.territory_summary} placeholder="For example: North America excluding Quebec" onChange={(e) => set('territory_summary', e.target.value)} />
            <Input label="Governing law" value={d.governing_law} placeholder="For example: State of California" onChange={(e) => set('governing_law', e.target.value)} />
          </div>
        </FormSection>

        <FormSection title="Option" help="For options: the date by which the option must be exercised or extended, and the fee to extend it.">
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField label="Option period ends" value={d.option_period_end} onChange={(v) => set('option_period_end', v)} />
            <NumberField label="Extension fee" value={d.option_extension_fee} suffix={d.currency} onChange={(v) => set('option_extension_fee', v)} />
          </div>
        </FormSection>

        <FormSection title="Money">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Currency" value={d.currency} options={currencies.map((c) => ({ value: c, label: c }))} onChange={(e) => set('currency', e.target.value)} />
            <NumberField label="Royalty rate" value={d.royalty_rate} suffix="%" step="0.01" onChange={(v) => set('royalty_rate', v)} />
            <Input label="Royalty basis" value={d.royalty_basis} placeholder="For example: net wholesale price" onChange={(e) => set('royalty_basis', e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField label="Flat fee" value={d.flat_fee} suffix={d.currency} onChange={(v) => set('flat_fee', v)} />
            <NumberField label="Advance" value={d.advance} suffix={d.currency} onChange={(v) => set('advance', v)} />
            <NumberField label="Minimum guarantee" value={d.minimum_guarantee} suffix={d.currency} onChange={(v) => set('minimum_guarantee', v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Royalty reporting" value={d.reporting_frequency} placeholder="Not set" options={REPORTING_OPTIONS} onChange={(e) => set('reporting_frequency', e.target.value)} />
            <NumberField
              label="Report due"
              value={d.report_due_days}
              suffix="days"
              placeholder={reporting ? '30' : ''}
              help="Days after each period ends. 30 when left empty."
              onChange={(v) => set('report_due_days', v)}
            />
          </div>
          <Field label="Payment schedule" error={errors['payments']} help="Each payment becomes a deadline on its date.">
            <div className="flex flex-col gap-2">
              {d.payments.map((r) => (
                <div key={r.key} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-2">
                  <input
                    type="date"
                    aria-label="Payment date"
                    className="h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm"
                    value={r.date}
                    onChange={(e) => setRow(r.key, { date: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    aria-label="Amount"
                    placeholder={`Amount (${d.currency})`}
                    className="h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm tabular-nums"
                    value={r.amount}
                    onChange={(e) => setRow(r.key, { amount: e.target.value })}
                  />
                  <input
                    aria-label="What the payment is for"
                    placeholder="For example: Signing payment"
                    className="h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm"
                    value={r.label}
                    onChange={(e) => setRow(r.key, { label: e.target.value })}
                  />
                  <button
                    type="button"
                    aria-label="Remove payment"
                    className="flex size-8 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600"
                    onClick={() => set('payments', d.payments.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => set('payments', [...d.payments, { key: rowKey(), date: '', amount: '', label: '' }])}
              >
                <Plus size={13} aria-hidden /> Add a payment
              </Button>
            </div>
          </Field>
        </FormSection>

        <FormSection title="Author grant">
          <Switch
            checked={d.author_grant}
            onCheckedChange={(v) => set('author_grant', v)}
            label="An individual author granted these rights (US Section 203 termination windows apply)"
          />
          {d.author_grant && (
            <>
              <Switch
                checked={d.covers_publication}
                onCheckedChange={(v) => set('covers_publication', v)}
                label="The grant covers the right of publication"
              />
              <Notice>
                The author (or heirs) may terminate the grant during a five-year window that opens 35 years after it was signed. When the grant covers publication, the window opens at the earlier of 35 years after publication or 40 years after signing. The signed date drives these deadlines, so fill it in above.
              </Notice>
            </>
          )}
        </FormSection>

        <FormSection title="Summary and notes">
          <Textarea label="Summary" rows={3} value={d.summary} placeholder="The deal in two or three sentences" onChange={(e) => set('summary', e.target.value)} />
          <Textarea label="Notes" rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </FormSection>
      </div>
    </Dialog>
  );
}
