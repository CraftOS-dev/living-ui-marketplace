/**
 * Adding a right to the register, three ways:
 * 1. Look up by number: the office's own record (office data, family
 *    members, office events that become deadlines).
 * 2. From a template: the usual filing routes pre-filled.
 * 3. Blank: every field by hand. Dates entered are recorded as events so
 *    the rules create the deadlines that are still ahead.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, ExternalLink, Search } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, toast } from '../../kit/index.ts';
import { createRecord, errText, listAll, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, plural, toPb } from '../lib/format.ts';
import { IP_TYPE_LABEL, ROUTE_LABEL, STATUS_LABEL, STATUS_ORDER, jurisdictionName } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { FamilyRec, GoodsServicesRec, IpType, MatterRec, MatterStatus, OfficeEvent, PriorityClaim, WorkRec } from '../lib/types.ts';
import { JurisdictionSelect, RecordPicker, UserSelect } from './pickers.tsx';
import {
  CLASS_STATUS_LABEL,
  ENTITY_SIZE_LABEL,
  FAMILY_KIND_LABEL,
  NICE_HEADING,
  TM_BASIS_LABEL,
  TM_REGISTER_LABEL,
  DateField,
  NiceClassChips,
  PriorityClaimsEditor,
  cleanClaims,
  defaultRoute,
  familyKindOf,
  isPatentLike,
  normNum,
  registrationCode,
  toOptions,
} from './matterShared.tsx';
import type { FamilyKind, PortfolioType } from './matterShared.tsx';
import { Checkbox, Fact, FactGrid, Field, JurChip, Notice, Segmented, Tag } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Path = 'lookup' | 'template' | 'blank';
type FamilyMode = 'new' | 'existing' | 'none';

export interface NewMatterDefaults {
  jurisdiction?: string | undefined;
  title?: string | undefined;
  property?: string | undefined;
  family?: string | undefined;
  work?: string | undefined;
  route?: string | undefined;
  relation?: string | undefined;
  parent?: string | undefined;
  priority_claims?: PriorityClaim[] | undefined;
  application_no?: string | undefined;
}

export interface NewMatterDialogProps {
  ipType: IpType;
  onClose: () => void;
  /** Optional: when false nothing renders. Mounting the dialog conditionally works too. */
  open?: boolean | undefined;
  defaults?: NewMatterDefaults | undefined;
  initialPath?: Path | undefined;
  /** Called with the new matter id; by default the app opens the matter. */
  onCreated?: ((id: string) => void) | undefined;
  /** Dialog title; defaults to "New <type>". */
  heading?: string | undefined;
}

interface MatterDraft {
  ip_type: IpType;
  title: string;
  jurisdiction: string;
  route: string;
  relation: string;
  parent: string;
  status: MatterStatus;
  application_no: string;
  filing_date: string;
  publication_no: string;
  publication_date: string;
  registration_no: string;
  registration_date: string;
  property: string;
  familyMode: FamilyMode;
  family: string;
  familyTitle: string;
  work: string;
  owner_of_record: string;
  applicants: string;
  counsel: string;
  client_ref: string;
  entity_size: string;
  tm_register: string;
  tm_basis: string;
  classes: number[];
  priority_claims: PriorityClaim[];
  responsible: string;
  docketer: string;
}

interface LookupSnapshot {
  found: boolean;
  title: string;
  status_text: string;
  status: string;
  filing_date: string;
  publication_no: string;
  publication_date: string;
  registration_no: string;
  registration_date: string;
  expiry_date: string;
  owner: string;
  applicants: string;
  classes: { nice_class: number; spec: string }[];
  next_annuity_date: string;
  events: OfficeEvent[];
  lag_note: string;
  source: string;
}

interface FamilyMember {
  key: string;
  jurisdiction: string;
  number: string;
  filing_date: string;
  publication: string;
  kind: string;
}

type LookupResponse =
  | { available: false; reason: string }
  | { available: true; source: string; snapshot: LookupSnapshot; family: FamilyMember[]; existing: { id: string; ref: string }[] };

interface ImportState {
  property: string;
  familyMode: 'new' | 'existing';
  family: string;
  familyTitle: string;
  responsible: string;
  generate: boolean;
}

interface Template {
  key: string;
  label: string;
  help: string;
  ip_type: IpType;
  jurisdiction: string;
  route: string;
  tm_basis?: string | undefined;
  tm_register?: string | undefined;
}

/* ------------------------------------------------------------------ */
/* Templates: the usual filing routes                                  */
/* ------------------------------------------------------------------ */

const TEMPLATES: Record<PortfolioType, Template[]> = {
  patent: [
    { key: 'us-nonprov', label: 'US non-provisional', help: 'Utility application at the USPTO. Term runs 20 years from filing.', ip_type: 'patent', jurisdiction: 'US', route: 'national' },
    { key: 'us-prov', label: 'US provisional', help: 'Holds a filing date for 12 months. Never examined and never becomes a patent itself.', ip_type: 'patent', jurisdiction: 'US', route: 'provisional' },
    { key: 'ep', label: 'EP application', help: 'Filed at the European Patent Office. Validated country by country after grant.', ip_type: 'patent', jurisdiction: 'EP', route: 'ep' },
    { key: 'jp', label: 'JP application', help: 'Filed at the JPO. Examination must be requested within 3 years of filing.', ip_type: 'patent', jurisdiction: 'JP', route: 'national' },
    { key: 'pct', label: 'PCT application', help: 'International application. National phases start at 30 or 31 months from priority.', ip_type: 'patent', jurisdiction: 'WO', route: 'pct' },
  ],
  trademark: [
    { key: 'us-1a', label: 'US application (1(a) use)', help: 'The mark is already used in US commerce. A specimen of use is filed with the application.', ip_type: 'trademark', jurisdiction: 'US', route: 'national', tm_basis: '1a', tm_register: 'principal' },
    { key: 'us-1b', label: 'US intent-to-use (1(b))', help: 'The mark is not used yet. A statement of use follows the notice of allowance.', ip_type: 'trademark', jurisdiction: 'US', route: 'national', tm_basis: '1b', tm_register: 'principal' },
    { key: 'em', label: 'EU trade mark (EUIPO)', help: 'One registration for all EU member states, 10 years from filing and renewable.', ip_type: 'trademark', jurisdiction: 'EM', route: 'regional' },
    { key: 'jp', label: 'JP trademark', help: 'Filed at the JPO. The registration fee can be paid for 10 years or in two halves.', ip_type: 'trademark', jurisdiction: 'JP', route: 'national' },
    { key: 'madrid', label: 'Madrid international registration', help: 'One WIPO filing based on a home application, designating many countries.', ip_type: 'trademark', jurisdiction: 'WO', route: 'madrid' },
  ],
  design: [
    { key: 'us', label: 'US design', help: 'Design patent at the USPTO. 15 years from grant, no maintenance fees.', ip_type: 'design', jurisdiction: 'US', route: 'national' },
    { key: 'em', label: 'EU registered design (EUIPO)', help: 'One design right for the EU, renewable every 5 years up to 25 years.', ip_type: 'design', jurisdiction: 'EM', route: 'regional' },
    { key: 'jp', label: 'JP design', help: 'Filed at the JPO. Annual fees keep it in force up to 25 years from filing.', ip_type: 'design', jurisdiction: 'JP', route: 'national' },
  ],
  copyright: [
    { key: 'us', label: 'US registration', help: 'Registration with the US Copyright Office. Needed before suing over a US work.', ip_type: 'copyright', jurisdiction: 'US', route: 'national' },
    { key: 'jp', label: 'JP registration', help: 'Optional registration with the Agency for Cultural Affairs (dates, transfers).', ip_type: 'copyright', jurisdiction: 'JP', route: 'national' },
  ],
};

function templateTypeOf(t: IpType): PortfolioType {
  if (t === 'trademark' || t === 'domain') return 'trademark';
  if (t === 'design') return 'design';
  if (t === 'copyright') return 'copyright';
  return 'patent';
}

const IP_TYPE_CHOICES: IpType[] = ['patent', 'utility_model', 'trademark', 'design', 'copyright'];

function defaultFamilyMode(t: IpType): FamilyMode {
  return t === 'patent' || t === 'trademark' || t === 'design' ? 'new' : 'none';
}

function initialDraft(ipType: IpType, d: NewMatterDefaults, responsible: string): MatterDraft {
  const jur = (d.jurisdiction ?? '').toUpperCase();
  return {
    ip_type: ipType,
    title: d.title ?? '',
    jurisdiction: jur,
    route: d.route ?? (jur !== '' ? defaultRoute(ipType, jur) : 'national'),
    relation: d.relation ?? 'none',
    parent: d.parent ?? '',
    status: 'to_file',
    application_no: d.application_no ?? '',
    filing_date: '',
    publication_no: '',
    publication_date: '',
    registration_no: '',
    registration_date: '',
    property: d.property ?? '',
    familyMode: d.family !== undefined && d.family !== '' ? 'existing' : defaultFamilyMode(ipType),
    family: d.family ?? '',
    familyTitle: '',
    work: d.work ?? '',
    owner_of_record: '',
    applicants: '',
    counsel: '',
    client_ref: '',
    entity_size: '',
    tm_register: '',
    tm_basis: '',
    classes: [],
    priority_claims: d.priority_claims ?? [],
    responsible,
    docketer: '',
  };
}

/* ------------------------------------------------------------------ */
/* Creating from a draft                                               */
/* ------------------------------------------------------------------ */

async function createFromDraft(draft: MatterDraft): Promise<{ id: string; ref: string; deadlines: number; failures: string[] }> {
  const fk = familyKindOf(draft.ip_type);
  const title = draft.title.trim();
  let familyId = fk !== null && draft.familyMode === 'existing' ? draft.family : '';
  if (fk !== null && draft.familyMode === 'new') {
    const fam = await createRecord<FamilyRec>('families', {
      kind: fk,
      title: draft.familyTitle.trim() || title,
      property: draft.property,
      strategy: 'maintain',
      ...(fk === 'trademark' ? { word_element: title, mark_type: 'word' } : {}),
    });
    familyId = fam.id;
  }
  const patentUs = isPatentLike(draft.ip_type) && draft.jurisdiction === 'US';
  const tmUs = draft.ip_type === 'trademark' && draft.jurisdiction === 'US';
  const created = await createRecord<MatterRec>('matters', {
    ip_type: draft.ip_type,
    title,
    jurisdiction: draft.jurisdiction.toUpperCase(),
    route: draft.route,
    relation: draft.relation,
    parent: draft.parent,
    status: draft.status,
    application_no: draft.application_no.trim(),
    filing_date: toPb(draft.filing_date),
    publication_no: draft.publication_no.trim(),
    publication_date: toPb(draft.publication_date),
    registration_no: draft.registration_no.trim(),
    registration_date: toPb(draft.registration_date),
    property: draft.property,
    family: familyId,
    work: draft.ip_type === 'copyright' ? draft.work : '',
    owner_of_record: draft.owner_of_record.trim(),
    applicants: draft.applicants.trim(),
    counsel: draft.counsel.trim(),
    client_ref: draft.client_ref.trim(),
    entity_size: patentUs ? draft.entity_size : '',
    tm_register: tmUs ? draft.tm_register : '',
    tm_basis: tmUs ? draft.tm_basis : '',
    priority_claims: cleanClaims(draft.priority_claims),
    responsible: draft.responsible,
    docketer: draft.docketer,
    sync_enabled: true,
  });

  const failures: string[] = [];
  if (draft.ip_type === 'trademark') {
    const classStatus = d10(draft.registration_date) !== '' ? 'registered' : 'pending';
    for (const n of draft.classes) {
      try {
        await createRecord<GoodsServicesRec>('goods_services', { matter: created.id, nice_class: n, spec: '', class_status: classStatus });
      } catch (err) {
        failures.push(`Class ${n}: ${errText(err)}`);
      }
    }
  }

  // Each date entered is recorded as the event it stands for, so the rules
  // create the deadlines still ahead (the server skips the ones already past).
  const events: { code: string; date: string }[] = [];
  if (d10(draft.filing_date) !== '') events.push({ code: 'FILED', date: d10(draft.filing_date) });
  if (d10(draft.publication_date) !== '') events.push({ code: 'PUBLISHED', date: d10(draft.publication_date) });
  if (d10(draft.registration_date) !== '') events.push({ code: registrationCode(draft.ip_type), date: d10(draft.registration_date) });
  let deadlines = 0;
  for (const ev of events) {
    try {
      const r = await op<{ created: { id: string }[] }>('matters/record-event', { matter_id: created.id, code: ev.code, date: ev.date });
      deadlines += r.created.length;
    } catch (err) {
      failures.push(errText(err));
    }
  }
  // A status chosen on purpose wins over the one the events imply.
  if (events.length > 0 && draft.status !== 'to_file') {
    try {
      await updateRecord<MatterRec>('matters', created.id, { status: draft.status });
    } catch (err) {
      failures.push(errText(err));
    }
  }
  return { id: created.id, ref: created.ref, deadlines, failures };
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function NewMatterDialog(props: NewMatterDialogProps): React.JSX.Element | null {
  if (props.open === false) return null;
  return <NewMatterDialogInner {...props} />;
}

function NewMatterDialogInner({ ipType, onClose, defaults, initialPath, onCreated, heading }: NewMatterDialogProps): React.JSX.Element {
  const { settings, me, can, meta } = useApp();
  const preferred = settings?.jurisdictions ?? [];
  const d = defaults ?? {};
  const tType = templateTypeOf(ipType);
  const lookupPossible = tType !== 'copyright';
  const myId = me !== null && can.edit ? me.id : '';

  const [path, setPath] = useState<Path>(initialPath ?? (lookupPossible ? 'lookup' : 'template'));
  const [draft, setDraft] = useState<MatterDraft>(() => initialDraft(ipType, d, myId));
  const [template, setTemplate] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);

  // Look-up state.
  const lookupJur = (d.jurisdiction ?? '').toUpperCase() || (preferred.includes('US') ? 'US' : (preferred[0] ?? 'US'));
  const [lk, setLk] = useState<{ ip_type: IpType; jurisdiction: string; number: string }>({
    ip_type: ipType === 'domain' ? 'trademark' : ipType,
    jurisdiction: lookupJur,
    number: d.application_no ?? '',
  });
  const [lkBusy, setLkBusy] = useState(false);
  const [lkErr, setLkErr] = useState('');
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [registered, setRegistered] = useState<Map<string, { id: string; ref: string }>>(new Map());
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [imp, setImp] = useState<ImportState>({
    property: d.property ?? '',
    familyMode: d.family !== undefined && d.family !== '' ? 'existing' : 'new',
    family: d.family ?? '',
    familyTitle: '',
    responsible: myId,
    generate: true,
  });

  const set = (patch: Partial<MatterDraft>): void => setDraft((x) => ({ ...x, ...patch }));

  const connected = useMemo(() => {
    const offices = meta?.offices ?? {};
    return Object.entries(offices)
      .filter(([, v]) => v.enabled)
      .map(([k]) => meta?.office_labels[k] ?? k);
  }, [meta]);

  const switchToBlank = (number: string): void => {
    set({
      ip_type: lk.ip_type,
      jurisdiction: lk.jurisdiction,
      route: defaultRoute(lk.ip_type, lk.jurisdiction),
      application_no: number,
      familyMode: draft.family !== '' ? 'existing' : defaultFamilyMode(lk.ip_type),
    });
    setTemplate(null);
    setPath('blank');
  };

  const lookup = async (): Promise<void> => {
    if (lk.number.trim() === '') {
      setLkErr('Enter an application or registration number.');
      return;
    }
    if (lk.jurisdiction === '') {
      setLkErr('Choose the office.');
      return;
    }
    setLkBusy(true);
    setLkErr('');
    setResult(null);
    setMembers(new Set());
    setRegistered(new Map());
    try {
      const r = await op<LookupResponse>('matters/lookup', {
        ip_type: lk.ip_type,
        jurisdiction: lk.jurisdiction,
        number: lk.number.trim(),
        include_family: isPatentLike(lk.ip_type),
      });
      setResult(r);
      if (r.available && r.snapshot.found) {
        setImp((x) => ({ ...x, familyTitle: x.familyTitle || r.snapshot.title }));
        if (r.family.length > 0) {
          const jurs = [...new Set(r.family.map((f) => f.jurisdiction.toUpperCase()))];
          try {
            const rows = await listAll<MatterRec>('matters', { filter: jurs.map((j) => `jurisdiction = ${q(j)}`).join(' || ') });
            const map = new Map<string, { id: string; ref: string }>();
            for (const m of rows) if (m.application_no !== '') map.set(`${m.jurisdiction}|${normNum(m.application_no)}`, { id: m.id, ref: m.ref });
            setRegistered(map);
          } catch {
            /* the server still refuses duplicates on import */
          }
        }
      }
    } catch (err) {
      setLkErr(errText(err));
    } finally {
      setLkBusy(false);
    }
  };

  const importFromOffice = async (): Promise<void> => {
    if (result === null || !result.available || !result.snapshot.found) return;
    const fk = familyKindOf(lk.ip_type);
    if (imp.familyMode === 'existing' && imp.family === '') {
      toast.error('Choose the family to add this to, or pick New.');
      return;
    }
    setBusy(true);
    try {
      let familyId = imp.familyMode === 'existing' ? imp.family : '';
      // The server creates new families for patents, trademarks and designs;
      // utility models need theirs created here.
      if (imp.familyMode === 'new' && lk.ip_type === 'utility_model' && fk !== null) {
        const fam = await createRecord<FamilyRec>('families', {
          kind: fk,
          title: imp.familyTitle.trim() || result.snapshot.title || lk.number.trim(),
          property: imp.property,
          strategy: 'maintain',
        });
        familyId = fam.id;
      }
      const chosen = result.family.filter((f) => members.has(f.key));
      const r = await op<{ created: { id: string; ref: string }[]; deadlines: number; family_id: string }>('matters/import-office', {
        ip_type: lk.ip_type,
        jurisdiction: lk.jurisdiction,
        number: lk.number.trim(),
        property_id: imp.property,
        family_id: familyId,
        family_title: imp.familyTitle.trim(),
        family_members: chosen.map((f) => ({ jurisdiction: f.jurisdiction, number: f.number, filing_date: d10(f.filing_date) })),
        responsible: imp.responsible,
        generate: imp.generate,
      });
      const refs = r.created.map((c) => c.ref).join(', ');
      toast.success(`Added ${refs} with ${plural(r.deadlines, 'deadline')}`);
      const first = r.created[0];
      onClose();
      if (first !== undefined) {
        if (onCreated !== undefined) onCreated(first.id);
        else navigate('matter', first.id);
      }
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const draftError = (): string => {
    if (draft.title.trim() === '') return draft.ip_type === 'trademark' ? 'Enter the mark.' : 'Enter a title.';
    if (draft.jurisdiction === '') return 'Choose the office or country.';
    if (familyKindOf(draft.ip_type) !== null && draft.familyMode === 'existing' && draft.family === '') return 'Choose the family, or pick New or None.';
    return '';
  };

  const create = async (): Promise<void> => {
    setTriedSubmit(true);
    const problem = draftError();
    if (problem !== '') {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const r = await createFromDraft(draft);
      if (r.failures.length > 0) toast.error(`Created ${r.ref}, but: ${r.failures[0] ?? ''}`);
      toast.success(`Created ${r.ref} with ${plural(r.deadlines, 'deadline')}`);
      onClose();
      if (onCreated !== undefined) onCreated(r.id);
      else navigate('matter', r.id);
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  const pickTemplate = (t: Template): void => {
    setTemplate(t);
    setDraft((x) => ({
      ...x,
      ip_type: t.ip_type,
      jurisdiction: t.jurisdiction,
      route: t.route,
      status: 'to_file',
      tm_basis: t.tm_basis ?? '',
      tm_register: t.tm_register ?? '',
      familyMode: x.family !== '' ? 'existing' : defaultFamilyMode(t.ip_type),
    }));
  };

  const found = result !== null && result.available && result.snapshot.found ? result : null;

  const footer = !can.edit ? (
    <Button variant="outline" onClick={onClose}>
      Close
    </Button>
  ) : (
    <>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      {path === 'lookup' ? (
        <Button onClick={() => void importFromOffice()} loading={busy} disabled={found === null || found.existing.length > 0}>
          Add to the register
        </Button>
      ) : path === 'template' && template === null ? null : (
        <Button onClick={() => void create()} loading={busy}>
          Create {IP_TYPE_LABEL[draft.ip_type].toLowerCase()}
        </Button>
      )}
    </>
  );

  const pathOptions: { value: Path; label: string }[] = [
    ...(lookupPossible ? [{ value: 'lookup' as const, label: 'Look up by number' }] : []),
    { value: 'template', label: 'From a template' },
    { value: 'blank', label: 'Blank' },
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={heading ?? `New ${IP_TYPE_LABEL[ipType].toLowerCase()}`}
      description={
        lookupPossible
          ? 'Office data and templates fill in what they can. Dates you enter create the deadlines still ahead.'
          : 'Templates fill in the usual route. Dates you enter create the deadlines still ahead.'
      }
      className="w-[min(96vw,52rem)]"
      footer={footer}
    >
      {!can.edit ? (
        <Notice tone="warn">Only managers and counsel can add records. Ask one of them, or propose the filing through the Inbox.</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <Segmented value={path} options={pathOptions} onChange={setPath} ariaLabel="How to add it" />
          <div className="max-h-[64vh] overflow-y-auto pr-1">
            {path === 'lookup' && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-[11rem_14rem_minmax(0,1fr)_auto] sm:items-end">
                  <Select
                    label="Type"
                    value={lk.ip_type}
                    options={IP_TYPE_CHOICES.filter((t) => t !== 'copyright').map((t) => ({ value: t, label: IP_TYPE_LABEL[t] }))}
                    onChange={(e) => {
                      setLk((x) => ({ ...x, ip_type: e.target.value as IpType }));
                      setResult(null);
                    }}
                  />
                  <JurisdictionSelect
                    label="Office"
                    value={lk.jurisdiction}
                    preferred={preferred}
                    onChange={(v) => {
                      setLk((x) => ({ ...x, jurisdiction: v }));
                      setResult(null);
                    }}
                  />
                  <Input
                    label="Application or registration number"
                    className="font-mono"
                    value={lk.number}
                    placeholder="For example 17/123,456 or 018123456"
                    onChange={(e) => setLk((x) => ({ ...x, number: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void lookup();
                      }
                    }}
                  />
                  <Button onClick={() => void lookup()} loading={lkBusy}>
                    <Search size={14} aria-hidden /> Look up
                  </Button>
                </div>
                {result === null && lkErr === '' && !lkBusy && (
                  <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
                    {connected.length > 0
                      ? `Connected offices: ${connected.join(', ')}. The office record fills in the numbers, dates, owner and events.`
                      : 'No office is connected yet, so look-ups are not available. Use a template or enter the details by hand.'}
                    {connected.length === 0 && can.admin && (
                      <>
                        {' '}
                        <a className="font-medium text-[var(--agent-app-accent)] hover:underline" href={href('settings', undefined, { tab: 'offices' })} onClick={onClose}>
                          Connect an office
                        </a>
                      </>
                    )}
                  </p>
                )}
                {lkErr !== '' && <Notice tone="bad">{lkErr}</Notice>}
                {result !== null && !result.available && (
                  <Notice tone="warn">
                    <div>{result.reason}</div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => switchToBlank(lk.number.trim())}>
                      Enter it by hand
                    </Button>
                  </Notice>
                )}
                {result !== null && result.available && !result.snapshot.found && (
                  <Notice tone="warn">
                    <div>
                      {result.snapshot.source || 'The office'} has no record for {lk.number.trim()}. Check the number format, or enter the right by hand.
                    </div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => switchToBlank(lk.number.trim())}>
                      Enter it by hand
                    </Button>
                  </Notice>
                )}
                {found !== null && (
                  <LookupPreview
                    ipType={lk.ip_type}
                    jurisdiction={lk.jurisdiction}
                    number={lk.number.trim()}
                    snapshot={found.snapshot}
                    existing={found.existing}
                    family={found.family}
                    registered={registered}
                    members={members}
                    setMembers={setMembers}
                    onNavigate={onClose}
                  />
                )}
                {found !== null && found.existing.length === 0 && (
                  <ImportSettings ipType={lk.ip_type} imp={imp} setImp={setImp} />
                )}
              </div>
            )}

            {path === 'template' && (
              <div className="flex flex-col gap-4">
                {template === null ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TEMPLATES[tType].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => pickTemplate(t)}
                        className="flex items-start gap-3 border border-[var(--agent-app-border)] px-3 py-3 text-left transition-colors hover:border-[var(--agent-app-accent)]/60 hover:bg-[var(--agent-app-border)]/20"
                      >
                        <JurChip code={t.jurisdiction} className="mt-0.5" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold">{t.label}</span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--agent-app-muted)]">{t.help}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/15 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2 text-[13px]">
                        <JurChip code={template.jurisdiction} />
                        <span className="font-semibold">{template.label}</span>
                        <span className="hidden truncate text-[var(--agent-app-muted)] sm:inline">{template.help}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setTemplate(null)}>
                        <ArrowLeft size={13} aria-hidden /> Other templates
                      </Button>
                    </div>
                    <MatterForm draft={draft} set={set} preferred={preferred} showErrors={triedSubmit} />
                  </>
                )}
              </div>
            )}

            {path === 'blank' && <MatterForm draft={draft} set={set} preferred={preferred} showErrors={triedSubmit} />}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Look-up preview                                                     */
/* ------------------------------------------------------------------ */

function LookupPreview({
  ipType,
  jurisdiction,
  number,
  snapshot,
  existing,
  family,
  registered,
  members,
  setMembers,
  onNavigate,
}: {
  ipType: IpType;
  jurisdiction: string;
  number: string;
  snapshot: LookupSnapshot;
  existing: { id: string; ref: string }[];
  family: FamilyMember[];
  registered: Map<string, { id: string; ref: string }>;
  members: Set<string>;
  setMembers: (s: Set<string>) => void;
  onNavigate: () => void;
}): React.JSX.Element {
  const { meta } = useApp();
  const patentLike = isPatentLike(ipType);
  const tm = ipType === 'trademark';
  const events = [...snapshot.events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const otherMembers = family.filter((f) => !(f.jurisdiction.toUpperCase() === jurisdiction && normNum(f.number) === normNum(number)));
  return (
    <div className="flex flex-col gap-4 border border-[var(--agent-app-border)] p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <JurChip code={jurisdiction} />
          <Tag>{IP_TYPE_LABEL[ipType]}</Tag>
          <span className="text-xs text-[var(--agent-app-muted)]">From {snapshot.source}</span>
        </div>
        <h3 className="mt-2 text-base font-semibold leading-snug">{snapshot.title || 'Untitled at the office'}</h3>
        {snapshot.status_text !== '' && <p className="mt-0.5 text-[13px] text-[var(--agent-app-muted)]">{snapshot.status_text}</p>}
      </div>

      {existing.length > 0 && (
        <Notice tone="warn">
          Already in the register as{' '}
          {existing.map((x, i) => (
            <span key={x.id}>
              {i > 0 ? ', ' : ''}
              <a className="font-mono font-medium text-[var(--agent-app-accent)] hover:underline" href={href('matter', x.id)} onClick={onNavigate}>
                {x.ref}
              </a>
            </span>
          ))}
          . Open it to check it with the office instead of adding it twice.
        </Notice>
      )}

      <FactGrid cols={3}>
        <Fact label="Application number" inid={tm ? '210' : '21'} value={number} mono />
        <Fact label="Filing date" inid={tm ? '220' : '22'} value={fmtDate(snapshot.filing_date)} />
        <Fact label="Publication number" inid="11" value={snapshot.publication_no} mono />
        <Fact label="Publication date" inid={tm ? undefined : '43'} value={fmtDate(snapshot.publication_date)} />
        <Fact label={patentLike ? 'Patent number' : 'Registration number'} inid={tm ? '111' : '11'} value={snapshot.registration_no} mono />
        <Fact label={patentLike ? 'Grant date' : 'Registration date'} inid={tm ? '151' : '45'} value={fmtDate(snapshot.registration_date)} />
        {snapshot.expiry_date !== '' && <Fact label="Expiry" inid={tm ? '180' : undefined} value={fmtDate(snapshot.expiry_date)} />}
        <Fact label="Owner" inid={tm ? '732' : '73'} value={snapshot.owner} />
        {snapshot.applicants !== '' && <Fact label="Applicants" inid="71" value={snapshot.applicants} />}
      </FactGrid>

      {tm && snapshot.classes.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">(511) Classes</h4>
          <div className="flex flex-col gap-1.5">
            {snapshot.classes.map((c) => (
              <div key={c.nice_class} className="flex gap-3 text-[13px]">
                <span className="w-16 shrink-0 font-mono tabular-nums" title={NICE_HEADING[c.nice_class]}>
                  Class {c.nice_class}
                </span>
                <span className="line-clamp-2 text-[var(--agent-app-text)]/85">{c.spec || NICE_HEADING[c.nice_class] || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Office events</h4>
        {events.length === 0 ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">The office lists no events.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto border border-[var(--agent-app-border)]">
            {events.map((ev, i) => {
              const mapped = ev.code !== '';
              return (
                <div key={`${ev.raw_code}-${ev.date}-${i}`} className="flex items-start gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-1.5 text-[13px] last:border-0">
                  <span className="w-24 shrink-0 tabular-nums text-[var(--agent-app-muted)]">{fmtDate(ev.date)}</span>
                  <span className="min-w-0 flex-1">{ev.label || ev.raw_code}</span>
                  {mapped ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400" title="Recorded as this event; its rules create deadlines">
                      <Check size={12} aria-hidden /> {meta?.event_codes[ev.code]?.label ?? ev.code}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-[var(--agent-app-muted)]" title="No event code matches this office entry, so it is not recorded">
                      For reference
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-1.5 text-xs text-[var(--agent-app-muted)]">Events with a check are recorded in date order and run through the rules. Deadlines already past are skipped.</p>
      </div>

      {snapshot.lag_note !== '' && <Notice>{snapshot.lag_note}</Notice>}

      {otherMembers.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
            Family members at the EPO ({otherMembers.length})
          </h4>
          <p className="mb-2 text-xs text-[var(--agent-app-muted)]">Tick the ones to add as their own records in the same family.</p>
          <div className="max-h-56 overflow-y-auto border border-[var(--agent-app-border)]">
            {otherMembers.map((f) => {
              const reg = registered.get(`${f.jurisdiction.toUpperCase()}|${normNum(f.number)}`);
              return (
                <div key={f.key} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-1.5 text-[13px] last:border-0">
                  <Checkbox
                    checked={reg === undefined && members.has(f.key)}
                    disabled={reg !== undefined}
                    ariaLabel={`Add ${f.jurisdiction} ${f.number}`}
                    onChange={(v) => {
                      const n = new Set(members);
                      if (v) n.add(f.key);
                      else n.delete(f.key);
                      setMembers(n);
                    }}
                    label={
                      <span className="flex items-center gap-2">
                        <JurChip code={f.jurisdiction} />
                        <span className="font-mono">{f.number}</span>
                      </span>
                    }
                  />
                  <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{f.filing_date !== '' ? `Filed ${fmtDate(f.filing_date)}` : ''}</span>
                  {f.publication !== '' && (
                    <span className="font-mono text-xs text-[var(--agent-app-muted)]">
                      {f.publication}
                      {f.kind}
                    </span>
                  )}
                  {reg !== undefined && (
                    <a className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--agent-app-accent)] hover:underline" href={href('matter', reg.id)} onClick={onNavigate}>
                      In the register as {reg.ref} <ExternalLink size={11} aria-hidden />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportSettings({
  ipType,
  imp,
  setImp,
}: {
  ipType: IpType;
  imp: ImportState;
  setImp: (f: (x: ImportState) => ImportState) => void;
}): React.JSX.Element {
  const { properties, vocab } = useApp();
  const fk = familyKindOf(ipType);
  return (
    <div className="flex flex-col gap-3">
      <FormHeading>Where it belongs</FormHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={vocab.property}
          value={imp.property}
          placeholder="None"
          options={properties.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e) => {
            const v = e.target.value;
            setImp((x) => ({ ...x, property: v }));
          }}
        />
        <UserSelect label="Responsible" value={imp.responsible} onChange={(v) => setImp((x) => ({ ...x, responsible: v }))} />
      </div>
      {fk !== null && (
        <FamilyChooser
          kind={fk}
          mode={imp.familyMode}
          allowNone={false}
          family={imp.family}
          familyTitle={imp.familyTitle}
          titleFallback=""
          onMode={(m) => setImp((x) => ({ ...x, familyMode: m === 'existing' ? 'existing' : 'new' }))}
          onFamily={(id) => setImp((x) => ({ ...x, family: id }))}
          onTitle={(t) => setImp((x) => ({ ...x, familyTitle: t }))}
        />
      )}
      <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
        <Switch checked={imp.generate} onCheckedChange={(v) => setImp((x) => ({ ...x, generate: v }))} label="Create deadlines from office events" />
        <p className="mt-1 text-xs text-[var(--agent-app-muted)]">
          Each recognised office event runs through the rules. Turn this off to record the history only and add deadlines yourself.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared form                                                         */
/* ------------------------------------------------------------------ */

function FormHeading({ children }: { children: ReactNode }): React.JSX.Element {
  return <h4 className="border-b border-[var(--agent-app-border)] pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h4>;
}

function FamilyChooser({
  kind,
  mode,
  allowNone,
  family,
  familyTitle,
  titleFallback,
  onMode,
  onFamily,
  onTitle,
}: {
  kind: FamilyKind;
  mode: FamilyMode;
  allowNone: boolean;
  family: string;
  familyTitle: string;
  titleFallback: string;
  onMode: (m: FamilyMode) => void;
  onFamily: (id: string) => void;
  onTitle: (t: string) => void;
}): React.JSX.Element {
  const label = kind === 'trademark' ? 'Group under a mark' : FAMILY_KIND_LABEL[kind];
  const opts: { value: FamilyMode; label: string }[] = [
    { value: 'new', label: kind === 'trademark' ? 'New mark' : 'New family' },
    { value: 'existing', label: kind === 'trademark' ? 'Existing mark' : 'Existing family' },
    ...(allowNone ? [{ value: 'none' as const, label: 'None' }] : []),
  ];
  return (
    <Field
      label={label}
      help={
        kind === 'trademark'
          ? 'A mark groups its filings in every country, with the mark image and word element.'
          : 'A family groups the filings for one invention or design across countries.'
      }
    >
      <div className="flex flex-col gap-2">
        <Segmented value={mode} options={opts} onChange={onMode} size="sm" ariaLabel={`${label}: new, existing or none`} />
        {mode === 'new' && (
          <Input
            aria-label={kind === 'trademark' ? 'Name of the new mark' : 'Title of the new family'}
            value={familyTitle}
            placeholder={titleFallback !== '' ? titleFallback : kind === 'trademark' ? 'The mark as it reads' : 'Family title'}
            onChange={(e) => onTitle(e.target.value)}
          />
        )}
        {mode === 'existing' && (
          <RecordPicker<FamilyRec>
            collection="families"
            value={family}
            onChange={(id) => onFamily(id)}
            labelOf={(f) => f.title}
            searchFields={['title', 'word_element']}
            filter={`kind = ${q(kind)}`}
            placeholder={kind === 'trademark' ? 'Search marks' : 'Search families'}
          />
        )}
      </div>
    </Field>
  );
}

function MatterForm({
  draft,
  set,
  preferred,
  showErrors,
}: {
  draft: MatterDraft;
  set: (patch: Partial<MatterDraft>) => void;
  preferred: string[];
  showErrors: boolean;
}): React.JSX.Element {
  const { properties, vocab } = useApp();
  const t = draft.ip_type;
  const fk = familyKindOf(t);
  const tm = t === 'trademark';
  const patentLike = isPatentLike(t);
  const us = draft.jurisdiction === 'US';
  const titleError = showErrors && draft.title.trim() === '' ? (tm ? 'Enter the mark.' : 'Enter a title.') : undefined;
  const jurError = showErrors && draft.jurisdiction === '';

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <FormHeading>The right</FormHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type"
            value={t}
            options={IP_TYPE_CHOICES.map((x) => ({ value: x, label: IP_TYPE_LABEL[x] }))}
            onChange={(e) => {
              const nt = e.target.value as IpType;
              set({
                ip_type: nt,
                route: draft.jurisdiction !== '' ? defaultRoute(nt, draft.jurisdiction) : draft.route,
                familyMode: familyKindOf(nt) === fk && draft.family !== '' ? draft.familyMode : defaultFamilyMode(nt),
                family: familyKindOf(nt) === fk ? draft.family : '',
              });
            }}
          />
          <Input
            label={tm ? 'Mark' : 'Title'}
            value={draft.title}
            error={titleError}
            placeholder={tm ? 'The mark as filed, for example STARFALL' : t === 'copyright' ? 'Title of the registered work' : 'Title of the application'}
            onChange={(e) => set({ title: e.target.value })}
          />
          <div className="flex flex-col gap-1">
            <JurisdictionSelect
              label="Office or country"
              value={draft.jurisdiction}
              preferred={preferred}
              onChange={(v) => {
                const keepRoute = draft.jurisdiction !== '' && draft.route !== defaultRoute(t, draft.jurisdiction);
                set({ jurisdiction: v, ...(keepRoute ? {} : { route: defaultRoute(t, v) }) });
              }}
            />
            {jurError && <p className="text-xs text-red-600 dark:text-red-400">Choose the office or country.</p>}
          </div>
          <Select label="Route" value={draft.route} options={toOptions(ROUTE_LABEL)} onChange={(e) => set({ route: e.target.value })} />
          <Select
            label="Status"
            value={draft.status}
            options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            onChange={(e) => set({ status: e.target.value as MatterStatus })}
          />
        </div>
        {draft.jurisdiction !== '' && (
          <p className="text-xs text-[var(--agent-app-muted)]">
            {jurisdictionName(draft.jurisdiction)}. The reference number is assigned when you create it and ends in {draft.jurisdiction}.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <FormHeading>Numbers and dates</FormHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Application number" className="font-mono" value={draft.application_no} onChange={(e) => set({ application_no: e.target.value })} />
          <DateField label="Filing date" value={draft.filing_date} onChange={(v) => set({ filing_date: v })} help="Recorded as Application filed." />
          <Input label="Publication number" className="font-mono" value={draft.publication_no} onChange={(e) => set({ publication_no: e.target.value })} />
          <DateField label="Publication date" value={draft.publication_date} onChange={(v) => set({ publication_date: v })} help="Recorded as Application published." />
          <Input
            label={patentLike ? 'Patent number' : 'Registration number'}
            className="font-mono"
            value={draft.registration_no}
            onChange={(e) => set({ registration_no: e.target.value })}
          />
          <DateField
            label={patentLike ? 'Grant date' : 'Registration date'}
            value={draft.registration_date}
            onChange={(v) => set({ registration_date: v })}
            help={patentLike ? 'Recorded as Granted.' : 'Recorded as Registered.'}
          />
        </div>
      </section>

      {tm && (
        <section className="flex flex-col gap-3">
          <FormHeading>Classes</FormHeading>
          <NiceClassChips value={draft.classes} onChange={(v) => set({ classes: v })} />
          <p className="text-xs text-[var(--agent-app-muted)]">
            {draft.classes.length === 0
              ? 'Pick the Nice classes. Add the specification of goods and services on the record after creating it.'
              : `${plural(draft.classes.length, 'class', 'classes')}: ${draft.classes.join(', ')}. Each starts as ${CLASS_STATUS_LABEL[d10(draft.registration_date) !== '' ? 'registered' : 'pending']?.toLowerCase() ?? ''}.`}
          </p>
          {us && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Filing basis" value={draft.tm_basis} placeholder="Not set" options={toOptions(TM_BASIS_LABEL)} onChange={(e) => set({ tm_basis: e.target.value })} />
              <Select label="Register" value={draft.tm_register} placeholder="Not set" options={toOptions(TM_REGISTER_LABEL)} onChange={(e) => set({ tm_register: e.target.value })} />
            </div>
          )}
        </section>
      )}

      {t !== 'copyright' && (
        <section className="flex flex-col gap-3">
          <FormHeading>Priority claims</FormHeading>
          <PriorityClaimsEditor value={draft.priority_claims} onChange={(v) => set({ priority_claims: v })} preferred={preferred} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <FormHeading>Where it belongs</FormHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={vocab.property}
            value={draft.property}
            placeholder="None"
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => set({ property: e.target.value })}
          />
          {t === 'copyright' && (
            <RecordPicker<WorkRec>
              collection="works"
              label={vocab.work}
              value={draft.work}
              onChange={(id) => set({ work: id })}
              labelOf={(w) => w.title}
              searchFields={['title']}
              placeholder={`Search ${vocab.works.toLowerCase()}`}
            />
          )}
        </div>
        {fk !== null && (
          <FamilyChooser
            kind={fk}
            mode={draft.familyMode}
            allowNone
            family={draft.family}
            familyTitle={draft.familyTitle}
            titleFallback={draft.title}
            onMode={(m) => set({ familyMode: m })}
            onFamily={(id) => set({ family: id })}
            onTitle={(v) => set({ familyTitle: v })}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <FormHeading>Ownership and people</FormHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Owner of record" value={draft.owner_of_record} onChange={(e) => set({ owner_of_record: e.target.value })} />
          <Input label="Applicants" value={draft.applicants} placeholder="Separate several with semicolons" onChange={(e) => set({ applicants: e.target.value })} />
          <Input label="Counsel" value={draft.counsel} placeholder="Outside firm or attorney" onChange={(e) => set({ counsel: e.target.value })} />
          <Input label="Client reference" className="font-mono" value={draft.client_ref} onChange={(e) => set({ client_ref: e.target.value })} />
          {patentLike && us && (
            <Select
              label="Entity size (USPTO fees)"
              value={draft.entity_size}
              placeholder="Not set"
              options={toOptions(ENTITY_SIZE_LABEL)}
              onChange={(e) => set({ entity_size: e.target.value })}
            />
          )}
          <UserSelect label="Responsible" value={draft.responsible} onChange={(v) => set({ responsible: v })} />
          <UserSelect label="Docketer" value={draft.docketer} onChange={(v) => set({ docketer: v })} />
        </div>
      </section>

      <p className="text-xs text-[var(--agent-app-muted)]">
        After creating, the record opens. Record later events there with Record what happened, and upload the documents.
      </p>
    </div>
  );
}
