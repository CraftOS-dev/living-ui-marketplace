/**
 * Title tools: the copyright term in Japan, the US and the EU (with each
 * episode timed on its own, titles/copyright-term children=true), and the
 * production clearances (script, music, footage, performer consent, chain
 * of title and so on), whose due and expiry dates become deadlines.
 */
import { useState } from 'react';
import { ClipboardCheck, Scale, Trash2, TriangleAlert } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { createRecord, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { d10, daysUntil, fmtDate, toPb } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { ClearanceRec, DocumentRec, TitleRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { CatalogSelect, RecordPicker, UserSelect } from './pickers.tsx';
import { DateField, SimpleTable } from './ipShared.tsx';
import type { SimpleCol } from './ipShared.tsx';
import { EmptyHint, EnumPill, ErrorBox, JurChip, ListRow, Loading, Notice, Section, StatTile, TONE_TEXT } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Copyright term                                                      */
/* ------------------------------------------------------------------ */

interface TermEntry {
  date: string;
  text: Bi;
  flags?: Bi[] | undefined;
}
type TermSet = Partial<Record<'JP' | 'US' | 'EU', TermEntry>>;
interface CopyrightTermResponse {
  id: string;
  title: string;
  terms: TermSet;
  children: { id: string; title: string; episode_number: number; terms: TermSet }[];
}

const PLACES: ('JP' | 'US' | 'EU')[] = ['JP', 'US', 'EU'];

function TermDate({ entry }: { entry: TermEntry | undefined }): React.JSX.Element {
  const d = d10(entry?.date);
  if (d === '') return <span className="text-[var(--agent-app-muted)]">{t('Not enough data')}</span>;
  const passed = daysUntil(d) < 0;
  return <span className={passed ? TONE_TEXT.neutral : undefined}>{passed ? t('Ended {date}', { date: fmtDate(d) }) : fmtDate(d)}</span>;
}

export function CopyrightTermSection({ title, onEdit }: { title: TitleRec; onEdit?: (() => void) | undefined }): React.JSX.Element {
  const res = useLiveAsync(() => op<CopyrightTermResponse>('titles/copyright-term', { work_id: title.id, children: true }), [title.id], ['titles']);
  const data = res.data;
  if (res.loading && data === null) return <Loading />;
  if (res.error !== null && data === null) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (data === null) return <Loading />;
  const flags = data.terms.JP?.flags ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {PLACES.map((p) => {
          const e = data.terms[p];
          return (
            <Section key={p} title={jurisdictionName(p)} actions={<JurChip code={p} />}>
              <div className="flex flex-col gap-2">
                <div className="text-lg font-semibold tabular-nums">
                  <TermDate entry={e} />
                </div>
                {e !== undefined && <p className="text-[12.5px] leading-relaxed text-[var(--agent-app-text)]/85">{bi(e.text)}</p>}
              </div>
            </Section>
          );
        })}
      </div>
      {flags.length > 0 && (
        <Notice tone="warn" icon={TriangleAlert}>
          {flags.map((f, i) => (
            <p key={i}>{bi(f)}</p>
          ))}
        </Notice>
      )}
      <Notice icon={Scale}>
        <span>
          {t('Terms run to 31 December of the final year. They follow from the publication date, the author kind, made for hire and the author death year on this title; correct those to correct the term. This is a guide, not legal advice.')}{' '}
          {onEdit !== undefined && (
            <button type="button" className="text-[var(--agent-app-accent)] hover:underline" onClick={onEdit}>
              {t('Edit the facts')}
            </button>
          )}
        </span>
      </Notice>
      {data.children.length > 0 && (
        <Section title={t('Episodes and parts')} meta={String(data.children.length)} flush>
          <SimpleTable
            rows={data.children}
            onRowClick={(c) => {
              window.location.hash = href('title', c.id, { tab: 'copyright' });
            }}
            cols={[
              {
                key: 'title',
                label: t('Title|work name'),
                render: (c) => (
                  <span className="flex min-w-0 items-baseline gap-2">
                    {c.episode_number > 0 && <span className="font-mono text-[12px] text-[var(--agent-app-muted)]">#{c.episode_number}</span>}
                    <span className="min-w-0 truncate font-medium">{c.title}</span>
                  </span>
                ),
              },
              ...PLACES.map((p) => ({ key: p, label: p, render: (c: { terms: TermSet }) => <span className="whitespace-nowrap tabular-nums"><TermDate entry={c.terms[p]} /></span> })),
            ]}
          />
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Clearances                                                          */
/* ------------------------------------------------------------------ */

const DONE = new Set(['cleared', 'not_applicable']);

export function ClearancesSection({ title }: { title: TitleRec }): React.JSX.Element {
  const { can, userName } = useApp();
  const list = useCollection<ClearanceRec>('clearances', { filter: `work = ${q(title.id)}`, sort: 'due_date,item_type' });
  const [editing, setEditing] = useState<ClearanceRec | 'new' | null>(null);
  const rows = list.records;
  const cleared = rows.filter((c) => DONE.has(c.status)).length;
  const risk = rows.filter((c) => c.status === 'cleared_with_risk').length;
  const blocked = rows.filter((c) => c.status === 'not_cleared').length;

  const add = can.edit ? (
    <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
      {t('Add clearance')}
    </Button>
  ) : undefined;

  const cols: SimpleCol<ClearanceRec>[] = [
    {
      key: 'title',
      label: t('Item|clearance'),
      render: (c) => (
        <div className="min-w-0">
          <div className="font-medium">{c.title}</div>
          <div className="text-xs text-[var(--agent-app-muted)]">{enumLabel('clearances.item_type', c.item_type)}</div>
        </div>
      ),
    },
    { key: 'status', label: t('Status'), render: (c) => <EnumPill field="clearances.status" value={c.status} /> },
    { key: 'provider', label: t('Provider|clearance'), className: 'hidden lg:table-cell', render: (c) => c.provider },
    { key: 'due', label: t('Due'), render: (c) => <span className="whitespace-nowrap tabular-nums">{fmtDate(c.due_date)}</span> },
    { key: 'cleared', label: t('Cleared'), className: 'hidden lg:table-cell', render: (c) => <span className="whitespace-nowrap tabular-nums">{fmtDate(c.cleared_date)}</span> },
    { key: 'expires', label: t('Expires|clearance'), render: (c) => <span className="whitespace-nowrap tabular-nums">{fmtDate(c.expires)}</span> },
    { key: 'resp', label: t('Responsible'), className: 'hidden xl:table-cell', render: (c) => userName(c.responsible) },
  ];

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('Items|clearance')} value={rows.length} />
          <StatTile label={t('Cleared')} value={`${cleared}/${rows.length}`} tone={cleared === rows.length ? 'good' : undefined} />
          <StatTile label={t('Cleared with risk')} value={risk} tone={risk > 0 ? 'warn' : undefined} />
          <StatTile label={t('Not cleared')} value={blocked} tone={blocked > 0 ? 'bad' : undefined} />
        </div>
      )}
      <Section title={t('Clearances')} meta={rows.length > 0 ? String(rows.length) : undefined} actions={add} flush>
        {list.loading && rows.length === 0 ? (
          <Loading />
        ) : list.error !== null && rows.length === 0 ? (
          <div className="p-4">
            <ErrorBox message={list.error} onRetry={list.refresh} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyHint
            compact
            icon={ClipboardCheck}
            title={t('No clearances yet')}
            message={t('List what must be cleared before release: original work licence, script, character design, music, footage, performer consent, title search, chain of title. Due and expiry dates become deadlines.')}
            action={add}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <SimpleTable rows={rows} cols={cols} onRowClick={can.edit ? (c) => setEditing(c) : undefined} subRow={(c) => (c.notes !== '' ? <span className="text-xs text-[var(--agent-app-muted)]">{c.notes}</span> : null)} />
            </div>
            <div className="md:hidden">
              {rows.map((c) => (
                <ListRow
                  key={c.id}
                  primary={c.title}
                  secondary={[enumLabel('clearances.item_type', c.item_type), d10(c.due_date) !== '' ? t('Due {date}', { date: fmtDate(c.due_date) }) : '', d10(c.expires) !== '' ? t('Expires {date}', { date: fmtDate(c.expires) }) : '']
                    .filter((x) => x !== '')
                    .join(' · ')}
                  trailing={<EnumPill field="clearances.status" value={c.status} />}
                  onClick={can.edit ? () => setEditing(c) : undefined}
                />
              ))}
            </div>
          </>
        )}
      </Section>
      {editing !== null && <ClearanceDialog title={title} clearance={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ClearanceDialog({ title, clearance, onClose }: { title: TitleRec; clearance: ClearanceRec | null; onClose: () => void }): React.JSX.Element {
  const { can } = useApp();
  const [itemType, setItemType] = useState<string>(clearance?.item_type ?? '');
  const [name, setName] = useState(clearance?.title ?? '');
  const [status, setStatus] = useState<string>(clearance?.status ?? 'not_started');
  const [provider, setProvider] = useState(clearance?.provider ?? '');
  const [due, setDue] = useState(d10(clearance?.due_date));
  const [cleared, setCleared] = useState(d10(clearance?.cleared_date));
  const [expires, setExpires] = useState(d10(clearance?.expires));
  const [responsible, setResponsible] = useState(clearance?.responsible ?? '');
  const [character, setCharacter] = useState(clearance?.character ?? '');
  const [document, setDocument] = useState(clearance?.document ?? '');
  const [notes, setNotes] = useState(clearance?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ type?: string; name?: string }>({});

  const submit = async (): Promise<void> => {
    const err: { type?: string; name?: string } = {};
    if (itemType === '') err.type = t('Choose what is being cleared.');
    if (name.trim() === '') err.name = t('Enter a short description.');
    setError(err);
    if (err.type !== undefined || err.name !== undefined) return;
    setBusy(true);
    const data = {
      work: title.id,
      franchise: clearance?.franchise || title.franchise,
      character,
      item_type: itemType,
      title: name.trim(),
      status,
      provider: provider.trim(),
      due_date: toPb(due),
      cleared_date: toPb(cleared),
      expires: toPb(expires),
      responsible,
      document,
      notes: notes.trim(),
    };
    try {
      if (clearance === null) await createRecord('clearances', data);
      else await updateRecord('clearances', clearance.id, data);
      toast.success(clearance === null ? t('Clearance added') : t('Saved'));
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
      title={clearance === null ? t('Add clearance') : t('Edit clearance')}
      description={t('Due and expiry dates become deadlines on this title automatically.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span>
            {clearance !== null && <DeleteButton collection="clearances" id={clearance.id} onDeleted={onClose} />}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={busy}>
              {clearance === null ? t('Add clearance') : t('Save changes')}
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('What is cleared')} value={itemType} placeholder={t('Choose')} error={error.type} options={enumOptions('clearances.item_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setItemType(e.target.value)} />
          <Select label={t('Status')} value={status} options={enumOptions('clearances.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <Input label={t('Description')} value={name} onChange={(e) => setName(e.target.value)} error={error.name} placeholder={t('For example Opening theme sync licence')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Provider|clearance')} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={t('Who grants or confirms it')} />
          <UserSelect label={t('Responsible')} value={responsible} onChange={setResponsible} />
          <DateField label={t('Due')} value={due} onChange={setDue} />
          <DateField label={t('Cleared on')} value={cleared} onChange={setCleared} />
          <DateField label={t('Expires|clearance')} value={expires} onChange={setExpires} help={t('When the clearance runs out, for example the end of a sync licence.')} />
          <CatalogSelect kind="character" label={t('Character (optional)')} value={character} onChange={setCharacter} />
        </div>
        <RecordPicker<DocumentRec>
          collection="documents"
          label={t('Supporting document')}
          value={document}
          onChange={(id) => setDocument(id)}
          labelOf={(d) => d.title}
          searchFields={['title']}
          filter={`work = ${q(title.id)}`}
        />
        <Textarea label={t('Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </Dialog>
  );
}
