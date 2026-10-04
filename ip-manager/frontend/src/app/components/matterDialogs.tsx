/**
 * Dialogs for matters and families: new matter (see matterNew.tsx), edit,
 * national phase and related filings, a manual deadline, the goods and
 * services editor (matterGoods.tsx), and editing a family or mark.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, TagInput, Textarea, toast } from '../../kit/index.ts';
import { createRecord, errText, fileUrl, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, plural, toPb, today } from '../lib/format.ts';
import {
  CATEGORY_LABEL,
  KIND_HELP,
  KIND_LABEL,
  MARK_TYPE_LABEL,
  RELATION_LABEL,
  ROUTE_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  jurisdictionName,
} from '../lib/labels.ts';
import type { Category, DeadlineKind, DeadlineRec, FamilyRec, MatterRec, MatterStatus, PriorityClaim, WorkRec } from '../lib/types.ts';
import { JurisdictionChips, JurisdictionSelect, RecordPicker, UserSelect } from './pickers.tsx';
import {
  ENTITY_SIZE_LABEL,
  FAMILY_KIND_LABEL,
  STRATEGY_LABEL,
  TM_BASIS_LABEL,
  TM_REGISTER_LABEL,
  DateField,
  PriorityClaimsEditor,
  cleanClaims,
  familyKindOf,
  htmlToText,
  isPatentLike,
  toOptions,
} from './matterShared.tsx';
import { Field, JurChip, Notice, Segmented } from './ui.tsx';

export { NewMatterDialog } from './matterNew.tsx';
export type { NewMatterDefaults, NewMatterDialogProps } from './matterNew.tsx';
export { GoodsServicesEditor } from './matterGoods.tsx';

function FormHeading({ children }: { children: ReactNode }): React.JSX.Element {
  return <h4 className="border-b border-[var(--agent-app-border)] pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h4>;
}

function numOrZero(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/* ------------------------------------------------------------------ */
/* Edit a matter                                                       */
/* ------------------------------------------------------------------ */

interface EditForm {
  title: string;
  jurisdiction: string;
  route: string;
  relation: string;
  status: MatterStatus;
  office_status: string;
  application_no: string;
  filing_date: string;
  publication_no: string;
  publication_date: string;
  registration_no: string;
  registration_date: string;
  expiry_override: boolean;
  expiry_date: string;
  priority_claims: PriorityClaim[];
  pta_days: string;
  property: string;
  family: string;
  work: string;
  owner_of_record: string;
  applicants: string;
  counsel: string;
  client_ref: string;
  cost_center: string;
  entity_size: string;
  tm_register: string;
  tm_basis: string;
  jp_split_fee: boolean;
  responsible: string;
  docketer: string;
  abstract: string;
  claims_count: string;
  independent_claims: string;
  sync_enabled: boolean;
  notes: string;
}

function formOf(m: MatterRec): EditForm {
  const opts = m.options ?? {};
  return {
    title: m.title,
    jurisdiction: m.jurisdiction,
    route: m.route,
    relation: m.relation,
    status: m.status,
    office_status: m.office_status,
    application_no: m.application_no,
    filing_date: d10(m.filing_date),
    publication_no: m.publication_no,
    publication_date: d10(m.publication_date),
    registration_no: m.registration_no,
    registration_date: d10(m.registration_date),
    expiry_override: m.expiry_override,
    expiry_date: d10(m.expiry_date),
    priority_claims: (m.priority_claims ?? []).map((p) => ({ country: p.country, number: p.number, date: d10(p.date) })),
    pta_days: m.pta_days > 0 ? String(m.pta_days) : '',
    property: m.property,
    family: m.family,
    work: m.work,
    owner_of_record: m.owner_of_record,
    applicants: m.applicants,
    counsel: m.counsel,
    client_ref: m.client_ref,
    cost_center: m.cost_center,
    entity_size: m.entity_size,
    tm_register: m.tm_register,
    tm_basis: m.tm_basis,
    jp_split_fee: opts['jp_split_fee'] === true,
    responsible: m.responsible,
    docketer: m.docketer,
    abstract: m.abstract,
    claims_count: m.claims_count > 0 ? String(m.claims_count) : '',
    independent_claims: m.independent_claims > 0 ? String(m.independent_claims) : '',
    sync_enabled: m.sync_enabled,
    notes: htmlToText(m.notes),
  };
}

function claimsKey(claims: PriorityClaim[] | null): string {
  return JSON.stringify(cleanClaims(claims ?? []));
}

export function MatterEditDialog(props: {
  matter: MatterRec;
  onClose: () => void;
  /** baseChanged: a date or setting the rules use changed, so offer to recalculate. */
  onSaved?: ((baseChanged: boolean) => void) | undefined;
  /** Why the expiry is what it is (from matters/info). */
  expiryText?: string | undefined;
  open?: boolean | undefined;
}): React.JSX.Element | null {
  if (props.open === false) return null;
  return <MatterEditInner {...props} />;
}

function MatterEditInner({
  matter,
  onClose,
  onSaved,
  expiryText,
}: {
  matter: MatterRec;
  onClose: () => void;
  onSaved?: ((baseChanged: boolean) => void) | undefined;
  expiryText?: string | undefined;
}): React.JSX.Element {
  const { settings, properties, vocab } = useApp();
  const preferred = settings?.jurisdictions ?? [];
  const [f, setF] = useState<EditForm>(() => formOf(matter));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EditForm>): void => setF((x) => ({ ...x, ...patch }));
  const t = matter.ip_type;
  const tm = t === 'trademark';
  const patentLike = isPatentLike(t);
  const fk = familyKindOf(t);
  const us = f.jurisdiction === 'US';
  const jpTm = tm && f.jurisdiction === 'JP';

  const save = async (): Promise<void> => {
    if (f.title.trim() === '') {
      toast.error(tm ? 'Enter the mark.' : 'Enter a title.');
      return;
    }
    if (f.jurisdiction === '') {
      toast.error('Choose the office or country.');
      return;
    }
    if (f.expiry_override && f.expiry_date === '') {
      toast.error('Enter the expiry date, or turn off Set expiry by hand.');
      return;
    }
    const data: Record<string, unknown> = {
      title: f.title.trim(),
      jurisdiction: f.jurisdiction.toUpperCase(),
      route: f.route,
      relation: f.relation,
      status: f.status,
      office_status: f.office_status.trim(),
      application_no: f.application_no.trim(),
      filing_date: toPb(f.filing_date),
      publication_no: f.publication_no.trim(),
      publication_date: toPb(f.publication_date),
      registration_no: f.registration_no.trim(),
      registration_date: toPb(f.registration_date),
      expiry_override: f.expiry_override,
      priority_claims: cleanClaims(f.priority_claims),
      property: f.property,
      family: f.family,
      owner_of_record: f.owner_of_record.trim(),
      applicants: f.applicants.trim(),
      counsel: f.counsel.trim(),
      client_ref: f.client_ref.trim(),
      cost_center: f.cost_center.trim(),
      responsible: f.responsible,
      docketer: f.docketer,
      sync_enabled: f.sync_enabled,
      notes: f.notes,
    };
    if (f.expiry_override) data['expiry_date'] = toPb(f.expiry_date);
    if (t === 'copyright') data['work'] = f.work;
    if (patentLike) {
      data['pta_days'] = numOrZero(f.pta_days);
      data['entity_size'] = f.entity_size;
      data['claims_count'] = numOrZero(f.claims_count);
      data['independent_claims'] = numOrZero(f.independent_claims);
    }
    if (patentLike || t === 'design') data['abstract'] = f.abstract;
    if (tm) {
      data['tm_register'] = f.tm_register;
      data['tm_basis'] = f.tm_basis;
    }
    if (jpTm) data['options'] = { ...(matter.options ?? {}), jp_split_fee: f.jp_split_fee };

    const before = formOf(matter);
    const baseChanged =
      before.filing_date !== f.filing_date ||
      before.publication_date !== f.publication_date ||
      before.registration_date !== f.registration_date ||
      claimsKey(matter.priority_claims) !== claimsKey(f.priority_claims) ||
      numOrZero(before.pta_days) !== numOrZero(f.pta_days) ||
      before.jurisdiction !== f.jurisdiction ||
      before.route !== f.route;

    setBusy(true);
    try {
      await updateRecord<MatterRec>('matters', matter.id, data);
      toast.success(`${matter.ref} saved`);
      onClose();
      onSaved?.(baseChanged);
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
      title={`Edit ${matter.ref}`}
      description="Changing a filing, publication, registration or priority date offers to move the deadlines that depend on it."
      className="w-[min(96vw,48rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex max-h-[66vh] flex-col gap-5 overflow-y-auto pr-1">
        <section className="flex flex-col gap-3">
          <FormHeading>The right</FormHeading>
          <Input label={tm ? 'Mark' : 'Title'} value={f.title} onChange={(e) => set({ title: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <JurisdictionSelect label="Office or country" value={f.jurisdiction} preferred={preferred} onChange={(v) => set({ jurisdiction: v })} />
            <Select label="Route" value={f.route} options={toOptions(ROUTE_LABEL)} onChange={(e) => set({ route: e.target.value })} />
            <Select label="Relation to the parent" value={f.relation} options={toOptions(RELATION_LABEL)} onChange={(e) => set({ relation: e.target.value })} />
            <Select
              label="Status"
              value={f.status}
              options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              onChange={(e) => set({ status: e.target.value as MatterStatus })}
            />
          </div>
          <Input
            label="Office status (as the office words it)"
            value={f.office_status}
            placeholder="For example: Non-final action mailed"
            onChange={(e) => set({ office_status: e.target.value })}
          />
          {f.status !== matter.status && (
            <p className="text-xs text-[var(--agent-app-muted)]">
              Changing the status here does not create deadlines. To record an office action, a grant or a lapse with its deadlines, use Record what happened.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <FormHeading>Numbers and dates</FormHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Application number" className="font-mono" value={f.application_no} onChange={(e) => set({ application_no: e.target.value })} />
            <DateField label="Filing date" value={f.filing_date} onChange={(v) => set({ filing_date: v })} />
            <Input label="Publication number" className="font-mono" value={f.publication_no} onChange={(e) => set({ publication_no: e.target.value })} />
            <DateField label="Publication date" value={f.publication_date} onChange={(v) => set({ publication_date: v })} />
            <Input
              label={patentLike ? 'Patent number' : 'Registration number'}
              className="font-mono"
              value={f.registration_no}
              onChange={(e) => set({ registration_no: e.target.value })}
            />
            <DateField label={patentLike ? 'Grant date' : 'Registration date'} value={f.registration_date} onChange={(v) => set({ registration_date: v })} />
            {patentLike && us && (
              <Input
                label="Patent term adjustment (days)"
                type="number"
                min={0}
                value={f.pta_days}
                onChange={(e) => set({ pta_days: e.target.value })}
              />
            )}
          </div>
          <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
            <Switch checked={f.expiry_override} onCheckedChange={(v) => set({ expiry_override: v })} label="Set expiry by hand" />
            {f.expiry_override ? (
              <div className="mt-2 max-w-xs">
                <DateField label="Expiry date" value={f.expiry_date} onChange={(v) => set({ expiry_date: v })} help="Kept as entered. Terminal disclaimers and extensions are typical reasons." />
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-[var(--agent-app-muted)]">
                Calculated{d10(matter.expiry_date) !== '' ? `: ${fmtDate(matter.expiry_date)}` : ''}. {expiryText ?? ''}
              </p>
            )}
          </div>
        </section>

        {t !== 'copyright' && (
          <section className="flex flex-col gap-3">
            <FormHeading>Priority claims</FormHeading>
            <PriorityClaimsEditor value={f.priority_claims} onChange={(v) => set({ priority_claims: v })} preferred={preferred} />
          </section>
        )}

        {tm && (us || jpTm) && (
          <section className="flex flex-col gap-3">
            <FormHeading>{us ? 'United States' : 'Japan'}</FormHeading>
            {us && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Filing basis" value={f.tm_basis} placeholder="Not set" options={toOptions(TM_BASIS_LABEL)} onChange={(e) => set({ tm_basis: e.target.value })} />
                <Select label="Register" value={f.tm_register} placeholder="Not set" options={toOptions(TM_REGISTER_LABEL)} onChange={(e) => set({ tm_register: e.target.value })} />
              </div>
            )}
            {jpTm && (
              <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
                <Switch checked={f.jp_split_fee} onCheckedChange={(v) => set({ jp_split_fee: v })} label="Registration fee paid in two 5-year halves" />
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--agent-app-muted)]">
                  When on, recording the registration creates the second-half fee deadline at 5 years. For a mark already registered, add that deadline with Add deadline.
                </p>
              </div>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <FormHeading>Where it belongs</FormHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={vocab.property}
              value={f.property}
              placeholder="None"
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(e) => set({ property: e.target.value })}
            />
            {fk !== null && (
              <RecordPicker<FamilyRec>
                collection="families"
                label={FAMILY_KIND_LABEL[fk]}
                value={f.family}
                onChange={(id) => set({ family: id })}
                labelOf={(x) => x.title}
                searchFields={['title', 'word_element']}
                filter={`kind = "${fk}"`}
              />
            )}
            {t === 'copyright' && (
              <RecordPicker<WorkRec>
                collection="works"
                label={vocab.work}
                value={f.work}
                onChange={(id) => set({ work: id })}
                labelOf={(w) => w.title}
                searchFields={['title']}
              />
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <FormHeading>Ownership and people</FormHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Owner of record" value={f.owner_of_record} onChange={(e) => set({ owner_of_record: e.target.value })} />
            <Input label="Applicants" value={f.applicants} onChange={(e) => set({ applicants: e.target.value })} />
            <Input label="Counsel" value={f.counsel} onChange={(e) => set({ counsel: e.target.value })} />
            <Input label="Client reference" className="font-mono" value={f.client_ref} onChange={(e) => set({ client_ref: e.target.value })} />
            <Input label="Cost center" value={f.cost_center} onChange={(e) => set({ cost_center: e.target.value })} />
            {patentLike && us && (
              <Select label="Entity size (USPTO fees)" value={f.entity_size} placeholder="Not set" options={toOptions(ENTITY_SIZE_LABEL)} onChange={(e) => set({ entity_size: e.target.value })} />
            )}
            <UserSelect label="Responsible" value={f.responsible} onChange={(v) => set({ responsible: v })} />
            <UserSelect label="Docketer" value={f.docketer} onChange={(v) => set({ docketer: v })} />
          </div>
        </section>

        {(patentLike || t === 'design') && (
          <section className="flex flex-col gap-3">
            <FormHeading>Content</FormHeading>
            {patentLike && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Claims" type="number" min={0} value={f.claims_count} onChange={(e) => set({ claims_count: e.target.value })} />
                <Input label="Independent claims" type="number" min={0} value={f.independent_claims} onChange={(e) => set({ independent_claims: e.target.value })} />
              </div>
            )}
            <Textarea label="Abstract" rows={4} value={f.abstract} onChange={(e) => set({ abstract: e.target.value })} />
          </section>
        )}

        <section className="flex flex-col gap-3">
          <FormHeading>Office data and notes</FormHeading>
          <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
            <Switch checked={f.sync_enabled} onCheckedChange={(v) => set({ sync_enabled: v })} label="Check with the office automatically" />
            <p className="mt-1.5 text-xs text-[var(--agent-app-muted)]">When the office is connected, changes it reports are filed in the Inbox for review. Nothing changes without a person accepting it.</p>
          </div>
          <Textarea label="Notes" rows={4} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </section>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* National phase, validation, designation, continuations              */
/* ------------------------------------------------------------------ */

export type ChildRelation = 'national_phase' | 'validation' | 'designation' | 'continuation' | 'divisional' | 'continuation_in_part';

const CHILD_RELATION: Record<ChildRelation, { label: string; help: string; countries: boolean }> = {
  national_phase: {
    label: 'National phase',
    help: 'Enter the national or regional phase of the international application. The international filing date and priority claims carry over, and each country gets its own deadlines.',
    countries: true,
  },
  validation: {
    label: 'Validation',
    help: 'Validate the granted European patent in each country. The grant date carries over and the national renewal fees follow.',
    countries: true,
  },
  designation: {
    label: 'Designation',
    help: 'Add the countries covered by the international registration. The registration date carries over and each country gets its own record.',
    countries: true,
  },
  continuation: { label: 'Continuation', help: 'Same disclosure with new claims, filed while the parent is still pending.', countries: false },
  divisional: { label: 'Divisional', help: 'Claims split out of the parent application, keeping its filing date.', countries: false },
  continuation_in_part: { label: 'Continuation in part', help: 'Adds new matter to the parent disclosure. Only the old matter keeps the parent date.', countries: false },
};

const PCT_STATES = ['US', 'EP', 'JP', 'CN', 'KR', 'CA', 'AU', 'IN', 'BR', 'GB', 'MX', 'IL', 'SG', 'ZA', 'NZ', 'EA'];
const EPC_STATES = ['DE', 'FR', 'GB', 'IT', 'ES', 'NL', 'BE', 'CH', 'AT', 'SE', 'DK', 'FI', 'IE', 'PL', 'PT', 'TR', 'NO'];
const MADRID_MEMBERS = ['US', 'EM', 'JP', 'CN', 'KR', 'GB', 'CH', 'AU', 'IN', 'SG', 'MX', 'BR', 'CA', 'NO', 'TR', 'IL', 'NZ', 'VN', 'PH'];
const HAGUE_MEMBERS = ['US', 'EM', 'JP', 'KR', 'CN', 'GB', 'CH', 'CA', 'SG', 'MX', 'BR', 'NO', 'TR'];

/** Which related filings make sense from this matter. */
export function childRelationsFor(m: Pick<MatterRec, 'ip_type' | 'jurisdiction' | 'route' | 'status' | 'registration_date'>): ChildRelation[] {
  const j = m.jurisdiction.toUpperCase();
  const out: ChildRelation[] = [];
  if (isPatentLike(m.ip_type)) {
    if (j === 'WO') out.push('national_phase');
    if (j === 'EP' && (m.status === 'granted' || d10(m.registration_date) !== '')) out.push('validation');
    if (j !== 'WO' && m.route !== 'provisional') {
      if (j === 'US') out.push('continuation', 'divisional', 'continuation_in_part');
      else out.push('divisional');
    }
  }
  if (m.ip_type === 'trademark' && (m.route === 'madrid' || j === 'WO')) out.push('designation');
  if (m.ip_type === 'design' && (m.route === 'hague' || j === 'WO')) out.push('designation');
  return out;
}

function countryOptionsFor(relation: ChildRelation, m: MatterRec, preferred: string[]): string[] {
  const base =
    relation === 'national_phase'
      ? PCT_STATES
      : relation === 'validation'
        ? EPC_STATES
        : m.ip_type === 'design'
          ? HAGUE_MEMBERS
          : MADRID_MEMBERS;
  // Offices that do not handle this kind of right are left out: the EPO takes
  // no trademarks or designs, the EUIPO takes no patents.
  const notFor = relation === 'designation' ? ['EP'] : ['EM'];
  const extra = relation === 'validation' ? [] : preferred.map((c) => c.toUpperCase());
  const self = m.jurisdiction.toUpperCase();
  return [...new Set([...base, ...extra])].filter(
    (c) => c !== 'WO' && c !== self && !notFor.includes(c) && !(relation === 'validation' && c === 'EP'),
  );
}

export function NationalPhaseDialog(props: {
  matter: MatterRec;
  /** Matters already in the family, so countries already covered are shown. */
  familyMembers?: MatterRec[] | undefined;
  onClose: () => void;
  onDone?: ((created: { id: string; ref: string; jurisdiction: string }[]) => void) | undefined;
  open?: boolean | undefined;
}): React.JSX.Element | null {
  if (props.open === false) return null;
  return <NationalPhaseInner {...props} />;
}

function NationalPhaseInner({
  matter,
  familyMembers,
  onClose,
  onDone,
}: {
  matter: MatterRec;
  familyMembers?: MatterRec[] | undefined;
  onClose: () => void;
  onDone?: ((created: { id: string; ref: string; jurisdiction: string }[]) => void) | undefined;
}): React.JSX.Element {
  const { settings } = useApp();
  const preferred = settings?.jurisdictions ?? [];
  const relations = childRelationsFor(matter);
  const [relation, setRelation] = useState<ChildRelation>(relations[0] ?? 'divisional');
  const [countries, setCountries] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [entryDate, setEntryDate] = useState(today());
  const [filingDate, setFilingDate] = useState(today());
  const [title, setTitle] = useState(matter.title);
  const [busy, setBusy] = useState(false);
  const def = CHILD_RELATION[relation];

  const covered = useMemo(() => {
    const s = new Set<string>();
    for (const m of familyMembers ?? []) if (m.id !== matter.id && m.status_group !== 'dead') s.add(m.jurisdiction.toUpperCase());
    return s;
  }, [familyMembers, matter.id]);

  const options = useMemo(() => {
    const all = [...new Set([...countryOptionsFor(relation, matter, preferred), ...extra])];
    return all.filter((c) => !covered.has(c));
  }, [relation, matter, preferred, extra, covered]);
  const coveredList = [...covered].filter((c) => countryOptionsFor(relation, matter, preferred).includes(c) || extra.includes(c));

  const submit = async (): Promise<void> => {
    if (def.countries && countries.length === 0) {
      toast.error('Choose at least one country.');
      return;
    }
    if (!def.countries && d10(filingDate) === '') {
      toast.error('Enter the filing date.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ created: { id: string; ref: string; jurisdiction: string }[]; deadlines: number }>('matters/national-phase', {
        matter_id: matter.id,
        relation,
        jurisdictions: def.countries ? countries : [],
        ...(relation === 'national_phase' ? { entry_date: entryDate } : {}),
        ...(!def.countries ? { filing_date: filingDate, title: title.trim() || matter.title } : {}),
      });
      toast.success(`Created ${r.created.map((c) => c.ref).join(', ')} with ${plural(r.deadlines, 'deadline')}`);
      onDone?.(r.created);
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={def.countries ? `Add countries to ${matter.ref}` : `New ${def.label.toLowerCase()} of ${matter.ref}`}
      description={def.help}
      className="w-[min(96vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={def.countries && countries.length === 0}>
            {def.countries ? (countries.length > 0 ? `Create ${plural(countries.length, 'record')}` : 'Create records') : `Create ${def.label.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
        {relations.length > 1 && (
          <Segmented
            value={relation}
            size="sm"
            ariaLabel="Kind of related filing"
            options={relations.map((r) => ({ value: r, label: CHILD_RELATION[r].label }))}
            onChange={(v) => {
              setRelation(v);
              setCountries([]);
            }}
          />
        )}
        {def.countries ? (
          <>
            <Field label="Countries" help={countries.length > 0 ? `${countries.length} selected: ${countries.join(', ')}` : 'Click to select. Each becomes its own record in the family.'}>
              {options.length > 0 ? (
                <JurisdictionChips value={countries} onChange={setCountries} options={options} />
              ) : (
                <p className="text-[13px] text-[var(--agent-app-muted)]">Every listed country is already in the family. Add another below.</p>
              )}
            </Field>
            <div className="max-w-xs">
              <JurisdictionSelect
                label="Another country"
                value=""
                placeholder="Add a country not listed"
                onChange={(v) => {
                  if (v === '' || covered.has(v)) return;
                  setExtra((x) => (x.includes(v) ? x : [...x, v]));
                  setCountries((x) => (x.includes(v) ? x : [...x, v]));
                }}
              />
            </div>
            {coveredList.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--agent-app-muted)]">
                Already in the family:
                {coveredList.map((c) => (
                  <JurChip key={c} code={c} />
                ))}
              </p>
            )}
            {relation === 'national_phase' && (
              <div className="max-w-xs">
                <DateField label="Entry date" value={entryDate} onChange={setEntryDate} help="The date the national phase was entered at each office." />
              </div>
            )}
            {relation === 'national_phase' && d10(matter.filing_date) === '' && (
              <Notice tone="warn">This PCT application has no filing date, so the national records will have none either. Add it with Edit first for the deadlines to follow.</Notice>
            )}
            {(relation === 'validation' || relation === 'designation') && d10(matter.registration_date) === '' && (
              <Notice tone="warn">
                No {relation === 'validation' ? 'grant' : 'registration'} date is recorded on {matter.ref}, so the new records start without one and no renewal deadlines are created.
              </Notice>
            )}
          </>
        ) : (
          <>
            <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <DateField label="Filing date" value={filingDate} onChange={setFilingDate} required help="Recorded as Application filed." />
              <Field label="Office">
                <div className="flex h-9 items-center gap-2 text-[13px]">
                  <JurChip code={matter.jurisdiction} /> {jurisdictionName(matter.jurisdiction)}
                </div>
              </Field>
            </div>
            <p className="text-xs text-[var(--agent-app-muted)]">
              The new record joins the family, keeps the parent&apos;s priority claims, owner and people, and links back to {matter.ref}.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Manual deadline                                                     */
/* ------------------------------------------------------------------ */

const KIND_CHOICES: DeadlineKind[] = ['internal', 'hard', 'extendable', 'designated', 'reminder'];

export function AddDeadlineDialog(props: {
  matter: MatterRec;
  onClose: () => void;
  onDone?: ((d: DeadlineRec) => void) | undefined;
  open?: boolean | undefined;
}): React.JSX.Element | null {
  if (props.open === false) return null;
  return <AddDeadlineInner {...props} />;
}

function AddDeadlineInner({ matter, onClose, onDone }: { matter: MatterRec; onClose: () => void; onDone?: ((d: DeadlineRec) => void) | undefined }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [kind, setKind] = useState<DeadlineKind>('internal');
  const [category, setCategory] = useState<Category>('prosecution');
  const [target, setTarget] = useState('');
  const [finalDate, setFinalDate] = useState('');
  const [assignee, setAssignee] = useState(matter.responsible || matter.docketer);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const statutory = kind === 'hard' || kind === 'extendable' || kind === 'designated';
  const hasFinal = kind === 'extendable' || kind === 'designated';

  const submit = async (): Promise<void> => {
    setTried(true);
    if (title.trim() === '' || d10(due) === '') {
      toast.error('Enter what is due and the due date.');
      return;
    }
    if (d10(target) !== '' && target > due) {
      toast.error('The target date should be on or before the due date.');
      return;
    }
    if (hasFinal && d10(finalDate) !== '' && finalDate < due) {
      toast.error('The final date should be on or after the due date.');
      return;
    }
    setBusy(true);
    try {
      const d = await createRecord<DeadlineRec>('deadlines', {
        title: title.trim(),
        matter: matter.id,
        kind,
        category,
        status: 'open',
        due_date: toPb(due),
        target_date: toPb(target),
        final_date: hasFinal ? toPb(finalDate) : '',
        assignee,
        notes: notes.trim(),
        source: 'manual',
      });
      toast.success(`Deadline added: ${d.title}, due ${fmtDate(d.due_date)}`);
      onDone?.(d);
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
      title={`Add a deadline to ${matter.ref}`}
      description="For dates no rule covers, such as a date set in a letter or a date you promised a client. For office events, use Record what happened so the rules apply."
      className="w-[min(96vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Add deadline
          </Button>
        </>
      }
    >
      <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1">
        <Input
          label="What is due"
          value={title}
          autoFocus
          placeholder="For example: File certified copy of the priority document"
          error={tried && title.trim() === '' ? 'Enter what is due.' : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField label="Due date" value={due} onChange={setDue} required />
          <Select label="Kind" value={kind} options={KIND_CHOICES.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(e) => setKind(e.target.value as DeadlineKind)} />
        </div>
        <p className="-mt-1 text-xs text-[var(--agent-app-muted)]">{KIND_HELP[kind]}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField
            label="Target date (optional)"
            value={target}
            onChange={setTarget}
            help={statutory ? 'Left empty, the target is set ahead of the due date by the usual buffer.' : 'Left empty, the target is the due date.'}
          />
          {hasFinal && (
            <DateField label="Final date (optional)" value={finalDate} onChange={setFinalDate} help="The last date reachable with extensions." />
          )}
          <Select
            label="Category"
            value={category}
            options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
            onChange={(e) => setCategory(e.target.value as Category)}
          />
          <UserSelect label="Assigned to" value={assignee} onChange={setAssignee} />
        </div>
        <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where the date comes from" />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Edit a family or mark                                               */
/* ------------------------------------------------------------------ */

export function FamilyEditDialog(props: { family: FamilyRec; onClose: () => void; open?: boolean | undefined }): React.JSX.Element | null {
  if (props.open === false) return null;
  return <FamilyEditInner family={props.family} onClose={props.onClose} />;
}

function FamilyEditInner({ family, onClose }: { family: FamilyRec; onClose: () => void }): React.JSX.Element {
  const { properties, vocab } = useApp();
  const mark = family.kind === 'trademark';
  const [f, setF] = useState({
    title: family.title,
    property: family.property,
    mark_type: family.mark_type as string,
    word_element: family.word_element,
    vienna_codes: family.vienna_codes,
    disclaimer: family.disclaimer,
    transliteration: family.transliteration,
    translation: family.translation,
    description: family.description,
    technology_tags: family.technology_tags ?? [],
    products: family.products,
    strategy: family.strategy as string,
    strategy_note: family.strategy_note,
    business_unit: family.business_unit,
    owner_entity: family.owner_entity,
  });
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<typeof f>): void => setF((x) => ({ ...x, ...patch }));

  const preview = useMemo(() => (image !== null ? URL.createObjectURL(image) : ''), [image]);
  useEffect(() => {
    return () => {
      if (preview !== '') URL.revokeObjectURL(preview);
    };
  }, [preview]);
  const currentImage = !removeImage && family.mark_image !== '' ? fileUrl(family, family.mark_image, '400x0') : '';
  const shown = preview !== '' ? preview : currentImage;

  const save = async (): Promise<void> => {
    if (f.title.trim() === '') {
      toast.error(mark ? 'Enter the mark.' : 'Enter a title.');
      return;
    }
    setBusy(true);
    try {
      const data: Record<string, unknown> = {
        title: f.title.trim(),
        property: f.property,
        description: f.description,
        products: f.products,
        strategy: f.strategy,
        strategy_note: f.strategy_note,
        business_unit: f.business_unit.trim(),
        owner_entity: f.owner_entity.trim(),
      };
      if (mark) {
        data['mark_type'] = f.mark_type;
        data['word_element'] = f.word_element.trim();
        data['vienna_codes'] = f.vienna_codes.trim();
        data['disclaimer'] = f.disclaimer;
        data['transliteration'] = f.transliteration.trim();
        data['translation'] = f.translation.trim();
        if (removeImage && image === null) data['mark_image'] = null;
      } else {
        data['technology_tags'] = f.technology_tags;
      }
      await updateRecord<FamilyRec>('families', family.id, data);
      if (mark && image !== null) {
        const fd = new FormData();
        fd.append('mark_image', image);
        await updateRecord<FamilyRec>('families', family.id, fd);
      }
      toast.success('Saved');
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
      title={`Edit ${FAMILY_KIND_LABEL[family.kind].toLowerCase()}`}
      className="w-[min(96vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex max-h-[66vh] flex-col gap-5 overflow-y-auto pr-1">
        <section className="flex flex-col gap-3">
          <Input label={mark ? 'Mark' : 'Title'} value={f.title} onChange={(e) => set({ title: e.target.value })} />
          <Select
            label={vocab.property}
            value={f.property}
            placeholder="None"
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => set({ property: e.target.value })}
          />
        </section>

        {mark && (
          <section className="flex flex-col gap-3">
            <FormHeading>The mark</FormHeading>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex shrink-0 flex-col gap-2">
                <div className="flex size-32 items-center justify-center overflow-hidden border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)]">
                  {shown !== '' ? (
                    <img src={shown} alt="Mark" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="px-2 text-center text-xs text-[var(--agent-app-muted)]">No image</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInput.current?.click()}>
                    <ImagePlus size={12} aria-hidden /> {shown !== '' ? 'Replace' : 'Upload'}
                  </Button>
                  {shown !== '' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      aria-label="Remove image"
                      onClick={() => {
                        setImage(null);
                        setRemoveImage(true);
                      }}
                    >
                      <Trash2 size={12} aria-hidden />
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file !== undefined) {
                      setImage(file);
                      setRemoveImage(false);
                    }
                  }}
                />
              </div>
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <Select label="Mark type" value={f.mark_type} placeholder="Not set" options={toOptions(MARK_TYPE_LABEL)} onChange={(e) => set({ mark_type: e.target.value })} />
                <Input label="Word element" value={f.word_element} onChange={(e) => set({ word_element: e.target.value })} />
                <Input label="Vienna codes (figurative elements)" className="font-mono" placeholder="For example 03.01.08; 26.04.02" value={f.vienna_codes} onChange={(e) => set({ vienna_codes: e.target.value })} />
                <Input label="Transliteration" value={f.transliteration} onChange={(e) => set({ transliteration: e.target.value })} />
                <Input label="Translation" value={f.translation} onChange={(e) => set({ translation: e.target.value })} />
              </div>
            </div>
            <Textarea label="Disclaimer" rows={2} placeholder="Parts of the mark not claimed on their own" value={f.disclaimer} onChange={(e) => set({ disclaimer: e.target.value })} />
          </section>
        )}

        <section className="flex flex-col gap-3">
          <FormHeading>Description</FormHeading>
          <Textarea label="Description" rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} />
          {!mark && <TagInput label="Technology tags" value={f.technology_tags} onChange={(v) => set({ technology_tags: v })} placeholder="Type a tag and press Enter" />}
          <Input label="Products" placeholder="Products or services this covers" value={f.products} onChange={(e) => set({ products: e.target.value })} />
        </section>

        <section className="flex flex-col gap-3">
          <FormHeading>Strategy</FormHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Strategy" value={f.strategy} placeholder="Not decided" options={toOptions(STRATEGY_LABEL)} onChange={(e) => set({ strategy: e.target.value })} />
            <Input label="Business unit" value={f.business_unit} onChange={(e) => set({ business_unit: e.target.value })} />
            <Input label="Owner entity" placeholder="The group company that owns it" value={f.owner_entity} onChange={(e) => set({ owner_entity: e.target.value })} />
          </div>
          <Textarea label="Strategy note" rows={2} placeholder="Why, and what would change the decision" value={f.strategy_note} onChange={(e) => set({ strategy_note: e.target.value })} />
        </section>
      </div>
    </Dialog>
  );
}
