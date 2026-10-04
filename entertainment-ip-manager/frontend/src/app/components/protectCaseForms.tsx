/**
 * Enforcement case forms: a new case (with the URLs and the rights it
 * relies on), the edit form for the case's own fields, and the inline
 * editors on the case page (URLs, linked rights, outcome and settlement).
 */
import { useState } from 'react';
import { ExternalLink, Plus, X } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, q, updateRecord } from '../lib/api.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb, today } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { CaseRec, CharacterRec, MatterRec, TalentRec, TitleRec } from '../lib/records.ts';
import { CatalogSelect, MultiRecordPicker, UserSelect } from './pickers.tsx';
import { Section } from './ui.tsx';
import { DateField, opts } from './protectShared.tsx';

export type CaseX = CaseRec;

/** Platforms suggested for the platform field (the enrolment programs plus the usual social sites). */
function platformSuggestions(): string[] {
  const codes = ['amazon_brand_registry', 'mercari', 'alibaba_ipp', 'aidc_ipp', 'ebay_vero', 'rakuten', 'yahoo_auctions', 'youtube', 'x', 'tiktok'];
  return codes.map((c) => enumLabel('platform_enrollments.platform', c));
}

export function urlList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter((x) => x !== ''),
    ),
  ];
}

function FormHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="mt-1 border-b border-[var(--agent-app-border)] pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h3>;
}

/** Pickers for the rights a case relies on. */
export function LinkedRightsFields({
  value,
  onChange,
}: {
  value: { franchise: string; characters: string[]; talents: string[]; works: string[]; matters: string[] };
  onChange: (v: { franchise: string; characters: string[]; talents: string[]; works: string[]; matters: string[] }) => void;
}): React.JSX.Element {
  const { on } = useApp();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={value.franchise} onChange={(v) => onChange({ ...value, franchise: v })} />}
      {on('franchises') && (
        <MultiRecordPicker<CharacterRec> collection="characters" label={t('Characters')} value={value.characters} onChange={(ids) => onChange({ ...value, characters: ids })} labelOf={(c) => c.name} searchFields={['name']} />
      )}
      {on('talents') && (
        <MultiRecordPicker<TalentRec> collection="talents" label={t('Talents')} value={value.talents} onChange={(ids) => onChange({ ...value, talents: ids })} labelOf={(x) => x.stage_name} searchFields={['stage_name']} />
      )}
      {on('titles') && (
        <MultiRecordPicker<TitleRec> collection="titles" label={t('Titles')} value={value.works} onChange={(ids) => onChange({ ...value, works: ids })} labelOf={(x) => x.title} searchFields={['title']} />
      )}
      <MultiRecordPicker<MatterRec>
        collection="matters"
        label={t('Trademarks and designs')}
        value={value.matters}
        onChange={(ids) => onChange({ ...value, matters: ids })}
        labelOf={(m) => `${m.ref} ${m.jurisdiction} ${m.title}`}
        searchFields={['ref', 'title', 'application_no', 'registration_no']}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New case and edit                                                   */
/* ------------------------------------------------------------------ */

export interface CaseDefaults {
  title?: string | undefined;
  case_type?: string | undefined;
  forum?: string | undefined;
  platform?: string | undefined;
  their_party?: string | undefined;
  urls?: string[] | undefined;
  characters?: string[] | undefined;
  talents?: string[] | undefined;
  matters?: string[] | undefined;
}

export function CaseDialog({ record, defaults, onClose, onCreated }: { record?: CaseX | undefined; defaults?: CaseDefaults | undefined; onClose: () => void; onCreated?: ((c: CaseX) => void) | undefined }): React.JSX.Element {
  const { me } = useApp();
  const editing = record !== undefined;
  const [f, setF] = useState({
    title: record?.title ?? defaults?.title ?? '',
    case_type: record?.case_type ?? defaults?.case_type ?? 'counterfeit',
    forum: record?.forum ?? defaults?.forum ?? '',
    role: (record?.role || 'offense') as CaseX['role'],
    status: (record?.status || 'new') as CaseX['status'],
    platform: record?.platform ?? defaults?.platform ?? '',
    their_party: record?.their_party ?? defaults?.their_party ?? '',
    opened_date: d10(record?.opened_date ?? '') || today(),
    request_sent: d10(record?.request_sent ?? ''),
    counter_notice_date: d10(record?.counter_notice_date ?? ''),
    assignee: record?.assignee ?? me?.id ?? '',
    counsel: record?.counsel ?? '',
    notes: record?.notes ?? '',
  });
  const [urls, setUrls] = useState((defaults?.urls ?? []).join('\n'));
  const [rights, setRights] = useState({
    franchise: '',
    characters: defaults?.characters ?? [],
    talents: defaults?.talents ?? [],
    works: [] as string[],
    matters: defaults?.matters ?? [],
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => setF((x) => ({ ...x, [k]: v }));
  const valid = f.title.trim() !== '' && f.case_type !== '';

  const save = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    const base = {
      ...f,
      title: f.title.trim(),
      opened_date: toPb(f.opened_date),
      request_sent: toPb(f.request_sent),
      counter_notice_date: toPb(f.counter_notice_date),
    };
    try {
      if (editing) {
        await updateRecord<CaseX>('enforcement_cases', record.id, base);
        toast.success(t('Saved'));
        onClose();
      } else {
        const c = await createRecord<CaseX>('enforcement_cases', { ...base, urls: urlList(urls), ...rights });
        toast.success(t('Case opened'));
        onClose();
        if (onCreated !== undefined) onCreated(c);
        else navigate('case', c.id);
      }
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
      title={editing ? t('Edit {ref}', { ref: record.ref }) : t('New case')}
      description={editing ? t('Steps such as a notice sent or content removed are recorded as events, so the deadlines follow.') : t('Open a case for a counterfeit, impersonation, piracy, leak or other problem. The reference is given automatically.')}
      className="w-[min(94vw,46rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!valid}>
            {editing ? t('Save changes') : t('Open the case')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={t('Title|case')} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={t('For example: counterfeit acrylic stands on Mercari')} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('Case type')} value={f.case_type} options={opts(enumOptions('enforcement_cases.case_type'))} onChange={(e) => set('case_type', e.target.value as CaseX['case_type'])} />
          <Select label={t('Forum')} value={f.forum} placeholder={t('Not set')} options={opts(enumOptions('enforcement_cases.forum'))} onChange={(e) => set('forum', e.target.value as CaseX['forum'])} />
          <Select label={t('Our role')} value={f.role} options={opts(enumOptions('enforcement_cases.role'))} onChange={(e) => set('role', e.target.value as CaseX['role'])} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Input label={t('Platform')} value={f.platform} list="protect-platforms" onChange={(e) => set('platform', e.target.value)} />
            <datalist id="protect-platforms">
              {platformSuggestions().map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <Input label={t('Other party')} value={f.their_party} onChange={(e) => set('their_party', e.target.value)} placeholder={t('Seller, account or company')} />
          <DateField label={t('Opened')} value={f.opened_date} onChange={(v) => set('opened_date', v)} />
          <UserSelect label={t('Assignee')} value={f.assignee} onChange={(v) => set('assignee', v)} />
          {editing && <Select label={t('Status')} value={f.status} options={opts(enumOptions('enforcement_cases.status'))} onChange={(e) => set('status', e.target.value as CaseX['status'])} />}
          <Input label={t('Counsel')} value={f.counsel} onChange={(e) => set('counsel', e.target.value)} />
          {editing && <DateField label={t('Request sent')} value={f.request_sent} onChange={(v) => set('request_sent', v)} />}
          {editing && <DateField label={t('Counter-notice received')} value={f.counter_notice_date} onChange={(v) => set('counter_notice_date', v)} />}
        </div>
        {!editing && (
          <>
            <FormHeading>{t('Where it is')}</FormHeading>
            <Textarea label={t('URLs, one per line')} rows={4} className="font-mono text-[12px]" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://" />
            <FormHeading>{t('Rights relied on')}</FormHeading>
            <LinkedRightsFields value={rights} onChange={setRights} />
          </>
        )}
        <Textarea label={t('Notes')} rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Inline editors on the case page                                     */
/* ------------------------------------------------------------------ */

export function UrlsSection({ c }: { c: CaseX }): React.JSX.Element {
  const { can } = useApp();
  const urls = (c.urls ?? []).map(String);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (next: string[]): Promise<void> => {
    setBusy(true);
    try {
      await updateRecord<CaseX>('enforcement_cases', c.id, { urls: next });
    } catch {
      /* the client showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('Where it is')} meta={urls.length > 0 ? String(urls.length) : undefined} flush>
      {urls.length === 0 && <p className="px-4 py-3 text-[13px] text-[var(--agent-app-muted)]">{t('No URLs yet. Notices need the exact address of each listing or post.')}</p>}
      {urls.map((u, i) => (
        <div key={`${u}-${i}`} className="flex items-center gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-2 last:border-0">
          <a href={u} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 break-all font-mono text-[12px] text-[var(--agent-app-accent)] hover:underline">
            {u}
          </a>
          <ExternalLink size={12} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
          {can.edit && (
            <button type="button" className="flex size-7 shrink-0 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" aria-label={t('Remove')} disabled={busy} onClick={() => void save(urls.filter((_x, j) => j !== i))}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      {can.edit && (
        <div className="flex flex-col gap-2 border-t border-[var(--agent-app-border)] px-4 py-3 sm:flex-row sm:items-end">
          <Input aria-label={t('Add a URL')} placeholder="https://" className="font-mono text-[12px]" value={adding} onChange={(e) => setAdding(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={adding.trim() === '' || busy}
            onClick={() => {
              const add = urlList(adding).filter((x) => !urls.includes(x));
              setAdding('');
              if (add.length > 0) void save([...urls, ...add]);
            }}
          >
            <Plus size={13} aria-hidden /> {t('Add a URL')}
          </Button>
        </div>
      )}
    </Section>
  );
}

export function RightsSection({ c }: { c: CaseX }): React.JSX.Element {
  const { can, nameOf, on } = useApp();
  const [editing, setEditing] = useState(false);
  const [rights, setRights] = useState({ franchise: c.franchise, characters: c.characters, talents: c.talents, works: c.works, matters: c.matters });
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await updateRecord<CaseX>('enforcement_cases', c.id, rights);
      toast.success(t('Saved'));
      setEditing(false);
    } catch {
      /* the client showed the error */
    } finally {
      setBusy(false);
    }
  };
  const count = (c.franchise !== '' ? 1 : 0) + c.characters.length + c.talents.length + c.works.length + c.matters.length;
  return (
    <Section
      title={t('Rights relied on')}
      meta={count > 0 ? String(count) : undefined}
      actions={
        can.edit && !editing ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setRights({ franchise: c.franchise, characters: c.characters, talents: c.talents, works: c.works, matters: c.matters });
              setEditing(true);
            }}
          >
            {t('Edit')}
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <LinkedRightsFields value={rights} onChange={setRights} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
            <Button size="sm" onClick={() => void save()} loading={busy}>
              {t('Save')}
            </Button>
          </div>
        </div>
      ) : count === 0 ? (
        <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Link the trademarks, titles, characters or talents the case relies on. Notices list them as the rights infringed.')}</p>
      ) : (
        <div className="flex flex-col gap-2 text-[13px]">
          {c.franchise !== '' && on('franchises') && <LinkLine label={t('Franchise')} items={[{ id: c.franchise, name: nameOf('franchise', c.franchise), page: 'franchise' }]} />}
          {c.characters.length > 0 && on('franchises') && <LinkLine label={t('Characters')} items={c.characters.map((id) => ({ id, name: nameOf('character', id), page: 'character' }))} />}
          {c.talents.length > 0 && on('talents') && <LinkLine label={t('Talents')} items={c.talents.map((id) => ({ id, name: nameOf('talent', id), page: 'talent' }))} />}
          {c.works.length > 0 && on('titles') && <LinkLine label={t('Titles')} items={c.works.map((id) => ({ id, name: nameOf('work', id), page: 'title' }))} />}
          {c.matters.length > 0 && <MatterLinks ids={c.matters} />}
        </div>
      )}
    </Section>
  );
}

function LinkLine({ label, items }: { label: string; items: { id: string; name: string; page: 'franchise' | 'character' | 'talent' | 'title' }[] }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <span className="text-[var(--agent-app-muted)]">{label}: </span>
      {items.map((x, i) => (
        <span key={x.id}>
          {i > 0 && ', '}
          <a href={href(x.page, x.id)} className="hover:underline">
            {x.name || t('Open|action')}
          </a>
        </span>
      ))}
    </div>
  );
}

function MatterLinks({ ids }: { ids: string[] }): React.JSX.Element {
  const list = useCollection<MatterRec>('matters', { filter: ids.map((id) => `id = ${q(id)}`).join(' || '), sort: 'ref' });
  return (
    <div className="min-w-0">
      <span className="text-[var(--agent-app-muted)]">{t('Trademarks and designs')}: </span>
      {list.records.map((m, i) => (
        <span key={m.id}>
          {i > 0 && ', '}
          <a href={href('matter', m.id)} className="hover:underline" title={m.title}>
            <span className="font-mono text-[12.5px]">{m.ref}</span> <span className="text-[var(--agent-app-muted)]">({m.jurisdiction})</span>
          </a>
        </span>
      ))}
    </div>
  );
}

interface Settlement {
  amount?: number | string | undefined;
  currency?: string | undefined;
  terms?: string | undefined;
  penalty_amount?: number | string | undefined;
  date?: string | undefined;
  monitor_until?: string | undefined;
}

export function settlementOf(c: CaseX): Settlement {
  const s = c.settlement;
  return s !== null && typeof s === 'object' && !Array.isArray(s) ? (s as Settlement) : {};
}

export function OutcomeSection({ c }: { c: CaseX }): React.JSX.Element {
  const { can, homeCurrency } = useApp();
  const s0 = settlementOf(c);
  const [f, setF] = useState({
    outcome: c.outcome,
    counsel: c.counsel,
    amount: s0.amount !== undefined && s0.amount !== '' ? String(s0.amount) : '',
    currency: s0.currency || homeCurrency,
    terms: s0.terms ?? '',
    penalty_amount: s0.penalty_amount !== undefined && s0.penalty_amount !== '' ? String(s0.penalty_amount) : '',
    date: d10(s0.date ?? ''),
    monitor_until: d10(s0.monitor_until ?? ''),
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => setF((x) => ({ ...x, [k]: v }));
  const ro = !can.edit;

  const save = async (): Promise<void> => {
    setBusy(true);
    const settlement: Record<string, unknown> = { ...settlementOf(c) };
    const num = (v: string): number | '' => (v.trim() === '' || Number.isNaN(Number(v)) ? '' : Number(v));
    settlement['amount'] = num(f.amount);
    settlement['currency'] = f.currency;
    settlement['terms'] = f.terms.trim();
    settlement['penalty_amount'] = num(f.penalty_amount);
    settlement['date'] = d10(f.date);
    settlement['monitor_until'] = d10(f.monitor_until);
    try {
      await updateRecord<CaseX>('enforcement_cases', c.id, { outcome: f.outcome.trim(), counsel: f.counsel.trim(), settlement });
      toast.success(t('Saved'));
    } catch {
      /* the client showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t('Outcome and settlement')}
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea label={t('Outcome')} rows={2} value={f.outcome} readOnly={ro} onChange={(e) => set('outcome', e.target.value)} />
        <Input label={t('Counsel')} value={f.counsel} readOnly={ro} onChange={(e) => set('counsel', e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Settlement amount')} type="number" min={0} value={f.amount} readOnly={ro} onChange={(e) => set('amount', e.target.value)} />
          <Select label={t('Currency')} value={f.currency} disabled={ro} options={CURRENCIES.map((x) => ({ value: x, label: x }))} onChange={(e) => set('currency', e.target.value)} />
          <Input label={t('Repeat-offence penalty')} type="number" min={0} value={f.penalty_amount} readOnly={ro} onChange={(e) => set('penalty_amount', e.target.value)} />
          <DateField label={t('Settlement date')} value={f.date} onChange={(v) => set('date', v)} />
          <DateField label={t('Watch for repeats until')} value={f.monitor_until} onChange={(v) => set('monitor_until', v)} help={t('Creates a reminder when monitoring ends.')} />
        </div>
        <Textarea label={t('Settlement terms')} rows={3} value={f.terms} readOnly={ro} onChange={(e) => set('terms', e.target.value)} />
      </div>
    </Section>
  );
}
