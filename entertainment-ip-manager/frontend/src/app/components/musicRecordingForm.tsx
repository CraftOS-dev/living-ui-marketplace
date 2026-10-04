/**
 * Create or edit a recording (the master), and make a new version of one
 * (TV size, instrumental, live, remix...) through music/new-version, which
 * copies the credits and leaves the new version without an ISRC until one
 * is assigned.
 */
import { useState } from 'react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, opToast, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, t, tn } from '../lib/i18n.ts';
import { navigate } from '../lib/router.ts';
import type { CharacterRec, RecordingRec, SongRec, TalentRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { MultiRecordPicker, RecordPicker } from './pickers.tsx';
import { Field, Notice } from './ui.tsx';
import { CheckRow, ConsentNotice, OwnersEditor, fmtIsrc, isrcShapeOk, masterOwners, masterOwnersJson } from './musicShared.tsx';
import type { MasterOwner } from './musicShared.tsx';

interface RecDraft {
  title: string;
  song: string;
  songs: string[];
  isrc: string;
  version_type: string;
  duration_sec: string;
  recording_date: string;
  p_line: string;
  owners: MasterOwner[];
  virtual_singer: boolean;
  virtual_singer_note: string;
  captured_in_av: boolean;
  sound_only_consent: boolean;
  consent_note: string;
  talents: string[];
  characters: string[];
  status: string;
  notes: string;
}

function draftOf(r: RecordingRec | null, songId: string, title: string): RecDraft {
  return {
    title: r?.title ?? title,
    song: r?.song ?? songId,
    songs: r?.songs ?? [],
    isrc: r !== null && r.isrc !== '' ? fmtIsrc(r.isrc) : '',
    version_type: r?.version_type || 'studio',
    duration_sec: r !== null && r.duration_sec > 0 ? String(r.duration_sec) : '',
    recording_date: d10(r?.recording_date),
    p_line: r?.p_line ?? '',
    owners: masterOwners(r?.master_owners),
    virtual_singer: r?.virtual_singer ?? false,
    virtual_singer_note: r?.virtual_singer_note ?? '',
    captured_in_av: r?.captured_in_av ?? false,
    sound_only_consent: r?.sound_only_consent ?? false,
    consent_note: r?.consent_note ?? '',
    talents: r?.talents ?? [],
    characters: r?.characters ?? [],
    status: r?.status || 'draft',
    notes: r?.notes ?? '',
  };
}

export function IsrcHelp({ value }: { value: string }): React.JSX.Element {
  if (value.trim() !== '' && !isrcShapeOk(value)) {
    return <span className="text-amber-700 dark:text-amber-400">{t('An ISRC has 12 characters: country (2), registrant (3), year (2), number (5), for example JP-ABC-26-00001.')}</span>;
  }
  return <span>{t('12 characters, for example JP-ABC-26-00001. Every version (TV size, instrumental, live, remix, cover) needs its own.')}</span>;
}

export function RecordingDialog({
  recording,
  songId = '',
  songTitle = '',
  onClose,
  onSaved,
}: {
  /** null to create. */
  recording: RecordingRec | null;
  songId?: string | undefined;
  songTitle?: string | undefined;
  onClose: () => void;
  onSaved: (r: RecordingRec) => void;
}): React.JSX.Element {
  const { on } = useApp();
  const [d, setD] = useState<RecDraft>(() => draftOf(recording, songId, songTitle));
  const [busy, setBusy] = useState(false);
  const creating = recording === null;
  const set = <K extends keyof RecDraft>(k: K, v: RecDraft[K]): void => setD((x) => ({ ...x, [k]: v }));

  const save = async (): Promise<void> => {
    if (d.title.trim() === '') return;
    setBusy(true);
    const data: Record<string, unknown> = {
      title: d.title.trim(),
      song: d.song,
      isrc: d.isrc.trim(),
      version_type: d.version_type,
      recording_date: toPb(d.recording_date),
      status: d.status,
    };
    if (!creating) {
      data['songs'] = d.songs;
      data['duration_sec'] = d.duration_sec.trim() === '' ? 0 : Number(d.duration_sec);
      data['p_line'] = d.p_line.trim();
      data['master_owners'] = masterOwnersJson(d.owners);
      data['virtual_singer'] = d.virtual_singer;
      data['virtual_singer_note'] = d.virtual_singer_note.trim();
      data['captured_in_av'] = d.captured_in_av;
      data['sound_only_consent'] = d.captured_in_av ? d.sound_only_consent : false;
      data['consent_note'] = d.consent_note.trim();
      data['talents'] = d.talents;
      data['characters'] = d.characters;
      data['notes'] = d.notes;
    }
    try {
      const rec = recording === null ? await createRecord<RecordingRec>('recordings', data) : await updateRecord<RecordingRec>('recordings', recording.id, data);
      onSaved(rec);
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
      title={creating ? t('New recording') : t('Edit recording')}
      description={t('The master: one fixed recording of a song, with its own ISRC and owners.')}
      className="max-h-[92vh] w-[min(94vw,44rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={d.title.trim() === ''}>
            {creating ? t('Create recording') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('Recording title')} required>
          <Input value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <RecordPicker<SongRec>
            collection="songs"
            label={t('Song')}
            value={d.song}
            onChange={(id) => set('song', id)}
            labelOf={(s) => s.title}
            searchFields={['title', 'iswc']}
          />
          <Field label={t('Version|recording')}>
            <Select value={d.version_type} options={enumOptions('recordings.version_type').map(([value, label]) => ({ value, label }))} onChange={(e) => set('version_type', e.target.value)} />
          </Field>
          <Field label={t('ISRC')} help={<IsrcHelp value={d.isrc} />}>
            <Input value={d.isrc} placeholder="JP-ABC-26-00001" onChange={(e) => set('isrc', e.target.value)} className="font-mono" />
          </Field>
          <Field label={t('Recording date')}>
            <Input type="date" value={d.recording_date} onChange={(e) => set('recording_date', e.target.value)} />
          </Field>
          <Field label={t('Status')}>
            <Select value={d.status} options={enumOptions('recordings.status').map(([value, label]) => ({ value, label }))} onChange={(e) => set('status', e.target.value)} />
          </Field>
          {!creating && (
            <Field label={t('Duration (seconds)')}>
              <Input type="number" min={0} value={d.duration_sec} onChange={(e) => set('duration_sec', e.target.value)} />
            </Field>
          )}
        </div>
        {!creating && (
          <>
            <MultiRecordPicker<SongRec>
              collection="songs"
              label={t('Other songs in this recording (medley)')}
              value={d.songs}
              onChange={(v) => set('songs', v)}
              labelOf={(s) => s.title}
              searchFields={['title', 'iswc']}
            />
            <Field label={t('P-line')} help={t('The sound recording notice, for example (P) 2026 Example Records.')}>
              <Input value={d.p_line} onChange={(e) => set('p_line', e.target.value)} />
            </Field>
            <OwnersEditor value={d.owners} onChange={(v) => set('owners', v)} />
            {on('talents') && (
              <MultiRecordPicker<TalentRec>
                collection="talents"
                label={t('Talents')}
                value={d.talents}
                onChange={(v) => set('talents', v)}
                labelOf={(x) => x.stage_name}
                searchFields={['stage_name']}
              />
            )}
            {on('franchises') && (
              <MultiRecordPicker<CharacterRec>
                collection="characters"
                label={t('Characters')}
                value={d.characters}
                onChange={(v) => set('characters', v)}
                labelOf={(c) => c.name}
                searchFields={['name']}
              />
            )}
            <CheckRow
              checked={d.virtual_singer}
              onChange={(v) => set('virtual_singer', v)}
              label={t('Sung by a virtual singer')}
              help={t('A voice synthesizer or voicebank sings. Note the voicebank and its licence terms.')}
            />
            {d.virtual_singer && (
              <Field label={t('Virtual singer note')}>
                <Input value={d.virtual_singer_note} onChange={(e) => set('virtual_singer_note', e.target.value)} />
              </Field>
            )}
            <CheckRow
              checked={d.captured_in_av}
              onChange={(v) => set('captured_in_av', v)}
              label={t('Recorded for a film or anime')}
              help={t('The performance was first captured in an audiovisual work (an episode, a film, a music video).')}
            />
            {d.captured_in_av && (
              <CheckRow
                checked={d.sound_only_consent}
                onChange={(v) => set('sound_only_consent', v)}
                label={t('Performers consented to a sound-only release')}
                help={t('Copyright Act art. 91(2): needed before a CD, download or streaming release of the sound alone.')}
              />
            )}
            <ConsentNotice captured={d.captured_in_av} consent={d.sound_only_consent} />
            {d.captured_in_av && (
              <Field label={t('Consent note')}>
                <Input value={d.consent_note} onChange={(e) => set('consent_note', e.target.value)} placeholder={t('Who consented, when, and where the paper is')} />
              </Field>
            )}
            <Field label={t('Notes')}>
              <Textarea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

interface NewVersionResult {
  id: string;
  title: string;
  credits_copied: number;
  warnings: Bi[];
}

const VERSION_TYPES = ['tv_size', 'instrumental', 'a_cappella', 'live', 'remix', 'cover', 'music_video', 'studio', 'other'] as const;

export function NewVersionDialog({ source, onClose }: { source: RecordingRec; onClose: () => void }): React.JSX.Element {
  const [vt, setVt] = useState<string>('tv_size');
  const [isrc, setIsrc] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const sameIsrc = isrc.trim() !== '' && source.isrc !== '' && isrcShapeOk(isrc) && fmtIsrc(isrc) === fmtIsrc(source.isrc);

  const submit = async (): Promise<void> => {
    setBusy(true);
    const body: Record<string, unknown> = { recording_id: source.id, version_type: vt };
    if (isrc.trim() !== '') body['isrc'] = isrc.trim();
    if (title.trim() !== '') body['title'] = title.trim();
    if (date !== '') body['recording_date'] = date;
    const r = await opToast<NewVersionResult>('music/new-version', body);
    setBusy(false);
    if (r === null) return;
    toast.success(tn(r.credits_copied, 'Version created. {n} credit copied.', 'Version created. {n} credits copied.'));
    for (const w of r.warnings) toast.info(bi(w));
    onClose();
    navigate('recording', r.id);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('New version')}
      description={t('A TV size, instrumental, live, remix or cover is a separate recording with its own ISRC. Credits and owners are copied from this one.')}
      className="max-h-[92vh] w-[min(94vw,36rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={sameIsrc}>
            {t('Create version')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('Version|recording')}>
          <Select value={vt} options={VERSION_TYPES.map((v) => ({ value: v, label: enumLabel('recordings.version_type', v) }))} onChange={(e) => setVt(e.target.value)} />
        </Field>
        <Field label={t('Title of the new version')} help={t('Leave empty to use "{title}" with the version in brackets.', { title: source.title })}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('New ISRC')} help={<IsrcHelp value={isrc} />} error={sameIsrc ? t('A new version needs its own ISRC, not the one of the original.') : undefined}>
          <Input value={isrc} placeholder="JP-ABC-26-00002" onChange={(e) => setIsrc(e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('Recording date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {isrc.trim() === '' && <Notice tone="warn">{t('No ISRC yet. You can add it later, but assign one before release: every version needs its own.')}</Notice>}
        {vt === 'instrumental' && <Notice tone="info">{t('Featured singers are not copied to an instrumental version.')}</Notice>}
      </div>
    </Dialog>
  );
}
