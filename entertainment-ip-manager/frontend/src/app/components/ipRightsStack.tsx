/**
 * A character's rights stack: each separately owned layer (name, logo,
 * design sheet, standing art, outfits, Live2D and 3D models, emotes, voice,
 * persona and lore, jingle), who made it, how it was acquired, and what is
 * wrong with it (characters/chain): assignments that do not name Arts. 27
 * and 28 (Art. 61(2)), no non-exercise of moral rights (Art. 20), licences
 * ending, payments overdue and the Freelance Act for individual creators.
 */
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Layers, Paperclip, Pencil, Plus, ShieldAlert, X } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { createRecord, fileUrl, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { d10, fmtDate, toPb } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, joinList, t, tn } from '../lib/i18n.ts';
import { CURRENCIES, LEVEL_TONE } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { AgreementRec, CharacterAssetRec, CharacterRec, PartyRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { PartyPicker, RecordPicker } from './pickers.tsx';
import { DateField, RowsEditor, SimpleTable, asRows, yesNo } from './ipShared.tsx';
import type { EditRow, SimpleCol } from './ipShared.tsx';
import { Checkbox, EmptyHint, EnumPill, ErrorBox, Field, Loading, Notice, Pill, Section, Tag, TONE_TEXT } from './ui.tsx';

interface ChainIssue {
  level: 'warn' | 'block';
  text: Bi;
}
interface ChainLayer {
  id: string;
  component: string;
  label: string;
  version: string;
  acquisition: string;
  creator: string;
  agreement: string;
  status: string;
  derived_from: string;
  issues: ChainIssue[];
}
interface ChainResponse {
  character: { id: string; name: string; ownership_model: string };
  layers: ChainLayer[];
  missing_components: string[];
  verdict: 'blocked' | 'attention' | 'clear';
}

interface ReworkRow {
  date: string;
  description: string;
  paid: boolean;
}

const COMPONENT_ORDER = ['name', 'logo', 'design_sheet', 'standing_art', 'outfit', 'live2d_model', 'model_3d', 'emote', 'voice', 'persona_lore', 'jingle', 'other'];
const LICENCES = new Set(['exclusive_license', 'nonexclusive_license']);

function order(c: string): number {
  const i = COMPONENT_ORDER.indexOf(c);
  return i < 0 ? 99 : i;
}

export function RightsStack({ character }: { character: CharacterRec }): React.JSX.Element {
  const { can } = useApp();
  const assets = useCollection<CharacterAssetRec>('character_assets', { filter: `character = ${q(character.id)}`, sort: 'created', expand: 'creator,agreement' });
  const chain = useLiveAsync(() => op<ChainResponse>('characters/chain', { character_id: character.id }), [character.id], ['character_assets', 'parties', 'agreements']);
  const [editing, setEditing] = useState<CharacterAssetRec | 'new' | null>(null);

  const rows = useMemo(() => assets.records.slice().sort((a, b) => order(a.component) - order(b.component) || a.created.localeCompare(b.created)), [assets.records]);
  const issuesOf = useMemo(() => new Map((chain.data?.layers ?? []).map((l) => [l.id, l.issues])), [chain.data]);
  const byId = useMemo(() => new Map(assets.records.map((a) => [a.id, a])), [assets.records]);

  const flagged = (chain.data?.layers ?? []).filter((l) => l.issues.length > 0);
  const blocked = flagged.filter((l) => l.issues.some((i) => i.level === 'block')).length;
  const attention = flagged.length - blocked;
  const missing = chain.data?.missing_components ?? [];

  const addButton = can.edit ? (
    <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
      <Plus size={13} aria-hidden /> {t('Add a layer')}
    </Button>
  ) : undefined;

  const layerCell = (a: CharacterAssetRec): React.JSX.Element => {
    const base = a.derived_from !== '' ? byId.get(a.derived_from) : undefined;
    return (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag>{enumLabel('character_assets.component', a.component)}</Tag>
          <span className="font-medium">{a.label}</span>
          {a.version !== '' && <span className="font-mono text-[11.5px] text-[var(--agent-app-muted)]">{a.version}</span>}
        </div>
        {base !== undefined && <div className="mt-0.5 text-xs text-[var(--agent-app-muted)]">{t('Based on {layer}', { layer: base.label })}</div>}
      </div>
    );
  };

  const creatorOf = (a: CharacterAssetRec): string => (a.expand?.['creator'] as PartyRec | undefined)?.name ?? '';

  const cols: SimpleCol<CharacterAssetRec>[] = [
    { key: 'layer', label: t('Layer|rights stack'), render: layerCell },
    {
      key: 'creator',
      label: t('Creator|layer'),
      render: (a) => (a.creator !== '' ? <a href={href('people', a.creator)} className="hover:underline" onClick={(e) => e.stopPropagation()}>{creatorOf(a) || t('Open|action')}</a> : <span className="text-[var(--agent-app-muted)]">{t('Not set')}</span>),
    },
    { key: 'acq', label: t('Acquired by'), render: (a) => (a.acquisition !== '' ? enumLabel('character_assets.acquisition', a.acquisition) : <span className="text-[var(--agent-app-muted)]">{t('Not recorded')}</span>) },
    {
      key: 'art',
      label: t('Arts. 27 and 28 named|layer'),
      className: 'hidden lg:table-cell',
      render: (a) => (a.acquisition === 'assignment' ? <span className={cn(!a.art27_28 && TONE_TEXT.bad)}>{yesNo(a.art27_28)}</span> : <span className="text-[var(--agent-app-muted)]" title={t('Only meaningful for assignments')}>-</span>),
    },
    {
      key: 'moral',
      label: t('Non-exercise of moral rights'),
      className: 'hidden lg:table-cell',
      render: (a) => (a.acquisition === 'owned_original' || a.acquisition === 'work_for_hire' ? <span className="text-[var(--agent-app-muted)]">-</span> : <span className={cn(!a.moral_rights_waiver && TONE_TEXT.warn)}>{yesNo(a.moral_rights_waiver)}</span>),
    },
    { key: 'status', label: t('Status'), render: (a) => <EnumPill field="character_assets.status" value={a.status} /> },
    {
      key: 'edit',
      label: '',
      align: 'right',
      render: (a) => (
        <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can.edit && (
            <Button size="icon" variant="ghost" className="size-7" aria-label={t('Edit {name}', { name: a.label })} onClick={() => setEditing(a)}>
              <Pencil size={13} aria-hidden />
            </Button>
          )}
          <DeleteButton collection="character_assets" id={a.id} iconOnly />
        </span>
      ),
    },
  ];

  const issueLines = (a: CharacterAssetRec): React.JSX.Element | null => {
    const issues = issuesOf.get(a.id) ?? [];
    const lic = d10(a.license_end);
    const pay = d10(a.payment_due);
    const facts = a.agreement !== '' || (lic !== '' && LICENCES.has(a.acquisition)) || pay !== '' || a.territory_limit !== '' || a.files.length > 0;
    if (issues.length === 0 && !facts) return null;
    const ag = a.expand?.['agreement'] as AgreementRec | undefined;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--agent-app-muted)]">
          {a.agreement !== '' && (
            <a href={href('agreement', a.agreement)} className="hover:underline">
              {t('Agreement: {title}', { title: ag?.ref || ag?.title || t('Open|action') })}
            </a>
          )}
          {lic !== '' && LICENCES.has(a.acquisition) && <span>{t('Licence ends {date}', { date: fmtDate(lic) })}</span>}
          {pay !== '' && <span>{d10(a.paid_date) !== '' ? t('Paid {date}', { date: fmtDate(a.paid_date) }) : t('Payment due {date}', { date: fmtDate(pay) })}</span>}
          {a.territory_limit !== '' && <span>{t('Territory: {place}', { place: a.territory_limit })}</span>}
          {a.files.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip size={11} aria-hidden /> {tn(a.files.length, '{n} file', '{n} files')}
            </span>
          )}
        </div>
        {issues.map((i, k) => (
          <div key={k} className="flex flex-wrap items-start gap-1.5 text-[12.5px] sm:flex-nowrap">
            <Pill tone={LEVEL_TONE[i.level] ?? 'warn'} className="shrink-0">
              {i.level === 'block' ? <ShieldAlert size={11} aria-hidden /> : <AlertTriangle size={11} aria-hidden />}
              {i.level === 'block' ? t('Blocks use') : t('Needs attention')}
            </Pill>
            <span className="min-w-0 break-words">{bi(i.text)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {chain.error !== null && chain.data === null ? (
        <ErrorBox message={chain.error} onRetry={chain.reload} />
      ) : chain.data !== null ? (
        <Notice tone={chain.data.verdict === 'blocked' ? 'bad' : chain.data.verdict === 'attention' ? 'warn' : 'good'} icon={chain.data.verdict === 'clear' ? CheckCircle2 : AlertTriangle}>
          <div className="flex flex-col gap-1">
            <span className="font-medium">
              {chain.data.verdict === 'clear'
                ? t('The chain of rights is clear: every layer is acquired and documented.')
                : joinList([blocked > 0 ? tn(blocked, '{n} layer blocks use', '{n} layers block use') : '', attention > 0 ? tn(attention, '{n} needs attention', '{n} need attention') : ''].filter((x) => x !== '')) ||
                  t('Some expected layers are not on file.')}
            </span>
            {missing.length > 0 && (
              <span>
                {t('Not on file yet: {list}', { list: joinList(missing.map((m) => enumLabel('character_assets.component', m))) })}
              </span>
            )}
            {chain.data.verdict !== 'clear' && <span className="text-xs text-[var(--agent-app-muted)]">{t('Without every layer cleared, a licence of this character may promise rights we do not hold.')}</span>}
          </div>
        </Notice>
      ) : null}

      <Section title={t('Rights stack')} meta={rows.length > 0 ? String(rows.length) : undefined} actions={addButton} flush>
        {assets.loading && assets.records.length === 0 ? (
          <Loading />
        ) : assets.error !== null && assets.records.length === 0 ? (
          <div className="p-4">
            <ErrorBox message={assets.error} onRetry={assets.refresh} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyHint
            compact
            icon={Layers}
            title={t('No layers recorded yet')}
            message={t('Add each part of the character that someone made: name and logo, design sheet, standing art, outfits, Live2D and 3D models, emotes, voice, persona and lore, jingle. Record who made it and how we acquired it.')}
            action={addButton}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <SimpleTable rows={rows} cols={cols} subRow={issueLines} onRowClick={can.edit ? (a) => setEditing(a) : undefined} />
            </div>
            <div className="md:hidden">
              {rows.map((a) => (
                <div key={a.id} className="border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    {layerCell(a)}
                    <div className="flex shrink-0 items-center gap-1">
                      <EnumPill field="character_assets.status" value={a.status} />
                      {can.edit && (
                        <Button size="icon" variant="ghost" className="size-7" aria-label={t('Edit {name}', { name: a.label })} onClick={() => setEditing(a)}>
                          <Pencil size={13} aria-hidden />
                        </Button>
                      )}
                      <DeleteButton collection="character_assets" id={a.id} iconOnly />
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--agent-app-muted)]">
                    <span>{creatorOf(a) || t('Creator not set')}</span>
                    <span>{a.acquisition !== '' ? enumLabel('character_assets.acquisition', a.acquisition) : t('Not recorded')}</span>
                    {a.acquisition === 'assignment' && <span>{t('Arts. 27 and 28 named: {v}', { v: yesNo(a.art27_28) })}</span>}
                    {a.acquisition !== 'owned_original' && a.acquisition !== 'work_for_hire' && a.acquisition !== '' && <span>{t('Non-exercise: {v}', { v: yesNo(a.moral_rights_waiver) })}</span>}
                  </div>
                  <div className="mt-1.5">{issueLines(a)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {editing !== null && <AssetDialog character={character} asset={editing === 'new' ? null : editing} siblings={rows} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add or edit a layer                                                 */
/* ------------------------------------------------------------------ */

function AssetDialog({ character, asset, siblings, onClose }: { character: CharacterRec; asset: CharacterAssetRec | null; siblings: CharacterAssetRec[]; onClose: () => void }): React.JSX.Element {
  const { homeCurrency } = useApp();
  const [component, setComponent] = useState<string>(asset?.component ?? 'design_sheet');
  const [label, setLabel] = useState(asset?.label ?? '');
  const [version, setVersion] = useState(asset?.version ?? '');
  const [creator, setCreator] = useState(asset?.creator ?? '');
  const [agreement, setAgreement] = useState(asset?.agreement ?? '');
  const [acquisition, setAcquisition] = useState<string>(asset?.acquisition ?? '');
  const [art, setArt] = useState(asset?.art27_28 ?? false);
  const [waiver, setWaiver] = useState(asset?.moral_rights_waiver ?? false);
  const [status, setStatus] = useState<string>(asset?.status ?? 'planned');
  const [delivered, setDelivered] = useState(d10(asset?.delivered_date));
  const [orderTerms, setOrderTerms] = useState(d10(asset?.order_terms_date));
  const [inspected, setInspected] = useState(d10(asset?.inspected_date));
  const [paymentDue, setPaymentDue] = useState(d10(asset?.payment_due));
  const [paid, setPaid] = useState(d10(asset?.paid_date));
  const [fee, setFee] = useState(asset !== null && asset.fee > 0 ? String(asset.fee) : '');
  const [currency, setCurrency] = useState(asset?.currency || homeCurrency);
  const [licenseEnd, setLicenseEnd] = useState(d10(asset?.license_end));
  const [territory, setTerritory] = useState(asset?.territory_limit ?? '');
  const [derivedFrom, setDerivedFrom] = useState(asset?.derived_from ?? '');
  const [credit, setCredit] = useState(asset?.credit_text ?? '');
  const [portfolio, setPortfolio] = useState<string>(asset?.portfolio_use ?? '');
  const [portfolioNote, setPortfolioNote] = useState(asset?.portfolio_note ?? '');
  const [rework, setRework] = useState<EditRow[]>(() =>
    asRows<Partial<ReworkRow>>(asset?.rework).map((r) => ({ date: d10(typeof r.date === 'string' ? r.date : ''), description: typeof r.description === 'string' ? r.description : '', paid: r.paid === true ? 'yes' : 'no' })),
  );
  const [notes, setNotes] = useState(asset?.notes ?? '');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removedFiles, setRemovedFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  const isLicence = LICENCES.has(acquisition);
  const needsWaiver = acquisition !== '' && acquisition !== 'owned_original' && acquisition !== 'work_for_hire';
  const derivedOptions = siblings.filter((s) => s.id !== asset?.id).map((s) => ({ value: s.id, label: `${enumLabel('character_assets.component', s.component)}: ${s.label}` }));

  const submit = async (): Promise<void> => {
    if (label.trim() === '') {
      setError(t('Enter a label, for example "Main design v2".'));
      return;
    }
    setBusy(true);
    const data: Record<string, unknown> = {
      character: character.id,
      component,
      label: label.trim(),
      version: version.trim(),
      creator,
      agreement,
      acquisition,
      art27_28: acquisition === 'assignment' ? art : false,
      moral_rights_waiver: needsWaiver ? waiver : false,
      status,
      delivered_date: toPb(delivered),
      order_terms_date: toPb(orderTerms),
      inspected_date: toPb(inspected),
      payment_due: toPb(paymentDue),
      paid_date: toPb(paid),
      fee: fee.trim() === '' ? 0 : Number(fee),
      currency: currency.toUpperCase(),
      license_end: toPb(licenseEnd),
      territory_limit: territory.trim(),
      derived_from: derivedFrom,
      credit_text: credit.trim(),
      portfolio_use: portfolio,
      portfolio_note: portfolioNote.trim(),
      rework: rework
        .filter((r) => (r['description'] ?? '').trim() !== '' || (r['date'] ?? '') !== '')
        .map((r) => ({ date: r['date'] ?? '', description: (r['description'] ?? '').trim(), paid: r['paid'] === 'yes' })),
      notes: notes.trim(),
    };
    try {
      const saved = asset === null ? await createRecord<CharacterAssetRec>('character_assets', data) : await updateRecord<CharacterAssetRec>('character_assets', asset.id, data);
      if (newFiles.length > 0 || removedFiles.length > 0) {
        const fd = new FormData();
        for (const f of newFiles) fd.append('files+', f);
        for (const n of removedFiles) fd.append('files-', n);
        await updateRecord('character_assets', saved.id, fd);
      }
      toast.success(asset === null ? t('Layer added') : t('Saved'));
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  const opt = (field: string): { value: string; label: string }[] => enumOptions(field).map(([value, l]) => ({ value, label: l }));
  const existing = (asset?.files ?? []).filter((f) => !removedFiles.includes(f));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={asset === null ? t('Add a layer') : t('Edit layer')}
      description={t('One separately owned part of {name}: who made it and how we hold it.', { name: character.name })}
      className="w-[min(94vw,44rem)]"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span>
            {asset !== null && <DeleteButton collection="character_assets" id={asset.id} onDeleted={onClose} />}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={busy}>
              {asset === null ? t('Add layer') : t('Save changes')}
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Layer|rights stack')} value={component} options={opt('character_assets.component')} onChange={(e) => setComponent(e.target.value)} />
          <Input label={t('Label|layer')} value={label} onChange={(e) => setLabel(e.target.value)} error={error !== '' ? error : undefined} placeholder={t('For example Main design v2')} />
          <Input label={t('Version|layer')} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1" />
          <Select label={t('Status')} value={status} options={opt('character_assets.status')} onChange={(e) => setStatus(e.target.value)} />
          <PartyPicker label={t('Creator|layer')} value={creator} onChange={(id) => setCreator(id)} placeholder={t('Illustrator, modeler, voice actor, composer...')} />
          <Select label={t('Based on')} value={derivedFrom} placeholder={t('Nothing (original)')} options={derivedOptions} onChange={(e) => setDerivedFrom(e.target.value)} />
        </div>

        <Field label={t('How we hold it')}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t('Acquired by')} value={acquisition} placeholder={t('Not recorded')} options={opt('character_assets.acquisition')} onChange={(e) => setAcquisition(e.target.value)} />
              <RecordPicker<AgreementRec>
                collection="agreements"
                label={t('Agreement')}
                value={agreement}
                onChange={(id) => setAgreement(id)}
                labelOf={(a) => (a.ref !== '' ? `${a.ref} ${a.title}` : a.title)}
                searchFields={['title', 'ref']}
              />
            </div>
            {acquisition === 'assignment' && (
              <div className="flex flex-col gap-1">
                <Checkbox checked={art} onChange={setArt} label={t('The assignment names Arts. 27 and 28 (adaptation and derivative works)')} />
                <p className={cn('pl-6 text-xs leading-relaxed', art ? 'text-[var(--agent-app-muted)]' : TONE_TEXT.bad)}>
                  {t('Under Art. 61(2) of the Copyright Act, an assignment that does not name Arts. 27 and 28 leaves the adaptation rights with the creator.')}
                </p>
              </div>
            )}
            {needsWaiver && (
              <div className="flex flex-col gap-1">
                <Checkbox checked={waiver} onChange={setWaiver} label={t('The creator agreed not to exercise moral rights')} />
                <p className="pl-6 text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('Without it, changes to the work may need the consent of the creator (Art. 20, right to integrity).')}</p>
              </div>
            )}
            {isLicence && (
              <div className="grid gap-3 sm:grid-cols-2">
                <DateField label={t('Licence ends')} value={licenseEnd} onChange={setLicenseEnd} help={t('Becomes a deadline with a reminder before it.')} />
                <Input label={t('Territory limit')} value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder={t('For example Japan only')} />
              </div>
            )}
            {!isLicence && <Input label={t('Territory limit')} value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder={t('For example Japan only')} />}
          </div>
        </Field>

        <Field label={t('Commission and payment')} help={t('For individual creators the Freelance Act requires written terms at commissioning and payment within 60 days of delivery. Payment due dates become deadlines.')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField label={t('Written order terms given')} value={orderTerms} onChange={setOrderTerms} />
            <DateField label={t('Delivered|date')} value={delivered} onChange={setDelivered} />
            <DateField label={t('Inspected|delivery')} value={inspected} onChange={setInspected} />
            <DateField label={t('Payment due')} value={paymentDue} onChange={setPaymentDue} />
            <DateField label={t('Paid|date')} value={paid} onChange={setPaid} />
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <Input label={t('Fee|commission')} type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
              <Select label={t('Currency')} value={currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={(e) => setCurrency(e.target.value)} />
            </div>
          </div>
        </Field>

        <RowsEditor
          label={t('Rework|layer')}
          help={t('Revisions asked of the creator after delivery, and whether they were paid.')}
          cols={[
            { key: 'date', label: t('Date'), kind: 'date', grow: 1 },
            { key: 'description', label: t('What was changed'), grow: 2 },
            { key: 'paid', label: t('Paid'), kind: 'select', options: [{ value: 'no', label: t('No') }, { value: 'yes', label: t('Yes') }], grow: 1 },
          ]}
          rows={rework}
          onChange={setRework}
          addLabel={t('Add rework')}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Credit line')} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder={t('For example Character design: name')} />
          <Select label={t('Creator portfolio use')} value={portfolio} placeholder={t('Not set')} options={opt('character_assets.portfolio_use')} onChange={(e) => setPortfolio(e.target.value)} />
        </div>
        {portfolio === 'conditions' && <Input label={t('Portfolio conditions')} value={portfolioNote} onChange={(e) => setPortfolioNote(e.target.value)} />}

        <Field label={t('Files')} help={t('Model sheets, art files and the signed order. Up to 10 files.')}>
          <div className="flex flex-col gap-2">
            {existing.length > 0 && asset !== null && (
              <ul className="flex flex-col gap-1">
                {existing.map((f) => (
                  <li key={f} className="flex min-w-0 items-center gap-2 text-[13px]">
                    <FileText size={13} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
                    <a href={fileUrl(asset, f)} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">
                      {f}
                    </a>
                    <button type="button" aria-label={t('Remove')} className="shrink-0 text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => setRemovedFiles((r) => [...r, f])}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {newFiles.length > 0 && (
              <ul className="flex flex-col gap-1">
                {newFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex min-w-0 items-center gap-2 text-[13px]">
                    <Paperclip size={13} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
                    <span className="min-w-0 truncate">{f.name}</span>
                    <Pill tone="info">{t('New')}</Pill>
                    <button type="button" aria-label={t('Remove')} className="shrink-0 text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => setNewFiles((l) => l.filter((_, j) => j !== i))}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={existing.length + newFiles.length >= 10}>
                <Paperclip size={13} aria-hidden /> {t('Attach files')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length > 0) setNewFiles((l) => [...l, ...list].slice(0, Math.max(0, 10 - existing.length)));
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </Field>

        <Textarea label={t('Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </Dialog>
  );
}
