/**
 * After a take: what it says, never one "voice score". Pitch (notes on or
 * close) and in tune (notes on), which way the singer leans (cents), timing,
 * how steady long notes were, vibrato or straight, scoops and falls, an
 * octave note, the Solo offset, the weakest phrase with its words, the stage
 * changes, and one or two suggestions made by rules. Any judged note can be
 * opened with its trace and disputed.
 *
 * In Fade and After feedback the singer first says how it went (on, close or
 * off), and the numbers come a moment later: guessing first builds the ear
 * a singer needs on stage.
 */
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BedDouble, Check, Flag, KeyRound, Play, Repeat, RotateCcw, Shuffle, Volume2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { cents as centsText } from '../../lib/format.ts';
import type { DrillSaved, HealthFlag, RunResult, SavedRun } from '../../lib/types.ts';
import { noteLabel } from '../../music/dial.ts';
import type { PassResult, StageNote } from '../../music/engine.ts';
import { ST_CLOSE, ST_FREE, ST_MISSED, ST_OFF, ST_ON, fold, slice } from '../../music/judge.ts';
import type { NoteResult } from '../../music/judge.ts';
import { Button, Dialog } from '../ui.tsx';

export interface Suggestion {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

function pct(v: number): string {
  return Math.round(v * 100) + '%';
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string | undefined; warn?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="sc-label">{label}</span>
      <span className={cn('sc-mono sc-num text-[19px] font-light leading-none tracking-[-0.02em]', warn === true && 'text-[var(--sc-warn)]')}>{value}</span>
      {sub !== undefined && <span className="truncate text-[11px] text-[var(--sc-muted)]">{sub}</span>}
    </div>
  );
}

const STAGE_WORD: Record<string, string> = { new: 'New', learning: 'Learning', steady: 'Steady', mastered: 'Mastered' };

/** "How was that?": the self-estimate before the numbers. */
export function EstimateCard({ onPick }: { onPick: (v: 'on' | 'close' | 'off' | '') => void }): React.JSX.Element {
  return (
    <div className="sc-rise absolute bottom-4 left-1/2 z-10 w-[min(420px,calc(100%-24px))] -translate-x-1/2 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] p-4 shadow-[var(--sc-shadow-lg)]">
      <div className="text-[14px] font-semibold">How was that?</div>
      <p className="mt-0.5 text-[12.5px] text-[var(--sc-muted)]">Your own guess first, then the numbers.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(
          [
            ['on', 'On pitch'],
            ['close', 'Close'],
            ['off', 'Off'],
          ] as const
        ).map(([v, l]) => (
          <Button key={v} onClick={() => onPick(v)} className="h-10">
            {l}
          </Button>
        ))}
      </div>
      <button type="button" onClick={() => onPick('')} className="sc-focus mt-2 w-full text-center text-[12px] text-[var(--sc-muted)] hover:text-[var(--sc-ink)]">
        Skip, show me
      </button>
    </div>
  );
}

export function ResultCard({
  result,
  notes,
  saved,
  drill,
  estimate,
  suggestions,
  health,
  onAgain,
  onReplay,
  canReplay,
  onClose,
  onDispute,
  onAnother,
  onNext,
  nextLabel,
}: {
  result: PassResult;
  notes: StageNote[];
  saved: SavedRun | null;
  drill: DrillSaved | null;
  estimate: string;
  suggestions: Suggestion[];
  health: HealthFlag | null;
  onAgain: () => void;
  onReplay: () => void;
  canReplay: boolean;
  onClose: () => void;
  onDispute: (n: NoteResult, note: StageNote) => void;
  onAnother?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  nextLabel?: string | undefined;
}): React.JSX.Element {
  const sm = result.summary;
  const changes: RunResult[] = (saved?.results ?? []).filter((x) => x.before !== x.after && x.after !== 'learning');
  const byI = useMemo(() => new Map(notes.map((n) => [n.i, n])), [notes]);
  const misses = result.results.filter((r) => r.status === ST_OFF || r.status === ST_MISSED).slice(0, 8);
  const scored = result.results.filter((r) => r.status !== ST_FREE).length;
  const weak = sm.weakest;
  const weakNote = weak?.worst ? byI.get(weak.worst.i) : undefined;
  const timing = sm.timingBias === null ? '—' : Math.abs(sm.timingBias) < 30 ? 'in time' : sm.timingBias < 0 ? `${Math.abs(sm.timingBias)} ms early` : `${sm.timingBias} ms late`;
  const measured = sm.pitch >= 0.9 ? 'on' : sm.pitch >= 0.6 ? 'close' : 'off';
  return (
    <div className="sc-rise sc-reveal absolute bottom-3 left-1/2 z-10 flex max-h-[calc(100%-24px)] w-[min(760px,calc(100%-20px))] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] shadow-[var(--sc-shadow-lg)]">
      <div className="flex items-center gap-2 border-b border-[var(--sc-hair)] px-4 py-2.5">
        <span className={cn('flex size-6 items-center justify-center rounded-full', sm.clean ? 'bg-[var(--sc-ink)] text-[var(--sc-page)]' : 'border border-[var(--sc-line-2)] text-[var(--sc-muted)]')}>{sm.clean ? <Check size={14} strokeWidth={2.4} aria-hidden /> : <Repeat size={13} aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{!result.complete ? 'Stopped early' : sm.clean ? 'Clean take' : scored === 0 ? 'Take done' : 'Not clean yet'}</div>
          <div className="sc-label truncate">
            {result.mode} · bars {result.from}–{result.to} · {Math.round(result.tempo)}%{result.shift !== 0 ? ` · key ${result.shift > 0 ? '+' : ''}${result.shift}` : ''}
            {estimate !== '' && ` · you said ${estimate}, measured ${measured}`}
          </div>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="sc-focus flex size-7 items-center justify-center rounded-[var(--sc-radius-sm)] text-[var(--sc-muted)] hover:bg-[var(--sc-hover)] hover:text-[var(--sc-ink)]">
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="sc-scroll min-h-0 overflow-y-auto px-4 py-3">
        {scored > 0 ? (
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
            <Stat label="Pitch" value={pct(sm.pitch)} sub={`${sm.on + sm.close} of ${sm.expected} on or close`} />
            <Stat label="In tune" value={pct(sm.inTune)} sub={result.mode === 'solo' ? 'exactly on, in your key' : 'exactly on'} />
            <Stat label="Lean" value={centsText(sm.bias)} sub={sm.bias === null ? '' : Math.abs(sm.bias) < 8 ? 'centred' : sm.bias < 0 ? 'flat side' : 'sharp side'} warn={sm.bias !== null && Math.abs(sm.bias) > 25} />
            <Stat label="Timing" value={sm.timingMad === null ? '—' : `${sm.timingMad} ms`} sub={timing} />
            <Stat label="Hold" value={sm.holdSd === null ? '—' : `${sm.holdSd}¢`} sub="spread on long notes" />
            <Stat label="Vibrato" value={sm.vibRate === null ? 'straight' : `${sm.vibRate} Hz`} sub={sm.vibRate === null ? '' : `±${sm.vibExtent}¢ · not a fault`} />
          </div>
        ) : (
          <p className="text-[13px] text-[var(--sc-ink-2)]">{drill !== null ? `${pct(drill.score)} of the notes had your voice on them.` : 'Warm-up done: these notes are not scored.'}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--sc-ink-2)]">
          {sm.scoops + sm.falls > 0 && (
            <span>
              {sm.scoops > 0 && `${sm.scoops} scoop${sm.scoops === 1 ? '' : 's'} ↗`}
              {sm.scoops > 0 && sm.falls > 0 && ' · '}
              {sm.falls > 0 && `${sm.falls} fall${sm.falls === 1 ? '' : 's'} ↘`}
            </span>
          )}
          {sm.octave !== 0 && <span>You sang an octave {sm.octave < 0 ? 'lower' : 'higher'}, which is fine.</span>}
          {result.mode === 'solo' && result.offset !== 0 && Math.abs(result.offset) >= 15 && (
            <span>
              You settled {Math.abs(result.offset)}¢ {result.offset < 0 ? 'flat' : 'sharp'} of the written key and kept it: judged in your key.
            </span>
          )}
          {sm.drift !== null && Math.abs(sm.drift) >= 20 && result.mode === 'solo' && <span>Drift {centsText(sm.drift)} from the first phrase to the last.</span>}
        </div>
        {weak !== null && weak.worst !== null && (
          <div className="mt-3 flex items-center gap-3 rounded-[var(--sc-radius-sm)] bg-[var(--sc-sunk)] px-3 py-2">
            <span className="sc-label shrink-0">Weakest</span>
            <span className="min-w-0 flex-1 truncate text-[13px]">
              bars {weak.from_bar}–{weak.to_bar} · {pct(weak.on_close / weak.n)}
              {weakNote !== undefined && (
                <span className="text-[var(--sc-muted)]">
                  {' '}
                  · bar {weak.worst.bar} {weakNote.syl !== '' && weakNote.syl !== '_' ? `“${weakNote.syl.replace(/-$/, '')}” ` : ''}
                  {noteLabel(weakNote.midi)} {weak.worst.cents === 0 ? 'missed' : centsText(weak.worst.cents)}
                </span>
              )}
            </span>
          </div>
        )}
        {changes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {changes.map((c) => (
              <span key={c.i} className="sc-pop inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-ink)] px-2.5 py-1 text-[12px] font-medium">
                {c.name} <ArrowRight size={12} aria-hidden /> {STAGE_WORD[c.after]}
              </span>
            ))}
          </div>
        )}
        {saved !== null && changes.length === 0 && (saved.results.some((r) => r.cleans > 0) || saved.results.length > 0) && result.mode !== 'echo' && (
          <div className="mt-2 text-[12px] text-[var(--sc-muted)]">
            {saved.results
              .filter((r) => r.after === 'learning')
              .slice(0, 3)
              .map((r) => `${r.name}: ${r.cleans} of 3 clean today${r.cleans >= 1 && !r.solo_today ? ', one must be Solo' : ''}`)
              .join(' · ')}
          </div>
        )}
        {drill !== null && drill.level > 0 && <div className="mt-2 text-[12px] text-[var(--sc-muted)]">Next: level {drill.level}</div>}
        {health !== null && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--sc-radius-sm)] border border-[var(--sc-warn)] bg-[var(--sc-warn-soft)] px-3 py-2 text-[12.5px]">
            <BedDouble size={15} aria-hidden className="mt-0.5 shrink-0 text-[var(--sc-warn)]" />
            <span>{health.text}</span>
          </div>
        )}
        {misses.length > 0 && (
          <div className="mt-3">
            <div className="sc-label mb-1.5">Notes to check · open one to see your trace</div>
            <div className="flex flex-wrap gap-1.5">
              {misses.map((m) => {
                const n = byI.get(m.i);
                if (n === undefined) return null;
                return (
                  <button key={m.i} type="button" onClick={() => onDispute(m, n)} className="sc-focus sc-mono inline-flex h-7 items-center gap-1.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] px-2 text-[11.5px] hover:bg-[var(--sc-hover)]">
                    <span className="text-[var(--sc-muted)]">b{m.bar}</span>
                    {n.syl !== '' && n.syl !== '_' && <span className="font-sans text-[12px] text-[var(--sc-ink)]">{n.syl.replace(/-$/, '')}</span>}
                    <span className="text-[var(--sc-bad)]">{m.status === ST_MISSED ? '○' : centsText(m.cents)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--sc-hair)] px-4 py-2.5">
        {suggestions.map((s) => (
          <Button key={s.key} size="sm" icon={s.icon} onClick={s.run}>
            {s.label}
          </Button>
        ))}
        <span className="flex-1" />
        {canReplay && (
          <Button size="sm" variant="ghost" icon={Volume2} onClick={onReplay}>
            Replay
          </Button>
        )}
        {onAnother !== undefined && (
          <Button size="sm" icon={Shuffle} onClick={onAnother}>
            Another
          </Button>
        )}
        <Button size="sm" variant={onNext !== undefined ? 'default' : 'primary'} icon={RotateCcw} onClick={onAgain}>
          Again
        </Button>
        {onNext !== undefined && (
          <Button size="sm" variant="primary" iconRight={ArrowRight} onClick={onNext}>
            {nextLabel ?? 'Next'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** One judged note with the voice's trace against it, and "Dispute this mark". */
export function DisputeDialog({ open, onClose, note, result, frames, onDispute, busy, done }: { open: boolean; onClose: () => void; note: StageNote | null; result: NoteResult | null; frames: PassResult['frames']; onDispute: () => void; busy: boolean; done: string }): React.JSX.Element | null {
  if (note === null || result === null) return null;
  const a = note.t - 0.3;
  const b = note.t + note.d + 0.3;
  const fr = slice(frames, a, b);
  const W = 440;
  const H = 150;
  const x = (s: number): number => ((s - a) / (b - a)) * W;
  const y = (c: number): number => H / 2 - (Math.max(-300, Math.min(300, c)) / 300) * (H / 2 - 10);
  let d = '';
  let open2 = false;
  for (const f of fr) {
    if (!Number.isFinite(f.midi)) {
      open2 = false;
      continue;
    }
    const c = fold(f.midi, note.midi);
    d += (open2 ? 'L' : 'M') + x(f.s).toFixed(1) + ',' + y(c).toFixed(1);
    open2 = true;
  }
  const label = result.status === ST_MISSED ? 'Missed: under half the note was voiced' : result.status === ST_OFF ? `Off: ${centsText(result.cents)}` : result.status === ST_CLOSE ? `Close: ${centsText(result.cents)}` : result.status === ST_ON ? 'On' : 'Not scored';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Bar ${note.bar} · ${noteLabel(note.midi)}${note.syl !== '' && note.syl !== '_' ? ` · “${note.syl.replace(/-$/, '')}”` : ''}`}
      width={500}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={Flag} busy={busy} disabled={done !== ''} onClick={onDispute}>
            Dispute this mark
          </Button>
        </>
      }
    >
      <div className="text-[13px] text-[var(--sc-ink-2)]">{label}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="mt-3 rounded-[var(--sc-radius-sm)] bg-[var(--sc-sunk)]">
        <rect x={x(note.t)} y={y(50)} width={Math.max(2, x(note.t + note.d) - x(note.t))} height={y(-50) - y(50)} fill="var(--sc-voice)" opacity={0.08} />
        <line x1={x(note.t)} x2={x(note.t + note.d)} y1={y(0)} y2={y(0)} stroke="var(--sc-ink)" strokeWidth={1.4} />
        <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="var(--sc-hair)" />
        <line x1={0} x2={W} y1={y(-100)} y2={y(-100)} stroke="var(--sc-hair)" />
        <text x={4} y={y(100) - 3} className="sc-mono" fontSize={9} fill="var(--sc-muted)">
          +1 semitone
        </text>
        <text x={4} y={y(-100) + 11} className="sc-mono" fontSize={9} fill="var(--sc-muted)">
          −1 semitone
        </text>
        <path d={d} fill="none" stroke="var(--sc-voice)" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
      <p className="mt-3 text-[12px] leading-4 text-[var(--sc-muted)]">The band is ±50 cents around the note; the blue line is your voice, in the note's octave. If you sang it and the microphone misheard, dispute the mark: the take is scored again without this note.</p>
      {done !== '' && <p className="mt-2 text-[12.5px] font-medium text-[var(--sc-ink)]">{done}</p>}
    </Dialog>
  );
}

/** Rule-based suggestions after a take. */
export function suggest(p: { result: PassResult; notes: StageNote[]; saved: SavedRun | null; comfHigh: number; onLoop: (from: number, to: number, tempo: number) => void; onKey: (d: number) => void; onTempo: (t: number) => void; onRest: () => void; health: HealthFlag | null; exercise: boolean }): Suggestion[] {
  const out: Suggestion[] = [];
  const sm = p.result.summary;
  if (p.health !== null && (p.health.key === 'cap' || p.health.key === 'pain_today' || p.health.key === 'light')) out.push({ key: 'rest', label: 'Rest your voice', icon: BedDouble, run: p.onRest });
  if (!sm.clean && sm.weakest !== null && !p.exercise) {
    const w = sm.weakest;
    out.push({ key: 'loop', label: `Loop bars ${w.from_bar}–${w.to_bar} at 80%`, icon: Repeat, run: () => p.onLoop(w.from_bar, w.to_bar, 80) });
  }
  // Notes near the top of the range going off: offer a lower key.
  const byI = new Map(p.notes.map((n) => [n.i, n]));
  const highMiss = p.result.results.filter((r) => (r.status === ST_OFF || r.status === ST_MISSED || (r.cents !== null && r.cents < -30)) && (byI.get(r.i)?.midi ?? 0) >= p.comfHigh - 1).length;
  if (highMiss >= 2 && !p.exercise) out.push({ key: 'key', label: 'Lower the key by 1', icon: KeyRound, run: () => p.onKey(-1) });
  const sg = p.saved?.suggestion;
  if (sg !== null && sg !== undefined && sg.why === 'up') out.push({ key: 'up', label: `Tempo ${sg.tempo}%`, icon: Play, run: () => p.onTempo(sg.tempo) });
  if (sg !== null && sg !== undefined && sg.why === 'down') out.push({ key: 'down', label: `Slower: ${sg.tempo}%`, icon: Play, run: () => p.onTempo(sg.tempo) });
  return out.slice(0, 3);
}
