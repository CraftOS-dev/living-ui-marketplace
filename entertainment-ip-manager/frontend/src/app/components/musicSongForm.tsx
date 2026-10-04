/**
 * Create or edit a song (the composition: melody and lyrics). Creating asks
 * for the essentials; the full form (names, characters, fan covers) opens
 * from the song page.
 */
import { useState } from 'react';
import { Button, Dialog, Input, Select, Textarea } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import type { CharacterRec, SongRec } from '../lib/records.ts';
import type { NameEntry } from '../lib/shapes.ts';
import { CatalogSelect, MultiRecordPicker } from './pickers.tsx';
import { Field } from './ui.tsx';
import { CheckRow, LYRICS_LANGUAGES, NamesEditor, lyricsLanguageLabel } from './musicShared.tsx';

interface SongDraft {
  title: string;
  names: NameEntry[];
  iswc: string;
  lyrics_language: string;
  original: boolean;
  franchise: string;
  work: string;
  characters: string[];
  tie_up_use: string;
  first_publication: string;
  copyright_line: string;
  fan_cover_allowed: boolean;
  fan_cover_note: string;
  status: string;
  notes: string;
}

function draftOf(s: SongRec | null, preset: Partial<SongDraft>): SongDraft {
  return {
    title: s?.title ?? preset.title ?? '',
    names: (s?.names ?? []).map((n) => ({ script: n.script, value: n.value })),
    iswc: s?.iswc ?? '',
    lyrics_language: s?.lyrics_language ?? 'ja',
    original: s?.original ?? true,
    franchise: s?.franchise ?? preset.franchise ?? '',
    work: s?.work ?? preset.work ?? '',
    characters: s?.characters ?? preset.characters ?? [],
    tie_up_use: s?.tie_up_use || 'none',
    first_publication: d10(s?.first_publication),
    copyright_line: s?.copyright_line ?? '',
    fan_cover_allowed: s?.fan_cover_allowed ?? false,
    fan_cover_note: s?.fan_cover_note ?? '',
    status: s?.status || 'draft',
    notes: s?.notes ?? '',
  };
}

export function SongDialog({
  song,
  preset,
  onClose,
  onSaved,
}: {
  /** null to create. */
  song: SongRec | null;
  preset?: Partial<SongDraft> | undefined;
  onClose: () => void;
  onSaved: (s: SongRec) => void;
}): React.JSX.Element {
  const { on } = useApp();
  const [d, setD] = useState<SongDraft>(() => draftOf(song, preset ?? {}));
  const [busy, setBusy] = useState(false);
  const creating = song === null;
  const set = <K extends keyof SongDraft>(k: K, v: SongDraft[K]): void => setD((x) => ({ ...x, [k]: v }));
  const langs: string[] = [...LYRICS_LANGUAGES];
  if (d.lyrics_language !== '' && !langs.includes(d.lyrics_language)) langs.push(d.lyrics_language);

  const save = async (): Promise<void> => {
    if (d.title.trim() === '') return;
    setBusy(true);
    const data: Record<string, unknown> = {
      title: d.title.trim(),
      iswc: d.iswc.trim(),
      lyrics_language: d.lyrics_language,
      original: d.original,
      franchise: d.franchise,
      work: d.work,
      tie_up_use: d.tie_up_use,
      first_publication: toPb(d.first_publication),
      status: d.status,
    };
    if (!creating) {
      data['names'] = d.names.filter((n) => n.value.trim() !== '').map((n) => ({ script: n.script, value: n.value.trim() }));
      data['characters'] = d.characters;
      data['copyright_line'] = d.copyright_line.trim();
      data['fan_cover_allowed'] = d.fan_cover_allowed;
      data['fan_cover_note'] = d.fan_cover_note.trim();
      data['notes'] = d.notes;
    } else if (d.characters.length > 0) {
      data['characters'] = d.characters;
    }
    try {
      const rec = song === null ? await createRecord<SongRec>('songs', data) : await updateRecord<SongRec>('songs', song.id, data);
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
      title={creating ? t('New song') : t('Edit song')}
      description={t('The composition: melody and lyrics. Recordings of it are added separately.')}
      className="max-h-[92vh] w-[min(94vw,40rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={d.title.trim() === ''}>
            {creating ? t('Create song') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('Song title')} required>
          <Input value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </Field>
        {!creating && <NamesEditor value={d.names} onChange={(v) => set('names', v)} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ISWC')} help={t('Format T-123.456.789-0. The check digit is verified when you save.')}>
            <Input value={d.iswc} placeholder="T-123.456.789-0" onChange={(e) => set('iswc', e.target.value)} className="font-mono" />
          </Field>
          <Field label={t('Lyrics language')}>
            <Select value={d.lyrics_language} options={langs.map((l) => ({ value: l, label: lyricsLanguageLabel(l) }))} onChange={(e) => set('lyrics_language', e.target.value)} />
          </Field>
          <Field label={t('Tie-up use')}>
            <Select value={d.tie_up_use} options={enumOptions('songs.tie_up_use').map(([value, label]) => ({ value, label }))} onChange={(e) => set('tie_up_use', e.target.value)} />
          </Field>
          <Field label={t('Status')}>
            <Select value={d.status} options={enumOptions('songs.status').map(([value, label]) => ({ value, label }))} onChange={(e) => set('status', e.target.value)} />
          </Field>
          {on('franchises') && (
            <Field label={t('Franchise')}>
              <CatalogSelect kind="franchise" value={d.franchise} onChange={(v) => set('franchise', v)} />
            </Field>
          )}
          {on('titles') && (
            <Field label={t('Title')}>
              <CatalogSelect kind="work" value={d.work} onChange={(v) => set('work', v)} />
            </Field>
          )}
          <Field label={t('First publication')} help={t('The day the song was first released or performed in public.')}>
            <Input type="date" value={d.first_publication} onChange={(e) => set('first_publication', e.target.value)} />
          </Field>
        </div>
        <CheckRow
          checked={d.original}
          onChange={(v) => set('original', v)}
          label={t('Our own song')}
          help={t('We or our writers control the composition. Untick for a cover of someone else\'s song.')}
        />
        {!creating && (
          <>
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
            <Field label={t('Copyright line')} help={t('As printed on releases, for example (c) 2026 Example Music Publishing.')}>
              <Input value={d.copyright_line} onChange={(e) => set('copyright_line', e.target.value)} />
            </Field>
            <CheckRow
              checked={d.fan_cover_allowed}
              onChange={(v) => set('fan_cover_allowed', v)}
              label={t('Fans may cover this song')}
              help={t('Cover songs (歌ってみた) and singing streams by fans. Platform licences cover the composition; the note says what fans may use.')}
            />
            <Field label={t('Fan cover note')}>
              <Textarea rows={2} value={d.fan_cover_note} onChange={(e) => set('fan_cover_note', e.target.value)} placeholder={t('For example: off-vocal track available on request; no commercial use')} />
            </Field>
            <Field label={t('Notes')}>
              <Textarea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
