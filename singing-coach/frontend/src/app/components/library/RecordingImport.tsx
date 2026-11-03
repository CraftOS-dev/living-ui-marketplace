/**
 * A song from a recording: drop an mp3 (or wav, m4a, ogg, flac, webm) of a
 * song with music or of a voice alone. A song with music is first split
 * into its voice and its music on this computer (Demucs, on the graphics
 * card where the browser allows); the melody is then followed in the voice
 * alone, the beat, key and chords in the music, and the words heard
 * (Whisper) with their timing. The person checks the beat by ear, corrects
 * the bars (metre, twice or half as fast, bar 1 a beat earlier or later),
 * hears the voice and the music apart, corrects the words or pastes the
 * published lyrics (which keep the timing), and hands the notation on to be
 * checked and added, with the recording, its voice and its music kept for
 * practice.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronLeft, ChevronRight, FileAudio, Mic, Music2, Play, Square, TriangleAlert, Wand2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import type { BackingMap } from '../../lib/types.ts';
import { audio } from '../../music/audio.ts';
import { heardLines, layTimed, syllablesOf, timeText } from '../../music/lyrics.ts';
import { DEMUCS, WHISPER, WHISPER_BYTES, haveModel } from '../../music/models.ts';
import { fromNotes } from '../../music/musicxml.ts';
import { stopSound } from '../../music/play.ts';
import { backingMap, defaultChoice, gridOf, layWords, previewOf, quarterOf, separateAndListen, transcribe } from '../../music/recording.ts';
import type { GridChoice, StemsDone, TranscribeResult } from '../../music/recording.ts';
import { segmentsFor } from '../../music/separate.ts';
import { Contour } from '../charts.tsx';
import { Button, Field, IconButton, Input, Segmented, Select, Textarea, Toggle, errMessage } from '../ui.tsx';

export interface Stem {
  blob: Blob;
  ext: 'ogg' | 'wav';
}

export interface RecordingDone {
  abc: string;
  title: string;
  warnings: string[];
  backing: { file: File; map: BackingMap; voice: Stem | null; music: Stem | null } | null;
}

const KEYS_MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const KEYS_MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
const ACCEPT = '.mp3,.wav,.wave,.m4a,.aac,.mp4,.ogg,.oga,.opus,.flac,.webm,audio/*';
const MAX_BYTES = 80 * 1024 * 1024;

/** The languages Whisper is asked for by name (any other it may still tell by itself). */
const LANGUAGES: [string, string][] = [
  ['ja', 'Japanese'],
  ['en', 'English'],
  ['zh', 'Chinese'],
  ['ko', 'Korean'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['ru', 'Russian'],
  ['id', 'Indonesian'],
  ['ms', 'Malay'],
  ['tl', 'Tagalog'],
  ['vi', 'Vietnamese'],
  ['th', 'Thai'],
  ['hi', 'Hindi'],
];
const languageName = (code: string | null): string => LANGUAGES.find(([c]) => c === code)?.[1] ?? (code ?? '').toUpperCase();

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function minutes(s: number): string {
  return s < 90 ? `about ${Math.max(1, Math.round(s / 60))} minute${Math.round(s / 60) > 1 ? 's' : ''}` : `about ${Math.round(s / 60)} minutes`;
}

function titleFrom(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A stereo file whose channels differ is a mix; one channel (or two the same) is a voice memo. */
function guessMode(buf: AudioBuffer): 'mix' | 'voice' {
  if (buf.numberOfChannels < 2) return 'voice';
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  let side = 0;
  let mid = 0;
  for (let i = 0; i < l.length; i += 97) {
    side += (l[i]! - r[i]!) ** 2;
    mid += (l[i]! + r[i]!) ** 2;
  }
  return side > mid * 0.002 ? 'mix' : 'voice';
}

async function hasGpu(): Promise<boolean> {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return g !== undefined && (await g.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

type Hearing = 'beat' | 'voice' | 'music';

export function RecordingImport({ onDone }: { onDone: (r: RecordingDone) => void }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<'mix' | 'voice'>('mix');
  const [title, setTitle] = useState('');
  const [words, setWords] = useState('');
  const [keep, setKeep] = useState(true);
  const [split, setSplit] = useState(true);
  const [findWords, setFindWords] = useState(true);
  const [language, setLanguage] = useState('');
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [fetched, setFetched] = useState<{ sep: boolean; words: boolean } | null>(null);
  const [progress, setProgress] = useState<{ p: number; stage: string; since: number } | null>(null);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [stems, setStems] = useState<StemsDone | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [choice, setChoice] = useState<GridChoice | null>(null);
  const [playing, setPlaying] = useState<Hearing | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const timer = useRef(0);
  const job = useRef<{ cancel: () => void } | null>(null);
  const decoded = useRef(new Map<Hearing, AudioBuffer>());

  useEffect(() => {
    let live = true;
    void hasGpu().then((g) => live && setGpu(g));
    void Promise.all([haveModel(DEMUCS), Promise.all(Object.values(WHISPER).map(haveModel)).then((xs) => xs.every(Boolean))]).then(([sep, w]) => live && setFetched({ sep, words: w }));
    return () => {
      live = false;
      window.clearTimeout(timer.current);
      job.current?.cancel();
      stopSound();
    };
  }, []);

  const grid = useMemo(() => (result !== null && choice !== null ? gridOf(result, choice) : null), [result, choice]);
  const separating = mode === 'mix' && split;

  const pick = (f: File | undefined): void => {
    if (f === undefined) return;
    if (f.size > MAX_BYTES) {
      toast.error('That file is over 80 MB. An mp3 or m4a of the song is plenty.');
      return;
    }
    setDecoding(true);
    setResult(null);
    setStems(null);
    setChoice(null);
    decoded.current.clear();
    f.arrayBuffer()
      .then((data) => audio.ensure().decodeAudioData(data))
      .then((buf) => {
        if (buf.duration < 3) throw new Error('The recording is shorter than three seconds.');
        if (buf.duration > 15 * 60) throw new Error('The recording is longer than fifteen minutes; use a single song.');
        setFile(f);
        setBuffer(buf);
        setMode(guessMode(buf));
        setTitle(titleFrom(f.name));
      })
      .catch((err: unknown) => toast.error(err instanceof Error && /decode|Unable|EncodingError/i.test(err.message + err.name) ? 'This file could not be read as audio. Try an mp3, wav or m4a.' : errMessage(err)))
      .finally(() => setDecoding(false));
  };

  const accept = (r: TranscribeResult, out: StemsDone | null): void => {
    if (r.notes.length < 4) throw new Error(mode === 'mix' ? 'Hardly any singing was found. If the recording is a voice alone, choose "Just a voice"; a song needs a clear lead voice.' : 'Hardly any singing was found. Is the recording of a voice?');
    setStems(out);
    setResult(r);
    setChoice(defaultChoice(r));
    setLyrics(words.trim() !== '' ? words : out?.heard != null ? heardLines(out.heard) : '');
  };

  const analyse = (): void => {
    if (buffer === null || file === null) return;
    const since = Date.now();
    setProgress({ p: 0, stage: 'Reading the recording', since });
    setResult(null);
    setStems(null);
    decoded.current.clear();
    if (separating) {
      const j = separateAndListen(file, findWords, language, (p, stage) => setProgress({ p, stage, since }));
      job.current = j;
      j.done
        .then((out) => job.current === j && accept(out.result, out))
        .catch((err: unknown) => job.current === j && toast.error(errMessage(err)))
        .finally(() => {
          if (job.current === j) {
            job.current = null;
            setProgress(null);
            setFetched({ sep: true, words: findWords || (fetched?.words ?? false) });
          }
        });
      return;
    }
    transcribe(buffer, mode, (p, stage) => setProgress({ p, stage, since }))
      .then((r) => accept(r, null))
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setProgress(null));
  };

  const stop = (): void => {
    job.current?.cancel();
    job.current = null;
    setProgress(null);
  };

  const hear = (what: Hearing): void => {
    window.clearTimeout(timer.current);
    stopSound();
    if (playing === what) {
      setPlaying(null);
      return;
    }
    if (buffer === null || grid === null) return;
    const ctx = audio.ensure();
    // From a bar before bar 1, twelve seconds; the beat with a click on every beat (bar lines brighter).
    const startBeat = Math.max(0, grid.downbeat - grid.meter);
    const from = grid.beats[startBeat] ?? 0;
    const go = (buf: AudioBuffer): void => {
      const dur = Math.min(12, buf.duration - from);
      const when = ctx.currentTime + 0.12;
      audio.playBacking(buf, when, from, dur, true);
      if (what === 'beat') for (let b = startBeat; b < grid.beats.length && grid.beats[b]! - from < dur; b++) audio.click(when + grid.beats[b]! - from, (((b - grid.downbeat) % grid.meter) + grid.meter) % grid.meter === 0);
      setPlaying(what);
      timer.current = window.setTimeout(() => setPlaying(null), dur * 1000 + 200);
    };
    if (what === 'beat') return go(buffer);
    const stem = what === 'voice' ? stems?.voice : stems?.music;
    if (stem === undefined) return;
    const have = decoded.current.get(what);
    if (have !== undefined) return go(have);
    stem.blob
      .arrayBuffer()
      .then((d) => ctx.decodeAudioData(d))
      .then((b) => {
        decoded.current.set(what, b);
        go(b);
      })
      .catch(() => toast.error('That part could not be played.'));
  };

  const finish = (): void => {
    if (result === null || grid === null || file === null || buffer === null || choice === null) return;
    stopSound();
    try {
      const heard = stems?.heard ?? null;
      const timed = heard !== null && heard.length > 0 && lyrics.trim() !== '';
      const laid = timed ? layTimed(grid.notes, syllablesOf(lyrics, timeText(lyrics, heard)), quarterOf(result, choice)) : layWords(grid.notes, lyrics);
      const imp = fromNotes({ notes: laid.notes, chords: grid.chords, meter: grid.meter, bpm: grid.bpm, fifths: result.key.fifths, mode: result.key.mode, title: title.trim() || titleFrom(file.name), words: laid.syllables > 0 });
      const warnings = [...imp.warnings];
      warnings.unshift('The notes were found by listening: play the song through and fix any note that is off in the notation before adding it.');
      if (laid.unplaced > 0) warnings.push(timed ? `${laid.unplaced} syllable${laid.unplaced === 1 ? '' : 's'} share a note with the one before; check where the words fall.` : `${laid.unplaced} syllable${laid.unplaced === 1 ? '' : 's'} more than there were notes went under the last note of a line; check where the words fall.`);
      onDone({
        abc: imp.abc,
        title: imp.title,
        warnings,
        backing: keep ? { file, map: backingMap(result, grid, imp.bar1Q, buffer.numberOfChannels >= 2 ? 2 : 1, mode), voice: stems?.voice ?? null, music: stems?.music ?? null } : null,
      });
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  /* ---------------------------------------------------------------- views */

  if (file === null || buffer === null)
    return (
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files[0]);
        }}
        disabled={decoding}
        className={cn('sc-focus flex h-48 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--sc-radius)] border border-dashed transition-colors', drag ? 'border-[var(--sc-ink)] bg-[var(--sc-hover)]' : 'border-[var(--sc-line-2)] hover:bg-[var(--sc-hover)]')}
      >
        <FileAudio size={22} strokeWidth={1.6} aria-hidden className="text-[var(--sc-muted)]" />
        <span className="text-[13px] font-medium">{decoding ? 'Reading the file…' : 'Drop a recording or click to choose'}</span>
        <span className="sc-label">.mp3 · .wav · .m4a · .ogg · .flac</span>
        <span className="max-w-[460px] text-center text-[11.5px] leading-4 text-[var(--sc-muted)]">A song with music, or a voice alone. The voice is separated from the music, and the melody, beat, key, chords and words are found, all on this computer. The recording, its voice and its music stay with the song for practice.</span>
        <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      </button>
    );

  const segs = segmentsFor(Math.round(buffer.duration * 44100));
  const sepSecs = segs * (gpu === true ? 3.4 : 45) + 15;
  const wordSecs = findWords ? buffer.duration * (gpu === true ? 0.35 : 6) : 0;
  const downloads = [fetched?.sep === false ? `the separator (${Math.round(DEMUCS.size / 1e6)} MB)` : '', findWords && fetched?.words === false ? `the word listener (${Math.round(WHISPER_BYTES / 1e6)} MB)` : ''].filter((x) => x !== '');
  const eta = progress !== null && progress.p > 0.03 ? ((Date.now() - progress.since) / 1000) * ((1 - progress.p) / progress.p) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-3 py-2.5">
        <AudioLines size={18} aria-hidden className="shrink-0 text-[var(--sc-muted)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{file.name}</span>
          <span className="sc-label block normal-case tracking-normal">
            {clock(buffer.duration)} · {buffer.numberOfChannels >= 2 ? 'stereo' : 'mono'} · {(file.size / 1024 / 1024).toFixed(1)} MB
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => (stopSound(), setFile(null), setBuffer(null), setResult(null), setStems(null))} disabled={progress !== null}>
          Choose another
        </Button>
      </div>

      {result === null ? (
        <>
          <Field label="What is in it?">
            <Segmented
              value={mode}
              onChange={setMode}
              label="What is in it"
              options={[
                { value: 'mix', label: 'A song with music' },
                { value: 'voice', label: 'Just a voice' },
              ]}
            />
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {mode === 'mix' && (
            <div className="flex flex-col gap-3 rounded-[var(--sc-radius)] bg-[var(--sc-sunk)] px-3 py-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                <Toggle checked={split} onChange={setSplit} label="Separate the voice from the music" disabled={progress !== null} />
                <span className="min-w-0">
                  <span className="block">Separate the voice from the music</span>
                  <span className="block text-[11.5px] leading-4 text-[var(--sc-muted)]">
                    {gpu === null ? 'Checking this computer…' : gpu ? `On this computer's graphics card: ${minutes(sepSecs)} for this song.` : `This browser cannot use the graphics card, so the processor does it: ${minutes(sepSecs)} for this song.`} The melody is then read from the voice alone and the chords from the music alone, and in practice you can turn the voice and the music on and off.
                  </span>
                </span>
              </label>
              {split && (
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-[13px]">
                    <Toggle checked={findWords} onChange={setFindWords} label="Find the words" disabled={progress !== null} />
                    <span className="min-w-0">
                      <span className="block">Find the words</span>
                      <span className="block text-[11.5px] leading-4 text-[var(--sc-muted)]">Heard from the voice with their timing{gpu === false ? `; ${minutes(wordSecs)} on the processor` : ''}. You can correct them before adding the song.</span>
                    </span>
                  </label>
                  {findWords && (
                    <Select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language of the words" className="w-44" disabled={progress !== null}>
                      <option value="">Tell the language</option>
                      {LANGUAGES.map(([c, n]) => (
                        <option key={c} value={c}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
              {split && downloads.length > 0 && <p className="text-[11.5px] leading-4 text-[var(--sc-muted)]">The first time, {downloads.join(' and ')} {downloads.length > 1 ? 'are' : 'is'} downloaded once and kept on this computer.</p>}
            </div>
          )}
          <Field label="Words (optional)" hint={separating && findWords ? 'Leave empty to have them heard, or paste the lyrics, one sung line per line: they are timed to the singing.' : 'Paste the lyrics, one sung line per line. They are split into syllables and laid under the notes; you can move them in the notation.'}>
            <Textarea value={words} onChange={(e) => setWords(e.target.value)} minRows={3} maxRows={10} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <Toggle checked={keep} onChange={setKeep} label="Keep the recording for practice" />
            <span>{separating ? 'Keep the recording, its voice and its music for practice' : "Keep the recording as the song's backing track"}</span>
          </label>
          {progress !== null ? (
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--sc-line)]">
                <div className="h-full rounded-full bg-[var(--sc-ink)] transition-[width] duration-300" style={{ width: `${Math.round(progress.p * 100)}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="sc-label flex-1 normal-case tracking-normal">
                  {progress.stage}… {Math.round(progress.p * 100)}%{eta !== null && eta > 20 ? ` · ${minutes(eta)} left` : ''}
                </span>
                {separating && (
                  <Button size="sm" variant="ghost" icon={Square} onClick={stop}>
                    Stop
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Button variant="primary" icon={Wand2} onClick={analyse} className="self-start">
              {separating ? 'Separate and find the melody' : 'Find the melody'}
            </Button>
          )}
        </>
      ) : grid !== null && choice !== null ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
            <span>
              <span className="sc-mono">{grid.notes.length}</span> notes
            </span>
            <span>
              <span className="sc-mono">{Math.round(grid.bpm)}</span> beats a minute
            </span>
            <span>
              <span className="sc-mono">{grid.meter}/4</span>
            </span>
            <span>{(result.key.mode === 'minor' ? KEYS_MINOR : KEYS_MAJOR)[result.key.fifths + 7]?.replace('b', '♭').replace('#', '♯')} {result.key.mode}</span>
            <span className="text-[var(--sc-muted)]">{grid.chords.length > 0 ? `${grid.chords.length} chord changes heard` : 'chords to be worked out from the melody'}</span>
            {stems !== null && <span className="text-[var(--sc-muted)]">voice and music separated</span>}
            {Math.abs(result.tuning) >= 15 && <span className="text-[var(--sc-muted)]">tuned {result.tuning > 0 ? '+' : '−'}{Math.abs(result.tuning)}¢ from A440</span>}
          </div>
          <div className="rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-2 py-2">
            <Contour preview={previewOf(grid)} height={88} />
          </div>
          {(result.confidence < 0.55 || result.voiced < 0.15) && (
            <p className="flex items-start gap-2 text-[12.5px] leading-5 text-[var(--sc-warn)]">
              <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
              The voice was hard to follow in this recording; expect to correct a number of notes.
            </p>
          )}
          <div className="flex flex-col gap-2 rounded-[var(--sc-radius)] bg-[var(--sc-sunk)] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={playing === 'beat' ? Square : Play} onClick={() => hear('beat')}>
                {playing === 'beat' ? 'Stop' : 'Hear the beat'}
              </Button>
              {stems !== null && (
                <>
                  <Button size="sm" icon={playing === 'voice' ? Square : Mic} onClick={() => hear('voice')}>
                    {playing === 'voice' ? 'Stop' : 'Voice alone'}
                  </Button>
                  <Button size="sm" icon={playing === 'music' ? Square : Music2} onClick={() => hear('music')}>
                    {playing === 'music' ? 'Stop' : 'Music alone'}
                  </Button>
                </>
              )}
              <span className="min-w-[220px] flex-1 text-[12px] leading-4 text-[var(--sc-muted)]">The recording with a click on every beat, brighter on each bar line. Correct it below until the clicks sit right.</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented value={String(choice.meter) as '3' | '4'} onChange={(v) => (stopSound(), setPlaying(null), setChoice({ ...choice, meter: Number(v) as 3 | 4 }))} label="Metre" size="sm" options={[{ value: '3', label: '3/4' }, { value: '4', label: '4/4' }]} />
              <Segmented
                value={String(choice.speed) as '0.5' | '1' | '2'}
                onChange={(v) => (stopSound(), setPlaying(null), setChoice({ ...choice, speed: Number(v) as 1 | 2 | 0.5, shift: 0 }))}
                label="Speed"
                size="sm"
                options={[
                  { value: '0.5', label: 'Half', title: 'The beat found was twice too fast' },
                  { value: '1', label: 'As found' },
                  { value: '2', label: 'Double', title: 'The beat found was twice too slow' },
                ]}
              />
              <span className="flex items-center gap-1">
                <span className="sc-label mr-1">Bar 1</span>
                <IconButton icon={ChevronLeft} label="Bar 1 a beat earlier" size={26} onClick={() => (stopSound(), setPlaying(null), setChoice({ ...choice, shift: choice.shift - 1 }))} />
                <span className="sc-mono w-8 text-center text-[12px]">{choice.shift > 0 ? `+${choice.shift}` : choice.shift}</span>
                <IconButton icon={ChevronRight} label="Bar 1 a beat later" size={26} onClick={() => (stopSound(), setPlaying(null), setChoice({ ...choice, shift: choice.shift + 1 }))} />
              </span>
            </div>
          </div>
          <Field
            label="Words"
            hint={
              stems?.heard != null && stems.heard.length > 0
                ? `Heard in ${languageName(stems.language)} from the voice, with their timing. Correct what was misheard, or paste the published lyrics in their place: they keep the timing.`
                : stems?.heard != null
                  ? 'No words were made out in the voice. Paste the lyrics, one sung line per line, to lay them under the notes.'
                  : 'Paste the lyrics, one sung line per line. They are split into syllables and laid under the notes; you can move them in the notation.'
            }
          >
            <Textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} minRows={3} maxRows={12} aria-label="Words" />
          </Field>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => (stopSound(), setPlaying(null), setResult(null), setStems(null))}>
              Back
            </Button>
            <span className="flex-1" />
            <Button variant="primary" onClick={finish}>
              Add and edit
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
