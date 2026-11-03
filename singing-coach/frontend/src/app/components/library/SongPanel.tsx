/**
 * One song, docked on the right: its tune against your comfortable range and
 * the key that fits, what it is (first words, language, where it comes from),
 * where to start, and how it is going: each section's stage and best take,
 * the best takes over time, the bars that go wrong most and the last takes.
 * Edit, reset or remove it here.
 */
import { useEffect, useRef, useState } from 'react';
import { AudioLines, Code2, Ear, Headphones, Minus, Mic, MoreHorizontal, Music2, PenLine, Play, Plus, RotateCcw, Sparkle, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { STAGE_LABEL, ago, bars as barsText, cents, clock, dueText, levelName, minutes as fmtMinutes, pad2, shift as fmtShift } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { Mode, Song, Stage } from '../../lib/types.ts';
import { noteLabel } from '../../music/dial.ts';
import { BarErrors, Contour, Ladders, RangeBar, Ring } from '../charts.tsx';
import { Button, Dialog, Field, IconButton, Input, MenuItem, MenuSep, Popover, Sheet, Spinner, StageDots, Textarea, errMessage, useConfirm } from '../ui.tsx';
import { KindSelect, LevelSelect } from './AddSong.tsx';
import { NotationEditor, useCheck } from './NotationEditor.tsx';

const STAGE_MODE: Record<Stage, Mode> = { new: 'echo', learning: 'sing', steady: 'solo', mastered: 'solo' };
const MODE_ICON: Record<Mode, typeof Ear> = { listen: Headphones, echo: Ear, sing: Music2, solo: Mic };
const KEYS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR_PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };

/** "G major" moved by n semitones → "A major". */
function keyMoved(key: string, n: number): string {
  const m = /^([A-G][#b]?)\s*(.*)$/.exec(key.trim());
  if (m === null || n === 0) return key;
  const pc = MAJOR_PC[m[1] ?? 'C'];
  if (pc === undefined) return key;
  return `${KEYS[(((pc + n) % 12) + 12) % 12]} ${m[2] ?? ''}`.trim();
}

export function SongPanel({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const song = useLive(() => api.song(id), ['songs', 'progress'], [id], 150, 1000);
  const stats = useLive(() => api.songStats(id), ['runs', 'progress'], [id], 300, 2000);
  const [editing, setEditing] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const s = song.data?.song ?? null;
  const voice = app.state?.voice ?? null;
  const tested = voice?.tested === true;
  const comf: [number, number] | null = tested && voice !== null ? [voice.comf_low, voice.comf_high] : null;

  useEffect(() => {
    if (s !== null && !s.seen) void api.openSong(s.id).catch(() => undefined);
  }, [s]);

  const practise = (p: Record<string, string | number | undefined>): void => navigate('practice', { song: id, ...p });

  const move = (n: number): void => {
    if (s === null) return;
    setMoving(true);
    api
      .transpose(s.id, Math.max(-12, Math.min(12, n)))
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setMoving(false));
  };

  const remove = async (): Promise<void> => {
    setMenu(false);
    if (s === null) return;
    if (!(await confirm(`"${s.title}" leaves the library; its practice history stays.`, 'Remove this song?'))) return;
    api
      .removeSong(s.id)
      .then(() => {
        onClose();
        toast.success(`Removed ${s.title}`);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const unattach = async (): Promise<void> => {
    setMenu(false);
    if (s === null) return;
    if (!(await confirm('The song stays; the piano accompanies it from now on.', 'Remove the recording?', 'Remove'))) return;
    api
      .removeBacking(s.id)
      .then(() => toast.success('Recording removed'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const reset = async (): Promise<void> => {
    setMenu(false);
    if (s === null) return;
    if (!(await confirm('Every section goes back to new. Past takes stay in the history.', 'Start this song over?', 'Start over'))) return;
    api.resetSong(s.id).catch((err: unknown) => toast.error(errMessage(err)));
  };

  return (
    <Sheet open onClose={onClose} label={s?.title ?? 'Song'} width={540}>
      {s === null ? (
        <div className="flex flex-1 items-center justify-center text-[var(--sc-muted)]">{song.error !== null ? song.error : <Spinner size={18} />}</div>
      ) : (
        <>
          <header className="flex shrink-0 items-start gap-2 px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <div className="sc-label mb-1">
                Level {pad2(s.level)} · {levelName(s.level)}
                {s.kind === 'vocalise' ? ' · Vocalise' : ''}
              </div>
              <h2 className="truncate text-[19px] font-semibold tracking-[-0.01em]">{s.title}</h2>
              <div className="truncate text-[13px] text-[var(--sc-muted)]">{s.composer}</div>
            </div>
            <IconButton ref={menuAnchor} icon={MoreHorizontal} label="More" onClick={() => setMenu((m) => !m)} active={menu} />
            <IconButton icon={X} label="Close" onClick={onClose} />
            <Popover anchor={menuAnchor} open={menu} onClose={() => setMenu(false)} align="end" width={200}>
              <MenuItem icon={PenLine} onClick={() => (setMenu(false), navigate('edit', { song: s.id, back: 'library' }))}>
                Edit the song
              </MenuItem>
              <MenuItem icon={Code2} onClick={() => (setMenu(false), setEditing(true))}>
                Edit as notation
              </MenuItem>
              <MenuItem icon={RotateCcw} onClick={() => void reset()}>
                Start over
              </MenuItem>
              {s.backing != null && (
                <MenuItem icon={AudioLines} onClick={() => void unattach()}>
                  Remove the recording
                </MenuItem>
              )}
              <MenuSep />
              <MenuItem icon={Trash2} danger onClick={() => void remove()}>
                Remove
              </MenuItem>
            </Popover>
          </header>
          <div className="sc-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            <div className="sc-panel overflow-hidden bg-[var(--sc-raised)] px-2 py-2">
              <Contour preview={s.preview} height={110} band={comf} shift={s.key_shift} sweep />
            </div>
            {s.first_words !== '' && <p className="mt-2.5 line-clamp-2 text-[13px] italic leading-5 text-[var(--sc-ink-2)]">“{s.first_words}…”</p>}
            <div className="sc-label mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <span>{keyMoved(s.key, s.key_shift)}</span>
              <span>{s.meter}</span>
              <span>♩ {Math.round(s.tempo)}</span>
              <span>{s.bars} bars</span>
              <span>{clock(s.seconds)}</span>
              <span>
                {s.phrases} phrases · longest {Math.round(s.longest_phrase_s)}s
              </span>
              {s.verses > 1 && <span>{s.verses} verses</span>}
              {s.language !== '' && <span>{s.language.toUpperCase()}</span>}
            </div>

            <section className="mt-4 rounded-[var(--sc-radius)] border border-[var(--sc-line)] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="sc-label flex-1">Range in this key</span>
                <span className="sc-mono text-[12px]">
                  {noteLabel(s.low + s.key_shift)}–{noteLabel(s.high + s.key_shift)} · {s.span} st
                </span>
              </div>
              {comf !== null ? (
                <>
                  <RangeBar low={s.low + s.key_shift} high={s.high + s.key_shift} comf={comf} className="mt-2" />
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-[12px] leading-4 text-[var(--sc-muted)]">
                      {s.fit === null || s.fit === undefined
                        ? 'Your comfortable range is shaded.'
                        : !s.fit.fits
                          ? 'Wider than your comfortable range in any key: sing the top and bottom lightly, or ask the coach for an easier version.'
                          : s.key_shift === s.fit.best_shift
                            ? 'In the key that suits your voice best.'
                            : `Suits your voice best at ${fmtShift(s.fit.best_shift)} (${keyMoved(s.key, s.fit.best_shift)}).`}
                    </span>
                    {s.fit !== null && s.fit !== undefined && s.fit.fits && s.key_shift !== s.fit.best_shift && (
                      <Button size="sm" busy={moving} onClick={() => move(s.fit?.best_shift ?? 0)}>
                        Use it
                      </Button>
                    )}
                    <span className="flex items-center gap-0.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)]">
                      <IconButton icon={Minus} label="Key down a semitone" size={26} onClick={() => move(s.key_shift - 1)} disabled={moving || s.key_shift <= -12} />
                      <span className="sc-mono w-7 text-center text-[12px]" title="Semitones from the written key">
                        {fmtShift(s.key_shift)}
                      </span>
                      <IconButton icon={Plus} label="Key up a semitone" size={26} onClick={() => move(s.key_shift + 1)} disabled={moving || s.key_shift >= 12} />
                    </span>
                  </div>
                </>
              ) : (
                <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--sc-muted)]">
                  <span className="flex-1">Find your range once and every song shows whether it fits, and in which key.</span>
                  <Button size="sm" onClick={() => navigate('settings', { section: 'voice' })}>
                    Find my range
                  </Button>
                </div>
              )}
            </section>

            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" size="lg" icon={Play} onClick={() => practise({ mode: s.status === 'new' ? 'echo' : 'sing' })} className="flex-1">
                {s.status === 'new' ? 'Start learning' : 'Practise'}
              </Button>
              <Button size="lg" icon={Headphones} onClick={() => practise({ mode: 'listen', tempo: 100 })}>
                Listen
              </Button>
              <Button size="lg" icon={PenLine} onClick={() => navigate('edit', { song: s.id, back: 'library' })} title="Edit the notes, words, chords and key">
                Edit
              </Button>
            </div>

            {s.backing != null && (
              <p className="mt-3 flex items-center gap-2 text-[12.5px] leading-5 text-[var(--sc-ink-2)]">
                <AudioLines size={14} aria-hidden className="shrink-0 text-[var(--sc-muted)]" />
                {s.backing.voice != null && s.backing.music != null
                  ? "Made from a recording whose voice and music were separated: in practice, turn the singer and the band on or off (at the recording's own key and speed)."
                  : "Made from a recording, which plays as the backing track (at the recording's own key and speed)."}
              </p>
            )}
            {s.note !== '' && (
              <div className="sc-in mt-4 flex gap-2.5 rounded-[var(--sc-radius)] border-l-2 border-[var(--sc-coach)] bg-[var(--sc-coach-soft)] px-3 py-2.5">
                <Sparkle size={15} aria-hidden className="mt-0.5 shrink-0 text-[var(--sc-coach)]" />
                <p className="text-[13px] leading-5 text-[var(--sc-ink)]">{s.note}</p>
              </div>
            )}

            <section className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="sc-label">Sections</h3>
                <span className="flex items-center gap-2">
                  <Ring value={s.progress.pct} size={22} stroke={2} />
                  <span className="sc-mono text-[11px] text-[var(--sc-muted)]">{Math.round(s.progress.pct * 100)}%</span>
                </span>
              </div>
              <ul className="flex flex-col">
                {s.sections.map((x, i) => {
                  const mode = STAGE_MODE[x.stage];
                  const Icon = MODE_ICON[mode];
                  return (
                    <li key={x.i} className="sc-in" style={{ animationDelay: `${i * 30}ms` }}>
                      <button type="button" onClick={() => practise({ from: x.from, to: x.to, mode })} className="sc-focus group flex w-full items-center gap-3 border-b border-[var(--sc-hair)] px-1 py-2 text-left transition-colors hover:bg-[var(--sc-hover)]">
                        <span className="sc-mono w-7 shrink-0 text-[12px] font-semibold">{x.name.length <= 3 ? x.name : pad2(i + 1)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">{x.name.length > 3 ? x.name : barsText(x.from, x.to)}</span>
                          <span className="sc-label block">
                            {STAGE_LABEL[x.stage]}
                            {x.stage === 'mastered' && x.due !== '' ? ` · review ${dueText(x.due)}` : ''}
                            {x.name.length > 3 ? ` · ${barsText(x.from, x.to)}` : ''}
                          </span>
                        </span>
                        <StageDots stage={x.stage} />
                        <span className="w-[86px] shrink-0">
                          <span className="block h-[3px] overflow-hidden rounded-full bg-[var(--sc-line)]">
                            <span className="block h-full rounded-full bg-[var(--sc-ink)] transition-[width] duration-700" style={{ width: `${Math.min(100, x.best)}%` }} />
                          </span>
                          <span className="sc-mono mt-0.5 block text-right text-[10.5px] text-[var(--sc-muted)]">{x.best > 0 ? `${x.best}%` : '—'}</span>
                        </span>
                        <span className="flex w-12 shrink-0 items-center justify-end gap-1 text-[var(--sc-faint)] transition-colors group-hover:text-[var(--sc-ink)]">
                          <span className="sc-label text-inherit">{mode}</span>
                          <Icon size={13} aria-hidden />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="mt-5">
              <h3 className="sc-label mb-2">Best take, by section</h3>
              {stats.data === null ? (
                <div className="sc-skel h-[120px]" />
              ) : stats.data.ladders.some((l) => l.points.length > 0) ? (
                <Ladders ladders={stats.data.ladders} />
              ) : (
                <p className="text-[12.5px] text-[var(--sc-muted)]">Each section's best take of the day lands here, climbing toward clean.</p>
              )}
            </section>

            {stats.data !== null && stats.data.bars.length > 0 && (
              <section className="mt-5">
                <h3 className="sc-label mb-2">Notes off, by bar</h3>
                <BarErrors bars={stats.data.bars} />
              </section>
            )}

            {s.recent !== undefined && s.recent.length > 0 && (
              <section className="mt-5">
                <h3 className="sc-label mb-1.5">Last takes</h3>
                <ul className="flex flex-col">
                  {s.recent.slice(0, 6).map((r) => {
                    const Icon = MODE_ICON[r.mode];
                    return (
                      <li key={r.id}>
                        <div className="flex w-full items-center gap-2.5 border-b border-[var(--sc-hair)] px-1 py-1.5 text-[12.5px]">
                          <Icon size={13} aria-hidden className="shrink-0 text-[var(--sc-muted)]" />
                          <span className="sc-mono w-14 shrink-0 text-[11px] text-[var(--sc-muted)]">{r.day.slice(5)}</span>
                          <span className="min-w-0 flex-1 truncate">{takeBars(r.bars)}</span>
                          <span className="sc-mono w-10 shrink-0 text-right text-[11px] text-[var(--sc-muted)]" title="Key">
                            {fmtShift(r.key)}
                          </span>
                          <span className="sc-mono w-12 shrink-0 text-right text-[11px] text-[var(--sc-muted)]" title="Average lean">
                            {cents(r.bias_c)}
                          </span>
                          <span className="sc-mono w-10 shrink-0 text-right" title="On pitch">
                            {Math.round(r.pitch * 100)}%
                          </span>
                          <span className={cn('size-1.5 shrink-0 rounded-full', r.clean ? 'bg-[var(--sc-good)]' : 'bg-[var(--sc-line-2)]')} title={r.clean ? 'Clean' : 'Not clean yet'} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {s.gloss !== undefined && s.gloss !== '' && (
              <section className="mt-5">
                <h3 className="sc-label mb-1.5">About the words</h3>
                <p className="whitespace-pre-line text-[12.5px] leading-5 text-[var(--sc-ink-2)]">{s.gloss}</p>
              </section>
            )}

            <section className="mt-5 grid grid-cols-3 gap-2">
              <Fact label="Practised" value={fmtMinutes(s.progress.minutes)} />
              <Fact label="Takes" value={String(s.progress.runs)} />
              <Fact label="Last" value={s.progress.last_at !== '' ? ago(s.progress.last_at) : '—'} />
            </section>
            {(s.source_note !== '' || s.licence !== '') && (
              <p className="sc-label mt-3 normal-case tracking-normal">
                {s.licence === 'pd' ? 'Public domain' : s.licence === 'trad' ? 'Traditional' : s.licence === 'own' ? 'Your own' : s.licence === 'import' ? 'Imported' : ''}
                {s.source_note !== '' ? ` · ${s.source_note}` : ''}
              </p>
            )}
          </div>
          {editing && <EditSong song={s} onClose={() => setEditing(false)} />}
          {confirmEl}
        </>
      )}
    </Sheet>
  );
}

function takeBars(v: string): string {
  const [a, b] = v.split('-').map(Number);
  return barsText(a ?? 1, b ?? a ?? 1);
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-[var(--sc-radius-sm)] bg-[var(--sc-sunk)] px-2.5 py-2">
      <div className="sc-label text-[9.5px]">{label}</div>
      <div className="sc-mono mt-0.5 truncate text-[13px]">{value}</div>
    </div>
  );
}

function EditSong({ song, onClose }: { song: Song; onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(song.title);
  const [composer, setComposer] = useState(song.composer);
  const [level, setLevel] = useState(song.level);
  const [kind, setKind] = useState(song.kind);
  const [sections, setSections] = useState(song.sections.map((x) => `${x.name}:${x.from}-${x.to}`).join(', '));
  const [abc, setAbc] = useState(song.abc ?? '');
  const [gloss, setGloss] = useState(song.gloss ?? '');
  const [busy, setBusy] = useState(false);
  const { result, busy: checking } = useCheck(abc, sections);
  useEffect(() => {
    setAbc(song.abc ?? '');
  }, [song.abc]);
  const save = (): void => {
    setBusy(true);
    api
      .updateSong(song.id, { title, composer, level, kind, sections, abc: abc !== song.abc ? abc : undefined, gloss: gloss !== (song.gloss ?? '') ? gloss : undefined })
      .then(() => {
        toast.success('Saved');
        onClose();
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit song"
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={result?.ok === false || checking || title.trim() === ''} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Composer">
            <Input value={composer} onChange={(e) => setComposer(e.target.value)} />
          </Field>
          <Field label="Level">
            <LevelSelect value={level} onChange={setLevel} />
          </Field>
          <Field label="Kind">
            <KindSelect value={kind} onChange={setKind} />
          </Field>
        </div>
        <Field label="Sections" hint="Name:from-to, separated by commas, e.g. Verse:1-8, Chorus:9-16">
          <Input value={sections} onChange={(e) => setSections(e.target.value)} className={cn('sc-mono text-[12px]')} />
        </Field>
        <Field label="Notation">
          <NotationEditor value={abc} onChange={setAbc} result={result} busy={checking} rows={12} />
        </Field>
        <Field label="About the words" hint="A translation, what the song is about, how to say the words.">
          <Textarea value={gloss} onChange={(e) => setGloss(e.target.value)} minRows={2} maxRows={8} />
        </Field>
      </div>
    </Dialog>
  );
}
