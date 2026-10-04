/**
 * Franchise create and edit dialog, and the editor of a franchise's
 * copyright lines (the © notice per territory that products and licences
 * print).
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import type { CommitteeRec, FranchiseRec } from '../lib/records.ts';
import type { CopyrightLine, NameEntry } from '../lib/shapes.ts';
import { CatalogSelect, RecordPicker } from './pickers.tsx';
import { DateField, ImageField, NamesEditor, PLACE_CODES, RowsEditor, asRows, descendantIds, namesOf, saveImage } from './ipShared.tsx';
import type { EditRow } from './ipShared.tsx';

export function FranchiseForm({
  franchise,
  defaults,
  onClose,
  onSaved,
}: {
  franchise: FranchiseRec | null;
  defaults?: Partial<Pick<FranchiseRec, 'parent' | 'kind'>> | undefined;
  onClose: () => void;
  onSaved?: ((f: FranchiseRec) => void) | undefined;
}): React.JSX.Element {
  const { franchises, on } = useApp();
  const [name, setName] = useState(franchise?.name ?? '');
  const [names, setNames] = useState<NameEntry[]>(namesOf(franchise?.names));
  const [kind, setKind] = useState<string>(franchise?.kind ?? defaults?.kind ?? '');
  const [ownership, setOwnership] = useState<string>(franchise?.ownership_model ?? '');
  const [status, setStatus] = useState<string>(franchise?.status ?? 'active');
  const [parent, setParent] = useState(franchise?.parent ?? defaults?.parent ?? '');
  const [description, setDescription] = useState(franchise?.description ?? '');
  const [announced, setAnnounced] = useState(d10(franchise?.announcement_date));
  const [styleGuide, setStyleGuide] = useState(franchise?.style_guide_version ?? '');
  const [originalWork, setOriginalWork] = useState(franchise?.original_work ?? '');
  const [committee, setCommittee] = useState(franchise?.committee ?? '');
  const [image, setImage] = useState<File | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const blocked = useMemo(() => (franchise === null ? new Set<string>() : new Set([franchise.id, ...descendantIds(franchises, franchise.id)])), [franchise, franchises]);
  const parentOptions = franchises.filter((f) => !blocked.has(f.id)).map((f) => ({ value: f.id, label: f.name }));

  const submit = async (): Promise<void> => {
    if (name.trim() === '') {
      setError(t('Enter the name.'));
      return;
    }
    setBusy(true);
    const data: Record<string, unknown> = {
      name: name.trim(),
      names: names.filter((n) => n.value.trim() !== '').map((n) => ({ script: n.script, value: n.value.trim() })),
      kind,
      ownership_model: ownership,
      status,
      parent,
      description: description.trim(),
      announcement_date: toPb(announced),
      style_guide_version: styleGuide.trim(),
    };
    if (on('titles')) data['original_work'] = originalWork;
    if (on('committees')) data['committee'] = committee;
    try {
      const saved = franchise === null ? await createRecord<FranchiseRec>('franchises', data) : await updateRecord<FranchiseRec>('franchises', franchise.id, data);
      await saveImage('franchises', saved.id, image, imageRemoved);
      toast.success(franchise === null ? t('Franchise created') : t('Saved'));
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
      title={franchise === null ? t('New franchise') : t('Edit franchise')}
      description={t('A franchise groups the characters, titles, agreements and trademarks of one brand, series or group.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {franchise === null ? t('Create franchise') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={t('Name')} value={name} onChange={(e) => setName(e.target.value)} error={error !== '' ? error : undefined} autoFocus />
        <NamesEditor value={names} onChange={setNames} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Kind')} value={kind} placeholder={t('Not set')} options={enumOptions('franchises.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
          <Select
            label={t('Ownership model')}
            value={ownership}
            placeholder={t('Not set')}
            options={enumOptions('franchises.ownership_model').map(([value, label]) => ({ value, label }))}
            onChange={(e) => setOwnership(e.target.value)}
          />
          <Select label={t('Status')} value={status} options={enumOptions('franchises.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
          <Select label={t('Part of')} value={parent} placeholder={t('Top level')} options={parentOptions} onChange={(e) => setParent(e.target.value)} />
          <DateField label={t('Announcement date')} value={announced} onChange={setAnnounced} help={t('Until this date the franchise is confidential; filings before it are kept quiet.')} />
          <Input label={t('Style guide version')} value={styleGuide} onChange={(e) => setStyleGuide(e.target.value)} placeholder="v2.1" />
          {on('titles') && <CatalogSelect kind="work" label={t('Original work')} value={originalWork} onChange={setOriginalWork} />}
          {on('committees') && (
            <RecordPicker<CommitteeRec> collection="committees" label={t('Production committee')} value={committee} onChange={(id) => setCommittee(id)} labelOf={(c) => c.name} searchFields={['name']} />
          )}
        </div>
        <Textarea label={t('Description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <ImageField record={franchise} current={franchise?.image ?? ''} file={image} removed={imageRemoved} onFile={setImage} onRemove={setImageRemoved} />
      </div>
    </Dialog>
  );
}

/** Edit the © lines per territory. */
export function CopyrightLinesDialog({ franchise, onClose }: { franchise: FranchiseRec; onClose: () => void }): React.JSX.Element {
  const [rows, setRows] = useState<EditRow[]>(() => asRows<CopyrightLine>(franchise.copyright_lines).map((l) => ({ territory: l.territory || 'WORLD', text: l.text ?? '' })));
  const [busy, setBusy] = useState(false);
  const options = [{ value: 'WORLD', label: t('Everywhere else (default)') }, ...PLACE_CODES.map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` }))];
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const lines: CopyrightLine[] = rows.filter((r) => (r['text'] ?? '').trim() !== '').map((r) => ({ territory: r['territory'] ?? 'WORLD', text: (r['text'] ?? '').trim() }));
      await updateRecord('franchises', franchise.id, { copyright_lines: lines });
      toast.success(t('Saved'));
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
      title={t('Copyright lines')}
      description={t('The notice to print on products and materials in each territory, for example © Studio / Committee. The default line applies where no territory line exists.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        <RowsEditor
          label={t('Lines|copyright')}
          cols={[
            { key: 'territory', label: t('Territory'), kind: 'select', options, grow: 1 },
            { key: 'text', label: t('Copyright line'), placeholder: '© ...', grow: 2 },
          ]}
          rows={rows}
          onChange={setRows}
          addLabel={t('Add a line|copyright')}
        />
      </div>
    </Dialog>
  );
}
