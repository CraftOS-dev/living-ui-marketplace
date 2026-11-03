/**
 * One song, docked on the right: its notes, what it is, where to start, and
 * how it is going: each section's stage and tempo, the tempo ladders over
 * time, and the bars that go wrong most. Edit, reset or remove it here.
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkle, Ear, MoreHorizontal, PenLine, Play, RotateCcw, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { STAGE_LABEL, ago, bars as barsText, clock, dueText, levelName, minutes as fmtMinutes, pad2 } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { Song } from '../../lib/types.ts';
import { BarErrors, Ladders, MiniRoll, Ring } from '../charts.tsx';
import { Button, Dialog, Field, IconButton, Input, MenuItem, MenuSep, Popover, Select, Sheet, Spinner, StageDots, errMessage, useConfirm } from '../ui.tsx';
import { LevelSelect } from './AddSong.tsx';
import { NotationEditor, useCheck } from './NotationEditor.tsx';

export function SongPanel({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const song = useLive(() => api.song(id), ['songs', 'progress'], [id], 150, 1000);
  const stats = useLive(() => api.songStats(id), ['runs', 'progress'], [id], 300, 2000);
  const [editing, setEditing] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);
  const s = song.data?.song ?? null;

  const practise = (p: Record<string, string | number | undefined>): void => navigate('practice', { song: id, ...p });

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
  const reset = async (): Promise<void> => {
    setMenu(false);
    if (s === null) return;
    if (!(await confirm('Every section goes back to new. Past passes stay in the history.', 'Start this song over?', 'Start over'))) return;
    api.resetSong(s.id).catch((err: unknown) => toast.error(errMessage(err)));
  };

  return (
    <Sheet open onClose={onClose} label={s?.title ?? 'Song'} width={520}>
      {s === null ? (
        <div className="flex flex-1 items-center justify-center text-[var(--pc-muted)]">{song.error !== null ? song.error : <Spinner size={18} />}</div>
      ) : (
        <>
          <header className="flex shrink-0 items-start gap-2 px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <div className="pc-label mb-1">
                Level {pad2(s.level)} · {levelName(s.level)}
                {s.kind === 'exercise' ? ' · Exercise' : ''}
              </div>
              <h2 className="truncate text-[19px] font-semibold tracking-[-0.01em]">{s.title}</h2>
              <div className="truncate text-[13px] text-[var(--pc-muted)]">{s.composer}</div>
            </div>
            <IconButton ref={menuAnchor} icon={MoreHorizontal} label="More" onClick={() => setMenu((m) => !m)} active={menu} />
            <IconButton icon={X} label="Close" onClick={onClose} />
            <Popover anchor={menuAnchor} open={menu} onClose={() => setMenu(false)} align="end" width={200}>
              <MenuItem icon={PenLine} onClick={() => (setMenu(false), setEditing(true))}>
                Edit
              </MenuItem>
              <MenuItem icon={RotateCcw} onClick={() => void reset()}>
                Start over
              </MenuItem>
              <MenuSep />
              <MenuItem icon={Trash2} danger onClick={() => void remove()}>
                Remove
              </MenuItem>
            </Popover>
          </header>
          <div className="pc-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            <div className="pc-panel overflow-hidden bg-[var(--pc-raised)] px-2 pt-2">
              <MiniRoll preview={s.preview} height={110} sweep />
            </div>
            <div className="pc-label mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
              <span>{s.key}</span>
              <span>{s.meter}</span>
              <span>♩ {Math.round(s.tempo)}</span>
              <span>{s.bars} bars</span>
              <span>{clock(s.seconds)}</span>
              <span>{s.range}</span>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" size="lg" icon={Play} onClick={() => practise({})} className="flex-1">
                {s.status === 'new' ? 'Start learning' : 'Practise'}
              </Button>
              <Button size="lg" icon={Ear} onClick={() => practise({ mode: 'listen', tempo: 100 })}>
                Listen
              </Button>
            </div>

            {s.note !== '' && (
              <div className="pc-in mt-4 flex gap-2.5 rounded-[var(--pc-radius)] border-l-2 border-[var(--pc-coach)] bg-[var(--pc-coach-soft)] px-3 py-2.5">
                <Sparkle size={15} aria-hidden className="mt-0.5 shrink-0 text-[var(--pc-coach)]" />
                <p className="text-[13px] leading-5 text-[var(--pc-ink)]">{s.note}</p>
              </div>
            )}

            <section className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="pc-label">Sections</h3>
                <span className="flex items-center gap-2">
                  <Ring value={s.progress.pct} size={22} stroke={2} />
                  <span className="pc-mono text-[11px] text-[var(--pc-muted)]">{Math.round(s.progress.pct * 100)}%</span>
                </span>
              </div>
              <ul className="flex flex-col">
                {s.sections.map((x, i) => (
                  <li key={x.i} className="pc-in" style={{ animationDelay: `${i * 30}ms` }}>
                    <button type="button" onClick={() => practise({ from: x.from, to: x.to, mode: x.stage === 'new' ? 'learn' : 'play', tempo: x.stage === 'new' ? 100 : x.next })} className="pc-focus group flex w-full items-center gap-3 border-b border-[var(--pc-hair)] px-1 py-2 text-left transition-colors hover:bg-[var(--pc-hover)]">
                      <span className="pc-mono w-7 shrink-0 text-[12px] font-semibold">{x.name.length <= 3 ? x.name : pad2(i + 1)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{x.name.length > 3 ? x.name : barsText(x.from, x.to)}</span>
                        <span className="pc-label block">
                          {STAGE_LABEL[x.stage]}
                          {x.stage === 'mastered' && x.due !== '' ? ` · review ${dueText(x.due)}` : ''}
                          {x.name.length > 3 ? ` · ${barsText(x.from, x.to)}` : ''}
                        </span>
                      </span>
                      <StageDots stage={x.stage} />
                      <span className="w-[86px] shrink-0">
                        <span className="block h-[3px] overflow-hidden rounded-full bg-[var(--pc-line)]">
                          <span className="block h-full rounded-full bg-[var(--pc-ink)] transition-[width] duration-700" style={{ width: `${Math.min(100, x.best)}%` }} />
                        </span>
                        <span className="pc-mono mt-0.5 block text-right text-[10.5px] text-[var(--pc-muted)]">{x.best > 0 ? `${x.best}%` : '—'}</span>
                      </span>
                      <Play size={13} aria-hidden className="shrink-0 text-[var(--pc-faint)] transition-colors group-hover:text-[var(--pc-ink)]" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-5">
              <h3 className="pc-label mb-2">Tempo ladder</h3>
              {stats.data === null ? (
                <div className="pc-skel h-[120px]" />
              ) : stats.data.ladders.some((l) => l.points.length > 0) ? (
                <Ladders ladders={stats.data.ladders} />
              ) : (
                <p className="text-[12.5px] text-[var(--pc-muted)]">Clean passes in Play mode climb this ladder toward 100%.</p>
              )}
            </section>

            {stats.data !== null && stats.data.bars.length > 0 && (
              <section className="mt-5">
                <h3 className="pc-label mb-2">Notes off, by bar</h3>
                <BarErrors bars={stats.data.bars} />
              </section>
            )}

            <section className="mt-5 grid grid-cols-3 gap-2">
              <Fact label="Practised" value={fmtMinutes(s.progress.minutes)} />
              <Fact label="Passes" value={String(s.progress.runs)} />
              <Fact label="Last" value={s.progress.last_at !== '' ? ago(s.progress.last_at) : '—'} />
            </section>
          </div>
          {editing && <EditSong song={s} onClose={() => setEditing(false)} />}
          {confirmEl}
        </>
      )}
    </Sheet>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-[var(--pc-radius-sm)] bg-[var(--pc-sunk)] px-2.5 py-2">
      <div className="pc-label text-[9.5px]">{label}</div>
      <div className="pc-mono mt-0.5 truncate text-[13px]">{value}</div>
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
  const [busy, setBusy] = useState(false);
  const { result, busy: checking } = useCheck(abc, sections);
  useEffect(() => {
    setAbc(song.abc ?? '');
  }, [song.abc]);
  const save = (): void => {
    setBusy(true);
    api
      .updateSong(song.id, { title, composer, level, kind, sections, abc: abc !== song.abc ? abc : undefined })
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
      width={720}
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
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'piece' | 'exercise')}>
              <option value="piece">Piece</option>
              <option value="exercise">Exercise</option>
            </Select>
          </Field>
        </div>
        <Field label="Sections">
          <Input value={sections} onChange={(e) => setSections(e.target.value)} className={cn('pc-mono text-[12px]')} />
        </Field>
        <Field label="Notation">
          <NotationEditor value={abc} onChange={setAbc} result={result} busy={checking} rows={12} />
        </Field>
      </div>
    </Dialog>
  );
}
