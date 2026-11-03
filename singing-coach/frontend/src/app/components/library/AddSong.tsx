/**
 * Adding a song, three ways: ask the coach (it writes the tune and words at
 * your level and in your range), write it in ABC notation with w: lines, or
 * import a file (ABC, MusicXML with lyrics and a piano part, an UltraStar
 * song), which opens in the notation tab to check before adding. An import
 * with no chord symbols gets chords worked out from its piano part or its
 * melody, written into the notation where they can be corrected.
 */
import { useEffect, useRef, useState } from 'react';
import { AudioLines, FileUp, PenLine, Send, Sparkle } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { LEVEL_NAMES } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import { importFile } from '../../music/musicxml.ts';
import { Button, Dialog, Field, Input, Segmented, Select, Textarea, errMessage } from '../ui.tsx';
import { NotationEditor, useCheck } from './NotationEditor.tsx';
import { RecordingImport } from './RecordingImport.tsx';
import type { RecordingDone } from './RecordingImport.tsx';

type Tab = 'ask' | 'write' | 'import' | 'record';
type Kind = 'song' | 'vocalise';

export function LevelSelect({ value, onChange }: { value: number; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
      {LEVEL_NAMES.slice(1).map((n, i) => (
        <option key={n} value={i + 1}>
          {i + 1} · {n}
        </option>
      ))}
    </Select>
  );
}

export function KindSelect({ value, onChange }: { value: Kind; onChange: (v: Kind) => void }): React.JSX.Element {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as Kind)}>
      <option value="song">Song</option>
      <option value="vocalise">Vocalise</option>
    </Select>
  );
}

export function AddSong({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('ask');
  const [ask, setAsk] = useState('');
  const [level, setLevel] = useState(app.settings?.level ?? 1);
  const [abc, setAbc] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('song');
  const [levelTouched, setLevelTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [source, setSource] = useState<'you' | 'import'>('you');
  // A song made from a recording: the file goes up as its backing track once the song is added.
  const [pending, setPending] = useState<RecordingDone['backing']>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const { result, busy: checking } = useCheck(tab === 'write' ? abc : '');

  useEffect(() => {
    if (open) {
      setTab('ask');
      setAsk('');
      setAbc('');
      setTitle('');
      setKind('song');
      setLevel(app.settings?.level ?? 1);
      setLevelTouched(false);
      setSource('you');
      setPending(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The level the notation suggests, until the person picks one.
  useEffect(() => {
    if (!levelTouched && result?.ok === true && result.summary !== undefined) setLevel(result.summary.level);
  }, [result, levelTouched]);

  const sendAsk = (): void => {
    if (ask.trim() === '') return;
    setBusy(true);
    api
      .send({ text: ask.trim(), kind: 'request', context: { view: 'library', request: 'song', level } })
      .then((r) => {
        onClose();
        if (r.asked) toast.success('Your coach is on it');
        else toast.info(`Saved. ${r.reason}`);
        navigate('coach');
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };

  /** Add the song, attach its recording (and its voice and music), then open it in the library or the editor. */
  const addSong = async (p: { abc: string; title: string; level: number; kind: Kind; source: 'you' | 'import'; backing: RecordingDone['backing'] }, then: 'library' | 'edit'): Promise<void> => {
    const r = await api.addSong({ abc: p.abc, title: p.title.trim() === '' ? undefined : p.title.trim(), level: p.level, kind: p.kind, source: p.source });
    const b = p.backing;
    if (b !== null) {
      try {
        await api.songBacking(r.song.id, b.file, b.file.name, b.map);
        const base = b.file.name.replace(/\.[a-z0-9]+$/i, '');
        if (b.voice !== null) await api.songStem(r.song.id, 'voice', b.voice.blob, `${base} (voice).${b.voice.ext}`);
        if (b.music !== null) await api.songStem(r.song.id, 'music', b.music.blob, `${base} (music).${b.music.ext}`);
        toast.success(b.voice !== null ? `Added ${r.song.title}, with its recording, voice and music` : `Added ${r.song.title}, with its recording as the backing track`);
      } catch (err) {
        toast.error(`Added ${r.song.title}, but the recording could not be attached: ${errMessage(err)}`);
      }
    } else toast.success(`Added ${r.song.title}`);
    onClose();
    if (then === 'edit') navigate('edit', { song: r.song.id, back: 'library' });
    else navigate('library', { song: r.song.id });
  };

  const add = (): void => {
    setBusy(true);
    addSong({ abc, title, level, kind, source, backing: pending }, 'library')
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };

  /**
   * A song from a recording goes straight into the library at the level its
   * notation suggests, and opens in the editor (to check the notes and words
   * by ear against the recording). If it cannot be added as it is, the
   * notation opens here with its problems.
   */
  const fromRecording = (r: RecordingDone): void => {
    for (const w of r.warnings.slice(1)) toast.info(w);
    setBusy(true);
    api
      .check(r.abc)
      .then((c) => addSong({ abc: r.abc, title: r.title, level: c.summary?.level ?? level, kind: 'song', source: 'import', backing: r.backing }, 'edit'))
      .catch((err: unknown) => {
        toast.error(errMessage(err));
        setAbc(r.abc);
        setTitle(r.title);
        setSource('import');
        setPending(r.backing);
        setTab('write');
      })
      .finally(() => setBusy(false));
  };

  const load = (f: File | undefined): void => {
    if (f === undefined) return;
    importFile(f)
      .then((r) => {
        setAbc(r.abc);
        setTitle(r.title);
        setSource('import');
        setTab('write');
        for (const w of r.warnings) toast.info(w);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a song"
      width={tab === 'write' ? 760 : tab === 'record' ? 680 : 600}
      footer={
        tab === 'ask' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="coach" icon={Send} busy={busy} disabled={ask.trim() === ''} onClick={sendAsk}>
              Ask the coach
            </Button>
          </>
        ) : tab === 'write' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy} disabled={result?.ok !== true || checking} onClick={add}>
              Add to library
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          value={tab}
          onChange={setTab}
          label="How"
          options={[
            { value: 'ask', label: 'Ask the coach', icon: Sparkle },
            { value: 'write', label: 'Write notation', icon: PenLine },
            { value: 'import', label: 'Import a file', icon: FileUp },
            { value: 'record', label: 'From a recording', icon: AudioLines },
          ]}
        />
        {tab === 'ask' && (
          <div className="flex flex-col gap-3">
            <Field label="Song or vocalise" hint="Public-domain and traditional songs come with their words; for anything else the coach writes an original tune or a wordless vocalise.">
              <Textarea
                autoFocus
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendAsk();
                }}
                minRows={3}
                placeholder="Shenandoah in a key that suits my voice"
              />
            </Field>
            <Field label="Level" className="max-w-[260px]">
              <LevelSelect value={level} onChange={setLevel} />
            </Field>
          </div>
        )}
        {tab === 'write' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px_150px]">
              <Field label="Title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={result?.summary?.title || 'From T: in the notation'} />
              </Field>
              <Field label="Level">
                <LevelSelect
                  value={level}
                  onChange={(v) => {
                    setLevel(v);
                    setLevelTouched(true);
                  }}
                />
              </Field>
              <Field label="Kind">
                <KindSelect value={kind} onChange={setKind} />
              </Field>
            </div>
            <NotationEditor value={abc} onChange={setAbc} result={result} busy={checking} rows={14} />
            <p className="text-[11.5px] leading-[16px] text-[var(--sc-muted)]">
              One line of notes, then its words on a <span className="sc-mono">w:</span> line (one syllable per note, <span className="sc-mono">-</span> between syllables, <span className="sc-mono">_</span> to hold one over the next note); a second <span className="sc-mono">w:</span> line is verse two. Chord symbols in quotes give the accompaniment; <span className="sc-mono">!breath!</span> marks a breath.
            </p>
          </div>
        )}
        {tab === 'record' && <RecordingImport onDone={fromRecording} />}
        {tab === 'write' && pending !== null && (
          <p className="flex items-center gap-2 rounded-[var(--sc-radius-sm)] bg-[var(--sc-sunk)] px-3 py-2 text-[12px] text-[var(--sc-ink-2)]">
            <AudioLines size={14} aria-hidden className="shrink-0 text-[var(--sc-muted)]" />
            <span className="min-w-0 flex-1 truncate">{pending.voice !== null ? `${pending.file.name}, its voice and its music are attached when you add the song.` : `${pending.file.name} is attached as the backing track when you add the song.`}</span>
            <button type="button" onClick={() => setPending(null)} className="sc-focus sc-label rounded hover:text-[var(--sc-ink)]">
              Detach
            </button>
          </p>
        )}
        {tab === 'import' && (
          <button
            type="button"
            onClick={() => file.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              load(e.dataTransfer.files[0]);
            }}
            className={cn('sc-focus flex h-44 flex-col items-center justify-center gap-2 rounded-[var(--sc-radius)] border border-dashed transition-colors', drag ? 'border-[var(--sc-ink)] bg-[var(--sc-hover)]' : 'border-[var(--sc-line-2)] hover:bg-[var(--sc-hover)]')}
          >
            <FileUp size={22} strokeWidth={1.6} aria-hidden className="text-[var(--sc-muted)]" />
            <span className="text-[13px] font-medium">Drop a file or click to choose</span>
            <span className="sc-label">.abc · .musicxml · .xml · .mxl · UltraStar .txt</span>
            <span className="max-w-[420px] text-center text-[11.5px] leading-4 text-[var(--sc-muted)]">The sung line and its words are read, and a piano part is kept as the accompaniment. Chord symbols are kept; when a file has none, they are worked out from the piano part or the melody.</span>
            <input ref={file} type="file" accept=".abc,.txt,.musicxml,.xml,.mxl" className="hidden" onChange={(e) => (load(e.target.files?.[0]), (e.target.value = ''))} />
          </button>
        )}
      </div>
    </Dialog>
  );
}
