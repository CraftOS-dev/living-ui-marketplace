/**
 * Creating and changing trademarks and designs: the new mark form (record
 * and family, classes, then the filing event), import from an office record
 * (JPO, USPTO TSDR, EUIPO), the edit form, and child filings (Madrid
 * designations, priority filings, divisionals).
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, Search, X } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, Textarea, toast } from '../../kit/index.ts';
import { OpError, createRecord, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, toPb, today } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, t, tn } from '../lib/i18n.ts';
import { OFFICES, OFFICE_CONNECTION_LABEL, jurisdictionName } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { FamilyRec, MatterRec } from '../lib/records.ts';
import type { Bi, PriorityClaim } from '../lib/shapes.ts';
import { CatalogSelect, JurisdictionChips, JurisdictionSelect, RecordPicker, UserSelect } from './pickers.tsx';
import { Field, Notice, Segmented } from './ui.tsx';
import { ClassSpecEditor } from './protectGoods.tsx';
import type { ClassSpec } from './protectGoods.tsx';
import { ClassPicker, DateField, MANUAL_OFFICES, classLabel, officeSource, opts } from './protectShared.tsx';

type IpType = 'trademark' | 'design';

function FormHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="mt-1 border-b border-[var(--agent-app-border)] pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h3>;
}

function defaultRoute(ipType: IpType, office: string): string {
  if (office === 'WO') return ipType === 'design' ? 'hague' : 'madrid';
  if (office === 'EM') return 'regional';
  return 'national';
}

/* ------------------------------------------------------------------ */
/* Priority claims                                                     */
/* ------------------------------------------------------------------ */

export function PriorityClaimsEditor({ value, onChange }: { value: PriorityClaim[]; onChange: (v: PriorityClaim[]) => void }): React.JSX.Element {
  const set = (i: number, patch: Partial<PriorityClaim>): void => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((c, i) => (
        <div key={i} className="grid items-end gap-2 border border-[var(--agent-app-border)] p-2 sm:grid-cols-[8rem_minmax(0,1fr)_10rem_auto]">
          <JurisdictionSelect label={t('Office')} value={c.jurisdiction} onChange={(v) => set(i, { jurisdiction: v })} />
          <Input label={t('Application number')} value={c.number} onChange={(e) => set(i, { number: e.target.value })} />
          <DateField label={t('Filing date')} value={c.date} onChange={(v) => set(i, { date: v })} />
          <Button size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => onChange(value.filter((_c, j) => j !== i))}>
            <X size={14} />
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" onClick={() => onChange([...value, { jurisdiction: '', number: '', date: '' }])}>
          <Plus size={13} aria-hidden /> {t('Add a priority claim')}
        </Button>
      </div>
    </div>
  );
}

function cleanClaims(list: PriorityClaim[]): PriorityClaim[] {
  return list
    .map((c) => ({ jurisdiction: c.jurisdiction.trim().toUpperCase(), number: c.number.trim(), date: d10(c.date) }))
    .filter((c) => c.jurisdiction !== '' || c.number !== '' || c.date !== '');
}

/* ------------------------------------------------------------------ */
/* Leak check while filing                                             */
/* ------------------------------------------------------------------ */

export interface LeakResult {
  filing_date: string;
  visible_from: string;
  announcement_date: string;
  leaks: boolean;
  safe_filing_until: string;
  text: Bi;
  note: Bi;
}

/** Runs matters/leak-check when a filing date and an announcement date are known. */
export function useLeakCheck(filing: string, announce: string, office: string): LeakResult | null {
  const [res, setRes] = useState<LeakResult | null>(null);
  useEffect(() => {
    if (d10(filing) === '' || d10(announce) === '' || office === '') {
      setRes(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      op<LeakResult>('matters/leak-check', { filing_date: d10(filing), announcement_date: d10(announce), jurisdiction: office })
        .then((r) => {
          if (!cancelled) setRes(r);
        })
        .catch(() => {
          if (!cancelled) setRes(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filing, announce, office]);
  return res;
}

export function LeakNotice({ res }: { res: LeakResult }): React.JSX.Element {
  return (
    <Notice tone={res.leaks ? 'bad' : 'good'}>
      <div className="font-medium">{res.leaks ? t('This filing may reveal the title before the announcement.') : t('No leak expected.')}</div>
      <div>{bi(res.text)}</div>
      <div className="mt-1 text-xs text-[var(--agent-app-muted)]">{bi(res.note)}</div>
    </Notice>
  );
}

/* ------------------------------------------------------------------ */
/* New mark                                                            */
/* ------------------------------------------------------------------ */

export function NewMarkDialog({ onClose, family }: { onClose: () => void; family?: FamilyRec | undefined }): React.JSX.Element {
  const { me, on, characters, franchises, talents } = useApp();
  const [ipType, setIpType] = useState<IpType>(family?.kind === 'design' ? 'design' : 'trademark');
  const [office, setOffice] = useState('JP');
  const [title, setTitle] = useState(family !== undefined ? family.word_element || family.title : '');
  const [markType, setMarkType] = useState<string>(family?.mark_type || 'word');
  const [famMode, setFamMode] = useState<'new' | 'existing'>(family !== undefined ? 'existing' : 'new');
  const [familyId, setFamilyId] = useState(family?.id ?? '');
  const [familyTitle, setFamilyTitle] = useState('');
  const [franchise, setFranchise] = useState(family?.franchise ?? '');
  const [character, setCharacter] = useState(family?.character ?? '');
  const [talent, setTalent] = useState(family?.talent ?? '');
  const [route, setRoute] = useState('national');
  const [routeTouched, setRouteTouched] = useState(false);
  const [appNo, setAppNo] = useState('');
  const [filing, setFiling] = useState('');
  const [claims, setClaims] = useState<PriorityClaim[]>([]);
  const [owner, setOwner] = useState('');
  const [classes, setClasses] = useState<ClassSpec[]>([]);
  const [responsible, setResponsible] = useState(me?.id ?? '');
  const [registered, setRegistered] = useState(false);
  const [regNo, setRegNo] = useState('');
  const [regDate, setRegDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!routeTouched) setRoute(defaultRoute(ipType, office));
  }, [ipType, office, routeTouched]);

  // The announcement date of what the mark is for (character, then franchise).
  const announce = useMemo(() => {
    const c = characters.find((x) => x.id === character);
    if (c !== undefined && d10(c.announcement_date) !== '') return d10(c.announcement_date);
    const f = franchises.find((x) => x.id === franchise);
    if (f !== undefined && d10(f.announcement_date) !== '') return d10(f.announcement_date);
    return '';
  }, [characters, franchises, character, franchise]);
  const leak = useLeakCheck(filing !== '' ? filing : announce !== '' ? today() : '', announce, office);

  const tm = ipType === 'trademark';
  const valid = title.trim() !== '' && office !== '' && (famMode === 'new' || familyId !== '');

  const save = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    try {
      let fam = familyId;
      if (famMode === 'new') {
        const f = await createRecord<FamilyRec>('families', {
          kind: ipType,
          title: familyTitle.trim() || title.trim(),
          mark_type: tm ? markType : '',
          word_element: tm && (markType === 'word' || markType === 'combined') ? title.trim() : '',
          franchise,
          character,
          talent,
          strategy: 'maintain',
          announcement_date: toPb(announce),
        });
        fam = f.id;
      }
      const claimList = cleanClaims(claims);
      const m = await createRecord<MatterRec>('matters', {
        ip_type: ipType,
        title: title.trim(),
        jurisdiction: office,
        family: fam,
        franchise,
        character,
        talent,
        route,
        relation: claimList.length > 0 ? 'priority' : 'none',
        application_no: appNo.trim(),
        filing_date: toPb(filing),
        registration_no: registered ? regNo.trim() : '',
        priority_claims: claimList,
        owner_of_record: owner.trim(),
        responsible,
        status: d10(filing) !== '' ? 'filed' : 'to_file',
        sync_enabled: true,
      });
      if (tm) {
        for (const c of classes) {
          await createRecord('goods_services', { matter: m.id, nice_class: c.nice_class, spec: c.spec.trim(), class_status: registered && d10(regDate) !== '' ? 'registered' : 'pending' });
        }
      }
      let created = 0;
      if (d10(filing) !== '') {
        const r = await op<{ created: unknown[] }>('events/record', { subject_type: 'matter', subject_id: m.id, code: 'FILED', date: d10(filing) });
        created += r.created.length;
      }
      if (registered && d10(regDate) !== '') {
        const r = await op<{ created: unknown[] }>('events/record', { subject_type: 'matter', subject_id: m.id, code: 'REGISTERED', date: d10(regDate) });
        created += r.created.length;
      }
      toast.success(created > 0 ? tn(created, 'Saved. {n} deadline created.', 'Saved. {n} deadlines created.') : t('Saved'));
      onClose();
      navigate('matter', m.id);
    } catch (err) {
      // Record writes toast their own errors; ops do not.
      if (err instanceof OpError) toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tm ? t('New trademark') : t('New design')}
      description={t('Enter what was filed. The filing date records the filing and creates the deadlines that follow.')}
      className="w-[min(94vw,46rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!valid}>
            {t('Create')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<IpType>
            value={ipType}
            onChange={setIpType}
            ariaLabel={t('Type')}
            options={[
              { value: 'trademark', label: enumLabel('matters.ip_type', 'trademark') },
              { value: 'design', label: enumLabel('matters.ip_type', 'design') },
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <JurisdictionSelect label={t('Office')} value={office} onChange={setOffice} officesOnly />
          <Select
            label={t('Route')}
            value={route}
            options={opts(enumOptions('matters.route'))}
            onChange={(e) => {
              setRouteTouched(true);
              setRoute(e.target.value);
            }}
          />
        </div>
        {MANUAL_OFFICES.includes(office) && <Notice>{t('{office} has no office data feed here. Keep this record up to date by hand from the office letters.', { office: jurisdictionName(office) })}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={tm ? t('Mark') : t('Design title')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tm ? t('The words of the mark, or a name for a logo') : t('For example: character figure, front view')} required />
          {tm && famMode === 'new' && <Select label={t('Mark type')} value={markType} options={opts(enumOptions('families.mark_type'))} onChange={(e) => setMarkType(e.target.value)} />}
        </div>

        <FormHeading>{t('Family')}</FormHeading>
        <div className="flex flex-col gap-2">
          <Segmented<'new' | 'existing'>
            size="sm"
            value={famMode}
            onChange={setFamMode}
            options={[
              { value: 'new', label: t('Start a new family') },
              { value: 'existing', label: t('Add to an existing family') },
            ]}
          />
          {famMode === 'new' ? (
            <Input label={t('Family title')} value={familyTitle} onChange={(e) => setFamilyTitle(e.target.value)} placeholder={title.trim() || t('Same as the mark')} />
          ) : (
            <RecordPicker<FamilyRec>
              collection="families"
              label={t('Family')}
              value={familyId}
              onChange={(id) => setFamilyId(id)}
              labelOf={(f) => f.title}
              searchFields={['title', 'word_element', 'transliteration']}
              filter={`kind = "${ipType}"`}
            />
          )}
          <p className="text-xs text-[var(--agent-app-muted)]">{t('A family groups the filings of one mark or design across offices.')}</p>
        </div>

        {(on('franchises') || on('talents')) && (
          <>
            <FormHeading>{t('What it protects')}</FormHeading>
            <div className="grid gap-3 sm:grid-cols-3">
              {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={franchise} onChange={setFranchise} />}
              {on('franchises') && <CatalogSelect kind="character" label={t('Character')} value={character} onChange={setCharacter} />}
              {on('talents') && <CatalogSelect kind="talent" label={t('Talent')} value={talent} onChange={setTalent} />}
            </div>
            {talents.length === 0 && characters.length === 0 && franchises.length === 0 && <p className="text-xs text-[var(--agent-app-muted)]">{t('Link it later from the edit form once the character or talent is in the catalogue.')}</p>}
          </>
        )}

        <FormHeading>{t('Filing')}</FormHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Application number')} value={appNo} onChange={(e) => setAppNo(e.target.value)} className="font-mono" />
          <DateField label={t('Filing date')} value={filing} onChange={setFiling} help={t('Leave empty while the filing is still being prepared.')} />
          <Input label={t('Owner of record')} value={owner} onChange={(e) => setOwner(e.target.value)} />
          <UserSelect label={t('Responsible')} value={responsible} onChange={setResponsible} />
        </div>
        {leak !== null && <LeakNotice res={leak} />}
        <Field label={t('Priority claims')}>
          <PriorityClaimsEditor value={claims} onChange={setClaims} />
        </Field>
        <div className="flex flex-col gap-2">
          <Switch checked={registered} onCheckedChange={setRegistered} label={t('Already registered')} />
          {registered && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('Registration number')} value={regNo} onChange={(e) => setRegNo(e.target.value)} className="font-mono" />
              <DateField label={t('Registration date')} value={regDate} onChange={setRegDate} />
            </div>
          )}
        </div>

        {tm && (
          <>
            <FormHeading>{t('Classes and specifications')}</FormHeading>
            <ClassSpecEditor value={classes} onChange={setClasses} />
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Import from an office record                                        */
/* ------------------------------------------------------------------ */

interface Snapshot {
  source: string;
  number: string;
  found: boolean;
  title: string;
  status_text: string;
  filing_date: string;
  publication_no: string;
  registration_no: string;
  registration_date: string;
  expiry_date: string;
  owner: string;
  classes: { nice_class: number; spec?: string }[];
  events: { code: string; date: string; label?: string }[];
  lag_note: string;
}

type LookupResult = { available: false; reason: string; reason_ja: string } | { available: true; source: string; snapshot: Snapshot; existing: { id: string; ref: string }[] };

export function ImportOfficeDialog({ onClose, onManual }: { onClose: () => void; onManual: () => void }): React.JSX.Element {
  const { meta, me, can, on } = useApp();
  const [ipType, setIpType] = useState<IpType>('trademark');
  const [office, setOffice] = useState('JP');
  const [number, setNumber] = useState('');
  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [famMode, setFamMode] = useState<'new' | 'existing'>('new');
  const [familyId, setFamilyId] = useState('');
  const [familyTitle, setFamilyTitle] = useState('');
  const [franchise, setFranchise] = useState('');
  const [character, setCharacter] = useState('');
  const [talent, setTalent] = useState('');
  const [responsible, setResponsible] = useState(me?.id ?? '');
  const [generate, setGenerate] = useState(true);
  const [busy, setBusy] = useState(false);

  const source = officeSource(ipType, office);
  const conn = source !== '' ? meta?.offices[source] : undefined;
  const manual = MANUAL_OFFICES.includes(office) || source === '';

  useEffect(() => setResult(null), [ipType, office, number]);

  const lookup = async (): Promise<void> => {
    if (number.trim() === '') return;
    setLooking(true);
    try {
      const r = await op<LookupResult>('matters/lookup', { ip_type: ipType, jurisdiction: office, number: number.trim() });
      setResult(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLooking(false);
    }
  };

  const doImport = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ id: string; ref: string; deadlines: number }>('matters/import-office', {
        ip_type: ipType,
        jurisdiction: office,
        number: number.trim(),
        family_id: famMode === 'existing' ? familyId : '',
        family_title: famMode === 'new' ? familyTitle.trim() : '',
        franchise_id: franchise,
        character_id: character,
        talent_id: talent,
        responsible,
        generate,
      });
      toast.success(tn(r.deadlines, 'Imported {ref}. {n} deadline created.', 'Imported {ref}. {n} deadlines created.', { ref: r.ref }));
      onClose();
      navigate('matter', r.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const snap = result !== null && result.available ? result.snapshot : null;
  const dup = result !== null && result.available ? result.existing : [];
  const canImport = snap !== null && snap.found && dup.length === 0 && (famMode === 'new' || familyId !== '');

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Import from the office')}
      description={t('Look up a filing by its number at JPO, USPTO (TSDR) or EUIPO and create it with its classes, history and deadlines.')}
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          {snap !== null ? (
            <Button onClick={() => void doImport()} loading={busy} disabled={!canImport}>
              <Download size={14} aria-hidden /> {t('Import')}
            </Button>
          ) : (
            <Button onClick={() => void lookup()} loading={looking} disabled={number.trim() === '' || manual}>
              <Search size={14} aria-hidden /> {t('Look up')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
        <Segmented<IpType>
          value={ipType}
          onChange={setIpType}
          ariaLabel={t('Type')}
          options={[
            { value: 'trademark', label: enumLabel('matters.ip_type', 'trademark') },
            { value: 'design', label: enumLabel('matters.ip_type', 'design') },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <JurisdictionSelect label={t('Office')} value={office} onChange={setOffice} officesOnly />
          <Input
            label={t('Application or registration number')}
            value={number}
            className="font-mono"
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !manual) void lookup();
            }}
          />
        </div>

        {manual ? (
          <Notice>
            <div>
              {MANUAL_OFFICES.includes(office)
                ? t('{office} records are entered by hand: this app has no office data feed for them.', { office: jurisdictionName(office) })
                : t('There is no office data feed for {office} {type} records. Enter it by hand.', { office: jurisdictionName(office), type: enumLabel('matters.ip_type', ipType) })}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={onManual}>
              <Plus size={13} aria-hidden /> {t('Enter it by hand')}
            </Button>
          </Notice>
        ) : conn !== undefined && !conn.enabled ? (
          <Notice tone="warn">
            {t('{office} is not connected. Credentials are optional; an admin connects it in Settings. Until then, enter the record by hand.', { office: OFFICE_CONNECTION_LABEL[source] ?? source })}{' '}
            {can.admin && (
              <a href={href('settings', undefined, { tab: 'offices' })} className="font-medium text-[var(--agent-app-accent)] hover:underline">
                {t('Open Settings')}
              </a>
            )}
          </Notice>
        ) : null}

        {result !== null && !result.available && <Notice tone="warn">{bi({ en: result.reason, ja: result.reason_ja })}</Notice>}

        {snap !== null && !snap.found && <Notice tone="warn">{t('The office has no record for {number}. Check the number and its format.', { number: number.trim() })}</Notice>}

        {snap !== null && snap.found && (
          <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 break-words text-[15px] font-semibold">{snap.title || number}</span>
              <span className="text-xs text-[var(--agent-app-muted)]">{snap.source}</span>
            </div>
            <div className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
              <span>
                <span className="text-[var(--agent-app-muted)]">{t('Office status')}: </span>
                {snap.status_text || '-'}
              </span>
              <span>
                <span className="text-[var(--agent-app-muted)]">{t('Filing date')}: </span>
                {fmtDate(snap.filing_date) || '-'}
              </span>
              <span>
                <span className="text-[var(--agent-app-muted)]">{t('Registration number')}: </span>
                <span className="font-mono">{snap.registration_no || '-'}</span>
              </span>
              <span>
                <span className="text-[var(--agent-app-muted)]">{t('Registration date')}: </span>
                {fmtDate(snap.registration_date) || '-'}
              </span>
              <span className="sm:col-span-2">
                <span className="text-[var(--agent-app-muted)]">{t('Owner of record')}: </span>
                {snap.owner || '-'}
              </span>
              {snap.classes.length > 0 && (
                <span className="sm:col-span-2">
                  <span className="text-[var(--agent-app-muted)]">{t('Classes')}: </span>
                  <span className="font-mono">{snap.classes.map((c) => c.nice_class).join(', ')}</span>
                </span>
              )}
              <span className="sm:col-span-2 text-xs text-[var(--agent-app-muted)]">{tn(snap.events.length, '{n} event in the office history', '{n} events in the office history')}</span>
            </div>
            {snap.lag_note !== '' && <p className="text-xs text-[var(--agent-app-muted)]">{snap.lag_note}</p>}
            {dup.length > 0 && (
              <Notice tone="warn">
                {t('Already in the register:')}{' '}
                {dup.map((d) => (
                  <a key={d.id} href={href('matter', d.id)} className="mr-2 font-mono font-medium text-[var(--agent-app-accent)] hover:underline">
                    {d.ref}
                  </a>
                ))}
              </Notice>
            )}
          </div>
        )}

        {snap !== null && snap.found && dup.length === 0 && (
          <>
            <FormHeading>{t('Family')}</FormHeading>
            <Segmented<'new' | 'existing'>
              size="sm"
              value={famMode}
              onChange={setFamMode}
              options={[
                { value: 'new', label: t('Start a new family') },
                { value: 'existing', label: t('Add to an existing family') },
              ]}
            />
            {famMode === 'new' ? (
              <Input label={t('Family title')} value={familyTitle} onChange={(e) => setFamilyTitle(e.target.value)} placeholder={snap.title || number} />
            ) : (
              <RecordPicker<FamilyRec> collection="families" label={t('Family')} value={familyId} onChange={(id) => setFamilyId(id)} labelOf={(f) => f.title} searchFields={['title', 'word_element']} filter={`kind = "${ipType}"`} />
            )}
            {(on('franchises') || on('talents')) && (
              <div className="grid gap-3 sm:grid-cols-3">
                {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={franchise} onChange={setFranchise} />}
                {on('franchises') && <CatalogSelect kind="character" label={t('Character')} value={character} onChange={setCharacter} />}
                {on('talents') && <CatalogSelect kind="talent" label={t('Talent')} value={talent} onChange={setTalent} />}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <UserSelect label={t('Responsible')} value={responsible} onChange={setResponsible} />
              <div className="flex items-end pb-2">
                <Switch checked={generate} onCheckedChange={setGenerate} label={t('Create deadlines from the office history')} />
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

const DATE_FIELDS = ['filing_date', 'publication_date', 'registration_date'] as const;

export function MatterEditDialog({ matter: m, onClose, onSaved }: { matter: MatterRec; onClose: () => void; onSaved: (datesChanged: boolean) => void }): React.JSX.Element {
  const { on } = useApp();
  const [f, setF] = useState({
    title: m.title,
    family: m.family,
    franchise: m.franchise,
    character: m.character,
    talent: m.talent,
    work: m.work,
    route: m.route,
    relation: m.relation,
    application_no: m.application_no,
    filing_date: d10(m.filing_date),
    publication_no: m.publication_no,
    publication_date: d10(m.publication_date),
    registration_no: m.registration_no,
    registration_date: d10(m.registration_date),
    status: m.status,
    tm_register: m.tm_register,
    tm_basis: m.tm_basis,
    owner_of_record: m.owner_of_record,
    applicants: m.applicants,
    counsel: m.counsel,
    client_ref: m.client_ref,
    cost_center: m.cost_center,
    responsible: m.responsible,
    docketer: m.docketer,
    sync_enabled: m.sync_enabled,
    announcement_date: d10(m.announcement_date),
    notes: m.notes,
  });
  const [claims, setClaims] = useState<PriorityClaim[]>(m.priority_claims ?? []);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => setF((x) => ({ ...x, [k]: v }));
  const tm = m.ip_type === 'trademark';

  const save = async (): Promise<void> => {
    if (f.title.trim() === '') return;
    setBusy(true);
    try {
      await updateRecord<MatterRec>('matters', m.id, {
        ...f,
        title: f.title.trim(),
        filing_date: toPb(f.filing_date),
        publication_date: toPb(f.publication_date),
        registration_date: toPb(f.registration_date),
        announcement_date: toPb(f.announcement_date),
        priority_claims: cleanClaims(claims),
      });
      toast.success(t('Saved'));
      const changed = DATE_FIELDS.some((k) => d10(m[k]) !== d10(f[k]));
      onSaved(changed);
      onClose();
    } catch {
      /* the client showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Edit {ref}', { ref: m.ref })}
      description={t('Correct the record. To record something that happened (an office action, registration, renewal), use Record event so the deadlines follow.')}
      className="w-[min(94vw,46rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={f.title.trim() === ''}>
            {t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={tm ? t('Mark') : t('Design title')} value={f.title} onChange={(e) => set('title', e.target.value)} />
        <RecordPicker<FamilyRec> collection="families" label={t('Family')} value={f.family} onChange={(id) => set('family', id)} labelOf={(x) => x.title} searchFields={['title', 'word_element']} filter={`kind = "${m.ip_type}"`} />
        {(on('franchises') || on('talents') || on('titles')) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={f.franchise} onChange={(v) => set('franchise', v)} />}
            {on('franchises') && <CatalogSelect kind="character" label={t('Character')} value={f.character} onChange={(v) => set('character', v)} />}
            {on('talents') && <CatalogSelect kind="talent" label={t('Talent')} value={f.talent} onChange={(v) => set('talent', v)} />}
            {on('titles') && <CatalogSelect kind="work" label={t('Title')} value={f.work} onChange={(v) => set('work', v)} />}
          </div>
        )}

        <FormHeading>{t('Office data')}</FormHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Application number')} value={f.application_no} className="font-mono" onChange={(e) => set('application_no', e.target.value)} />
          <DateField label={t('Filing date')} value={f.filing_date} onChange={(v) => set('filing_date', v)} />
          <Input label={t('Publication number')} value={f.publication_no} className="font-mono" onChange={(e) => set('publication_no', e.target.value)} />
          <DateField label={t('Publication date')} value={f.publication_date} onChange={(v) => set('publication_date', v)} />
          <Input label={t('Registration number')} value={f.registration_no} className="font-mono" onChange={(e) => set('registration_no', e.target.value)} />
          <DateField label={t('Registration date')} value={f.registration_date} onChange={(v) => set('registration_date', v)} />
          <Select label={t('Status')} value={f.status} options={opts(enumOptions('matters.status'))} onChange={(e) => set('status', e.target.value as MatterRec['status'])} />
          <Select label={t('Route')} value={f.route} options={opts(enumOptions('matters.route'))} onChange={(e) => set('route', e.target.value as MatterRec['route'])} />
          <Select label={t('Relation to the parent filing')} value={f.relation} options={opts(enumOptions('matters.relation'))} onChange={(e) => set('relation', e.target.value as MatterRec['relation'])} />
          {tm && m.jurisdiction === 'US' && (
            <>
              <Select label={t('Register|us')} value={f.tm_register} placeholder={t('Not set')} options={opts(enumOptions('matters.tm_register'))} onChange={(e) => set('tm_register', e.target.value as MatterRec['tm_register'])} />
              <Input label={t('Filing basis')} value={f.tm_basis} onChange={(e) => set('tm_basis', e.target.value)} placeholder="1(a), 1(b), 44(e), 66(a)" />
            </>
          )}
        </div>
        <Field label={t('Priority claims')}>
          <PriorityClaimsEditor value={claims} onChange={setClaims} />
        </Field>

        <FormHeading>{t('People and owner')}</FormHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Owner of record')} value={f.owner_of_record} onChange={(e) => set('owner_of_record', e.target.value)} />
          <Input label={t('Applicants')} value={f.applicants} onChange={(e) => set('applicants', e.target.value)} />
          <Input label={t('Counsel')} value={f.counsel} onChange={(e) => set('counsel', e.target.value)} />
          <Input label={t('Client reference')} value={f.client_ref} onChange={(e) => set('client_ref', e.target.value)} />
          <Input label={t('Cost center')} value={f.cost_center} onChange={(e) => set('cost_center', e.target.value)} />
          <UserSelect label={t('Responsible')} value={f.responsible} onChange={(v) => set('responsible', v)} />
          <UserSelect label={t('Docketer')} value={f.docketer} onChange={(v) => set('docketer', v)} />
          <DateField label={t('Announcement date')} value={f.announcement_date} onChange={(v) => set('announcement_date', v)} help={t('When the title or character is announced. Used for the leak check.')} />
        </div>
        <Switch checked={f.sync_enabled} onCheckedChange={(v) => set('sync_enabled', v)} label={t('Check with the office automatically')} />
        <Textarea label={t('Notes')} rows={4} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Designate: child filings                                            */
/* ------------------------------------------------------------------ */

export function DesignateDialog({ matter: m, classes, onClose }: { matter: MatterRec; classes: number[]; onClose: () => void }): React.JSX.Element {
  const [relation, setRelation] = useState('designation');
  const [offices, setOffices] = useState<string[]>([]);
  const [keep, setKeep] = useState<number[]>(classes);
  const [filing, setFiling] = useState(today());
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; ref: string; jurisdiction: string }[] | null>(null);
  const choices = OFFICES.filter((o) => o !== m.jurisdiction && (relation !== 'designation' || o !== 'WO'));
  const noClasses = classes.length > 0 && keep.length === 0;

  const submit = async (): Promise<void> => {
    if (offices.length === 0 || noClasses) return;
    setBusy(true);
    try {
      const r = await op<{ created: { id: string; ref: string; jurisdiction: string }[]; deadlines: number }>('matters/designate', {
        matter_id: m.id,
        relation,
        jurisdictions: offices,
        classes: keep.length === classes.length ? [] : keep,
        filing_date: relation === 'designation' ? '' : d10(filing),
      });
      toast.success(tn(r.created.length, '{n} filing created', '{n} filings created'));
      setCreated(r.created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const relationOptions = [
    { value: 'designation', label: enumLabel('matters.relation', 'designation') },
    { value: 'priority', label: enumLabel('matters.relation', 'priority') },
    { value: 'divisional', label: enumLabel('matters.relation', 'divisional') },
    { value: 'related', label: enumLabel('matters.relation', 'related') },
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('New filings from {ref}', { ref: m.ref })}
      description={t('Creates one filing per office in the same family, with the classes you keep, and records the filing.')}
      className="w-[min(94vw,40rem)]"
      footer={
        created !== null ? (
          <Button onClick={onClose}>{t('Close')}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={offices.length === 0 || noClasses}>
              {tn(offices.length, 'Create {n} filing', 'Create {n} filings')}
            </Button>
          </>
        )
      }
    >
      {created !== null ? (
        <div className="flex flex-col gap-2">
          {created.map((c) => (
            <a key={c.id} href={href('matter', c.id)} className="flex items-center gap-2 border border-[var(--agent-app-border)] px-3 py-2 text-[13px] hover:bg-[var(--agent-app-border)]/20" onClick={onClose}>
              <span className="font-mono font-semibold">{c.jurisdiction}</span>
              <span className="font-mono">{c.ref}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          <Select label={t('Relation')} value={relation} options={relationOptions} onChange={(e) => setRelation(e.target.value)} />
          {relation === 'designation' && m.route !== 'madrid' && m.jurisdiction !== 'WO' && (
            <Notice tone="warn">{t('Madrid designations come from an international registration. This filing is not on the Madrid route.')}</Notice>
          )}
          <Field label={t('Offices')}>
            <JurisdictionChips value={offices} onChange={setOffices} options={choices} />
          </Field>
          {classes.length > 0 && (
            <Field label={t('Classes to keep')} help={t('Untick classes the new filings should leave out.')} error={noClasses ? t('Keep at least one class.') : undefined}>
              <ClassPicker value={keep} onChange={setKeep} options={classes} />
            </Field>
          )}
          {relation === 'designation' ? (
            <p className="text-xs text-[var(--agent-app-muted)]">
              {t('Designations take the international registration date: {date}.', { date: fmtDate(m.registration_date) || fmtDate(m.filing_date) || t('Not set') })}
            </p>
          ) : (
            <DateField label={t('Filing date')} value={filing} onChange={setFiling} />
          )}
          {keep.length > 0 && keep.length < classes.length && <p className="text-xs text-[var(--agent-app-muted)]">{keep.map(classLabel).join(', ')}</p>}
        </div>
      )}
    </Dialog>
  );
}
