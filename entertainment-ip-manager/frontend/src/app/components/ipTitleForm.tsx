/**
 * Title create and edit dialog: series, seasons, episodes, films, streams
 * and the rest, with the facts the copyright term needs (publication date,
 * authors, author death year, author kind, made for hire) and external
 * identifiers stored in titles.external_ids as [{ type, value, note }].
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import type { CommitteeRec, TitleRec } from '../lib/records.ts';
import type { NameEntry } from '../lib/shapes.ts';
import { CatalogSelect, RecordPicker } from './pickers.tsx';
import { DateField, ImageField, NamesEditor, RowsEditor, asRows, descendantIds, namesOf, placeOptions, saveImage } from './ipShared.tsx';
import type { EditRow } from './ipShared.tsx';
import { Checkbox, Field } from './ui.tsx';

export interface ExternalId {
  type: string;
  value: string;
  note?: string | undefined;
}

export const EXTERNAL_ID_TYPES = ['eidr', 'isan', 'media_arts_db', 'streamer', 'jan', 'isbn', 'us_copyright_reg', 'other'] as const;

export function externalIdLabel(type: string): string {
  switch (type) {
    case 'eidr':
      return 'EIDR';
    case 'isan':
      return 'ISAN';
    case 'media_arts_db':
      return t('Media Arts Database');
    case 'streamer':
      return t('Streaming service ID');
    case 'jan':
      return 'JAN';
    case 'isbn':
      return 'ISBN';
    case 'us_copyright_reg':
      return t('US copyright registration');
    case 'other':
      return t('Other');
    default:
      return type;
  }
}

export function readExternalIds(v: unknown): ExternalId[] {
  return asRows<Partial<ExternalId>>(v)
    .filter((x) => typeof x === 'object' && x !== null && typeof x.value === 'string' && x.value !== '')
    .map((x) => ({ type: typeof x.type === 'string' ? x.type : 'other', value: x.value ?? '', note: typeof x.note === 'string' ? x.note : '' }));
}

export function TitleForm({
  title,
  defaults,
  onClose,
  onSaved,
}: {
  title: TitleRec | null;
  defaults?: Partial<Pick<TitleRec, 'parent' | 'franchise' | 'title_type' | 'episode_number' | 'rights_basis' | 'committee'>> | undefined;
  onClose: () => void;
  onSaved?: ((x: TitleRec) => void) | undefined;
}): React.JSX.Element {
  const { titles, on } = useApp();
  const [name, setName] = useState(title?.title ?? '');
  const [names, setNames] = useState<NameEntry[]>(namesOf(title?.names));
  const [type, setType] = useState<string>(title?.title_type ?? defaults?.title_type ?? '');
  const [franchise, setFranchise] = useState(title?.franchise ?? defaults?.franchise ?? '');
  const [parent, setParent] = useState(title?.parent ?? defaults?.parent ?? '');
  const [basis, setBasis] = useState<string>(title?.rights_basis ?? defaults?.rights_basis ?? '');
  const [committee, setCommittee] = useState(title?.committee ?? defaults?.committee ?? '');
  const [status, setStatus] = useState<string>(title?.status ?? 'development');
  const [created, setCreated] = useState(d10(title?.creation_date));
  const [published, setPublished] = useState(d10(title?.publication_date));
  const [country, setCountry] = useState(title?.publication_country ?? 'JP');
  const [episode, setEpisode] = useState(title !== null ? (title.episode_number > 0 ? String(title.episode_number) : '') : defaults?.episode_number !== undefined ? String(defaults.episode_number) : '');
  const [hire, setHire] = useState(title?.made_for_hire ?? false);
  const [authors, setAuthors] = useState(title?.authors ?? '');
  const [deathYear, setDeathYear] = useState(title !== null && title.author_death_year > 0 ? String(title.author_death_year) : '');
  const [authorKind, setAuthorKind] = useState<string>(title?.author_kind ?? '');
  const [language, setLanguage] = useState(title?.language ?? '');
  const [announced, setAnnounced] = useState(d10(title?.announcement_date));
  const [ids, setIds] = useState<EditRow[]>(() => readExternalIds(title?.external_ids).map((x) => ({ type: x.type, value: x.value, note: x.note ?? '' })));
  const [description, setDescription] = useState(title?.description ?? '');
  const [notes, setNotes] = useState(title?.notes ?? '');
  const [image, setImage] = useState<File | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title?: string; type?: string }>({});

  const blocked = useMemo(() => (title === null ? new Set<string>() : new Set([title.id, ...descendantIds(titles, title.id)])), [title, titles]);
  const parentOptions = titles.filter((x) => !blocked.has(x.id)).map((x) => ({ value: x.id, label: x.title }));
  const idTypes = EXTERNAL_ID_TYPES.map((x) => ({ value: x, label: externalIdLabel(x) }));

  const submit = async (): Promise<void> => {
    const err: { title?: string; type?: string } = {};
    if (name.trim() === '') err.title = t('Enter a title.');
    if (type === '') err.type = t('Choose a type.');
    setError(err);
    if (err.title !== undefined || err.type !== undefined) return;
    setBusy(true);
    const data: Record<string, unknown> = {
      title: name.trim(),
      names: names.filter((n) => n.value.trim() !== '').map((n) => ({ script: n.script, value: n.value.trim() })),
      title_type: type,
      parent,
      rights_basis: basis,
      status,
      creation_date: toPb(created),
      publication_date: toPb(published),
      publication_country: country,
      episode_number: episode.trim() === '' ? 0 : Number(episode),
      made_for_hire: hire,
      authors: authors.trim(),
      author_death_year: deathYear.trim() === '' ? 0 : Number(deathYear),
      author_kind: authorKind,
      language: language.trim(),
      announcement_date: toPb(announced),
      external_ids: ids
        .filter((r) => (r['value'] ?? '').trim() !== '')
        .map((r) => {
          const note = (r['note'] ?? '').trim();
          return note !== '' ? { type: r['type'] ?? 'other', value: (r['value'] ?? '').trim(), note } : { type: r['type'] ?? 'other', value: (r['value'] ?? '').trim() };
        }),
      description: description.trim(),
      notes: notes.trim(),
    };
    if (on('franchises') || title === null) data['franchise'] = franchise;
    if (on('committees')) data['committee'] = committee;
    try {
      const saved = title === null ? await createRecord<TitleRec>('titles', data) : await updateRecord<TitleRec>('titles', title.id, data);
      await saveImage('titles', saved.id, image, imageRemoved);
      toast.success(title === null ? t('Title created') : t('Saved'));
      onSaved?.(saved);
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
      title={title === null ? t('New title') : t('Edit title')}
      description={t('Series hold seasons, seasons hold episodes. Films, streams and books stand on their own.')}
      className="w-[min(94vw,42rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {title === null ? t('Create title') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={t('Title|work name')} value={name} onChange={(e) => setName(e.target.value)} error={error.title} autoFocus />
        <NamesEditor value={names} onChange={setNames} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Type')} value={type} placeholder={t('Choose')} error={error.type} options={enumOptions('titles.title_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
          <Select label={t('Status')} value={status} options={enumOptions('titles.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
          {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={franchise} onChange={setFranchise} />}
          <Select label={t('Part of')} value={parent} placeholder={t('Top level')} options={parentOptions} onChange={(e) => setParent(e.target.value)} />
          <Select
            label={t('Rights basis')}
            value={basis}
            placeholder={t('Not set')}
            options={enumOptions('titles.rights_basis').map(([value, label]) => ({ value, label }))}
            onChange={(e) => setBasis(e.target.value)}
          />
          {on('committees') && (
            <RecordPicker<CommitteeRec> collection="committees" label={t('Production committee')} value={committee} onChange={(id) => setCommittee(id)} labelOf={(c) => c.name} searchFields={['name']} />
          )}
          <Input label={t('Episode number')} type="number" min={0} value={episode} onChange={(e) => setEpisode(e.target.value)} />
          <Input label={t('Language')} value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="ja" />
          <DateField label={t('Creation date')} value={created} onChange={setCreated} />
          <DateField label={t('Publication date|title')} value={published} onChange={setPublished} help={t('The first lawful publication. Copyright terms count from it.')} />
          <Select label={t('Publication country')} value={country} placeholder={t('Not set')} options={placeOptions()} onChange={(e) => setCountry(e.target.value)} />
          <DateField label={t('Announcement date')} value={announced} onChange={setAnnounced} />
        </div>
        <Field label={t('Authorship')} help={t('Used to work out the copyright term in Japan, the US and the EU.')}>
          <div className="flex flex-col gap-3">
            <Checkbox checked={hire} onChange={setHire} label={t('Made for hire (work made by employees under the company name)')} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={t('Author kind')}
                value={authorKind}
                placeholder={t('Not set')}
                options={enumOptions('titles.author_kind').map(([value, label]) => ({ value, label }))}
                onChange={(e) => setAuthorKind(e.target.value)}
              />
              <Input label={t('Author death year')} type="number" min={0} value={deathYear} onChange={(e) => setDeathYear(e.target.value)} placeholder="YYYY" />
            </div>
            <Input label={t('Authors')} value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </div>
        </Field>
        <RowsEditor
          label={t('External identifiers')}
          help={t('EIDR, ISAN, Media Arts Database, streaming service IDs, JAN and the like.')}
          cols={[
            { key: 'type', label: t('Type'), kind: 'select', options: idTypes, grow: 1 },
            { key: 'value', label: t('Identifier'), grow: 2 },
            { key: 'note', label: t('Note'), placeholder: t('For example the service'), grow: 1 },
          ]}
          rows={ids}
          onChange={setIds}
          addLabel={t('Add an identifier')}
        />
        <Textarea label={t('Description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <Textarea label={t('Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <ImageField record={title} current={title?.image ?? ''} file={image} removed={imageRemoved} onFile={setImage} onRemove={setImageRemoved} />
      </div>
    </Dialog>
  );
}
