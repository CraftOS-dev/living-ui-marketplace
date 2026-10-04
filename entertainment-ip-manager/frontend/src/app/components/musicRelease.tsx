/**
 * Releases: a single, album or bundle that carries recordings, with UPC,
 * catalogue number, label, distributor and the track list (disc and track
 * number per recording). The release date also dates the record
 * producer's right (Copyright Act art. 101).
 */
import { useMemo, useState } from 'react';
import { Disc3, Plus } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { d10, fmtDate, toPb } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import type { RecordingRec, ReleaseRec } from '../lib/records.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { MultiRecordPicker, PartyPicker } from './pickers.tsx';
import { EmptyHint, EnumPill, Field, Loading, Ref, Section } from './ui.tsx';
import { Dash, RowsHeader, fmtIsrc, tracks as parseTracks } from './musicShared.tsx';
import { canDelete, deleteCol } from './deleteRecord.tsx';
import type { Track } from './musicShared.tsx';

function syncTracks(current: Track[], ids: string[]): Track[] {
  const kept = current.filter((x) => ids.includes(x.recording));
  const have = new Set(kept.map((x) => x.recording));
  let next = kept.filter((x) => x.disc === 1).reduce((m, x) => Math.max(m, x.track_no), 0);
  const added: Track[] = [];
  for (const id of ids) {
    if (have.has(id)) continue;
    next += 1;
    added.push({ recording: id, track_no: next, disc: 1 });
  }
  return [...kept, ...added];
}

function recLabel(r: RecordingRec): string {
  return r.isrc !== '' ? `${r.title} · ${fmtIsrc(r.isrc)}` : r.title;
}

export function ReleaseDialog({
  release,
  presetRecording = '',
  readOnly = false,
  onClose,
}: {
  release: ReleaseRec | null;
  presetRecording?: string | undefined;
  readOnly?: boolean | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(release?.title ?? '');
  const [format, setFormat] = useState<string>(release?.format || 'digital_single');
  const [status, setStatus] = useState<string>(release?.status || 'planned');
  const [upc, setUpc] = useState(release?.upc ?? '');
  const [catNo, setCatNo] = useState(release?.catalogue_no ?? '');
  const [date, setDate] = useState(d10(release?.release_date));
  const [label, setLabel] = useState(release?.label ?? '');
  const [distributor, setDistributor] = useState(release?.distributor ?? '');
  const [recIds, setRecIds] = useState<string[]>(() => release?.recordings ?? (presetRecording !== '' ? [presetRecording] : []));
  const [trackList, setTrackList] = useState<Track[]>(() => syncTracks(parseTracks(release?.tracks), release?.recordings ?? (presetRecording !== '' ? [presetRecording] : [])));
  const [notes, setNotes] = useState(release?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const recs = useCollection<RecordingRec>('recordings', { filter: recIds.length > 0 ? recIds.map((id) => `id = "${id}"`).join(' || ') : 'id = ""' });
  const titles = useMemo(() => new Map(recs.records.map((r) => [r.id, recLabel(r)])), [recs.records]);
  const ordered = useMemo(() => [...trackList].sort((a, b) => a.disc - b.disc || a.track_no - b.track_no), [trackList]);

  const setRecs = (ids: string[]): void => {
    setRecIds(ids);
    setTrackList((tl) => syncTracks(tl, ids));
  };
  const setTrack = (rec: string, patch: Partial<Track>): void => setTrackList((tl) => tl.map((x) => (x.recording === rec ? { ...x, ...patch } : x)));

  const save = async (): Promise<void> => {
    if (title.trim() === '') return;
    setBusy(true);
    const data: Record<string, unknown> = {
      title: title.trim(),
      format,
      status,
      upc: upc.trim(),
      catalogue_no: catNo.trim(),
      release_date: toPb(date),
      label,
      distributor,
      recordings: recIds,
      tracks: ordered.map((x) => ({ recording: x.recording, track_no: x.track_no, disc: x.disc })),
      notes,
    };
    try {
      if (release === null) await createRecord('releases', data);
      else await updateRecord('releases', release.id, data);
      toast.success(release === null ? t('Release added') : t('Saved'));
      onClose();
    } catch {
      /* the client shows the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={release === null ? t('New release') : t('Release')}
      description={t('A single, album or bundle and the recordings on it.')}
      className="max-h-[92vh] w-[min(94vw,42rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {readOnly ? t('Close') : t('Cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={() => void save()} loading={busy} disabled={title.trim() === ''}>
              {t('Save')}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <Field label={t('Release title')} required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Format|release')}>
            <Select value={format} options={enumOptions('releases.format').map(([value, l]) => ({ value, label: l }))} onChange={(e) => setFormat(e.target.value)} />
          </Field>
          <Field label={t('Status')}>
            <Select value={status} options={enumOptions('releases.status').map(([value, l]) => ({ value, label: l }))} onChange={(e) => setStatus(e.target.value)} />
          </Field>
          <Field label={t('UPC or JAN')}>
            <Input value={upc} onChange={(e) => setUpc(e.target.value)} className="font-mono" inputMode="numeric" />
          </Field>
          <Field label={t('Catalogue number')}>
            <Input value={catNo} onChange={(e) => setCatNo(e.target.value)} className="font-mono" placeholder="ABCD-12345" />
          </Field>
          <Field label={t('Release date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div />
          <PartyPicker label={t('Label')} value={label} onChange={(id) => setLabel(id)} />
          <PartyPicker label={t('Distributor|release')} value={distributor} onChange={(id) => setDistributor(id)} />
        </div>
        <MultiRecordPicker<RecordingRec> collection="recordings" label={t('Recordings')} value={recIds} onChange={setRecs} labelOf={recLabel} searchFields={['title', 'isrc']} />
        {ordered.length > 0 && (
          <div className="flex flex-col gap-2">
            <RowsHeader title={t('Track list')} help={t('Disc and track number of each recording.')} />
            <div className="border border-[var(--agent-app-border)]">
              <div className="grid grid-cols-[4rem_4rem_minmax(0,1fr)] gap-2 border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                <span>{t('Disc')}</span>
                <span>{t('Track|number')}</span>
                <span>{t('Recording')}</span>
              </div>
              {ordered.map((x) => (
                <div key={x.recording} className="grid grid-cols-[4rem_4rem_minmax(0,1fr)] items-center gap-2 border-b border-[var(--agent-app-border)]/70 px-2 py-1.5 last:border-0">
                  <Input aria-label={t('Disc')} type="number" min={1} value={String(x.disc)} onChange={(e) => setTrack(x.recording, { disc: Math.max(1, Number(e.target.value) || 1) })} />
                  <Input aria-label={t('Track|number')} type="number" min={1} value={String(x.track_no)} onChange={(e) => setTrack(x.recording, { track_no: Math.max(1, Number(e.target.value) || 1) })} />
                  <span className="min-w-0 truncate text-[13px]">{titles.get(x.recording) ?? '...'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label={t('Notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
    </Dialog>
  );
}

export function ReleasesSection({ recordingId }: { recordingId?: string | undefined }): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<ReleaseRec>('releases', {
    ...(recordingId !== undefined ? { filter: `recordings.id ?= "${recordingId}"` } : {}),
    sort: '-release_date,-created',
  });
  const [dialog, setDialog] = useState<{ release: ReleaseRec | null } | null>(null);
  const cols: Col<ReleaseRec>[] = [
    { key: 'title', label: t('Release title'), render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'format', label: t('Format|release'), value: (r) => enumLabel('releases.format', r.format), render: (r) => enumLabel('releases.format', r.format) || <Dash /> },
    { key: 'upc', label: t('UPC or JAN'), render: (r) => (r.upc !== '' ? <Ref>{r.upc}</Ref> : <Dash />) },
    { key: 'catalogue_no', label: t('Catalogue number'), render: (r) => (r.catalogue_no !== '' ? <Ref>{r.catalogue_no}</Ref> : <Dash />) },
    { key: 'release_date', label: t('Release date'), value: (r) => d10(r.release_date), render: (r) => fmtDate(r.release_date) || <Dash /> },
    { key: 'tracks', label: t('Tracks|count'), align: 'right', value: (r) => r.recordings.length },
    { key: 'status', label: t('Status'), value: (r) => enumLabel('releases.status', r.status), render: (r) => <EnumPill field="releases.status" value={r.status} /> },
  ];
  return (
    <Section
      title={t('Releases')}
      meta={list.records.length ? String(list.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ release: null })}>
            <Plus size={13} aria-hidden /> {t('Add release')}
          </Button>
        ) : undefined
      }
    >
      {list.loading ? (
        <Loading />
      ) : (
        <DataTable<ReleaseRec>
          tableId={recordingId !== undefined ? 'recording-releases' : 'music-releases'}
          rows={list.records}
          columns={[...cols, ...deleteCol<ReleaseRec>('releases', canDelete(can, 'releases'))]}
          onRowClick={(r) => setDialog({ release: r })}
          exportName="releases"
          empty={
            <EmptyHint
              icon={Disc3}
              title={t('No releases yet')}
              message={
                recordingId !== undefined
                  ? t('This recording is not on any release yet. Its first release dates the record producer\'s right.')
                  : t('Add singles, albums and bundles with their UPC, catalogue number and track list.')
              }
              action={
                can.edit ? (
                  <Button size="sm" onClick={() => setDialog({ release: null })}>
                    <Plus size={13} aria-hidden /> {t('Add release')}
                  </Button>
                ) : undefined
              }
              compact
            />
          }
        />
      )}
      {dialog !== null && <ReleaseDialog release={dialog.release} presetRecording={recordingId} readOnly={!can.edit} onClose={() => setDialog(null)} />}
    </Section>
  );
}
