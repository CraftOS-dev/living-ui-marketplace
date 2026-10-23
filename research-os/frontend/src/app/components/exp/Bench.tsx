/**
 * Bench mode: the experiment at the bench, full screen, one step at a time.
 *
 * The current step in large type; Done stamps the time, writes the journal
 * and moves to the next step; a countdown for timed steps; a note,
 * deviation or photo about this step; and "Record the next run": the next
 * planned run's conditions with an input for each measure. Works on a phone.
 * Esc closes.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op, opForm } from '../../lib/api.ts';
import { changed } from '../../lib/live.ts';
import { plural } from '../../lib/format.ts';
import type { ExpEntry, ExpRun, ExpVariable, Experiment } from '../../lib/types.ts';
import { Button, IconButton, inputCls } from '../ui.tsx';
import { LOG } from './Journal.tsx';
import { clock, saveExp, shownValue, StatusChip, tplus, useNow } from './shared.tsx';

export function Bench({ e, runs, entries, onClose }: { e: Experiment; runs: ExpRun[]; entries: ExpEntry[]; onClose: () => void }): React.JSX.Element {
  const steps = e.steps;
  const [i, setI] = useState(() => (e.next_step !== null ? e.next_step.index : 0));
  const now = useNow(1000);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const s = steps[i];
  const canTick = e.status === 'running' || e.status === 'paused';
  const nextUndone = (from: number): number => {
    for (let k = from + 1; k < steps.length; k++) if (!steps[k]?.done) return k;
    return Math.min(from + 1, steps.length - 1);
  };
  const done = async (): Promise<void> => {
    if (s === undefined) return;
    if (!s.done) {
      try {
        await op('exp.step', { experiment: e.id, step: s.id, done: true });
        changed('experiments', 'exp_log');
      } catch {
        return;
      }
    }
    setI(nextUndone(i));
  };
  return (
    <div role="dialog" aria-label={'Bench mode: ' + e.code} className="fixed inset-0 z-50 flex flex-col bg-[var(--ro-shell)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-4 py-2">
        <span className="num text-[15px] font-light text-[var(--ro-ink-2)]">{e.code}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{e.title}</span>
        <StatusChip status={e.status} />
        {e.started_at !== '' && <span className="num text-[14px] font-semibold">{tplus(e.started_at, new Date(now).toISOString().replace('T', ' '))}</span>}
        <IconButton icon={X} label="Close bench mode (Esc)" size={32} variant="secondary" onClick={onClose} />
      </header>
      {e.status === 'planned' && (
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--ro-line)] bg-[var(--ro-accent-soft)] px-4 py-2 text-[13px]">
          <span className="flex-1 font-semibold text-[var(--ro-accent-text)]">Start the experiment to tick steps and stamp their times.</span>
          <Button variant="primary" icon={Play} onClick={() => void saveExp(e.id, { status: 'running' })}>
            Start
          </Button>
        </div>
      )}
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 p-4 @min-[1000px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="flex flex-col gap-4 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-5">
            {steps.length === 0 || s === undefined ? (
              <p className="text-[14px] text-[var(--ro-muted)]">This experiment has no protocol steps. Add them under Protocol.</p>
            ) : (
              <>
                <nav aria-label="Steps" className="flex flex-wrap gap-1">
                  {steps.map((x, k) => (
                    <button key={x.id} type="button" onClick={() => setI(k)} aria-current={k === i ? 'step' : undefined} title={'Step ' + (k + 1) + ': ' + x.text} className={cn('num flex size-8 items-center justify-center rounded-full border-[1.5px] text-[12px] font-bold', x.done ? 'border-[var(--ro-green)] bg-[var(--ro-green)] text-white' : k === i ? 'border-[var(--ro-ink)] text-[var(--ro-ink)]' : 'border-[var(--ro-line)] text-[var(--ro-muted)] hover:border-[var(--ro-ink-2)]')}>
                      {x.done ? <Check size={14} strokeWidth={3} /> : k + 1}
                    </button>
                  ))}
                </nav>
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">
                    Step {i + 1} of {steps.length}
                    {s.done && s.done_at !== '' && <span className="num normal-case tracking-normal text-[var(--ro-green-text)]">done at {clock(s.done_at)}</span>}
                  </span>
                  <p className={cn('whitespace-pre-wrap text-[26px] font-semibold leading-9', s.done && 'text-[var(--ro-muted)]')}>{s.text}</p>
                </div>
                {s.minutes > 0 && <StepTimer key={s.id} minutes={s.minutes} />}
                <div className="flex flex-wrap items-center gap-2">
                  <Button icon={ChevronLeft} disabled={i === 0} onClick={() => setI(i - 1)}>
                    Back
                  </Button>
                  <Button icon={ChevronRight} disabled={i === steps.length - 1} onClick={() => setI(i + 1)}>
                    Skip
                  </Button>
                  <span className="flex-1" />
                  <button type="button" disabled={!canTick} onClick={() => void done()} title={canTick ? undefined : 'Start the experiment first'} className="inline-flex h-12 items-center gap-2 rounded-[var(--ro-r)] bg-[var(--ro-primary)] px-5 text-[15px] font-bold text-white hover:bg-[var(--ro-primary-hover)] disabled:opacity-50">
                    <Check size={18} strokeWidth={3} /> {s.done ? 'Next step' : i === steps.length - 1 ? 'Done' : 'Done, next step'}
                  </button>
                </div>
                <StepJournal e={e} stepId={s.id} index={i} />
              </>
            )}
          </section>
          {steps.length > i + 1 && (
            <section aria-label="Coming up" className="flex flex-col gap-1 self-start rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3">
              <h2 className="px-2 pb-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">Coming up</h2>
              {steps.slice(i + 1, i + 5).map((x, k) => (
                <button key={x.id} type="button" onClick={() => setI(i + 1 + k)} className="flex items-start gap-3 rounded-[var(--ro-r)] px-2 py-1.5 text-left hover:bg-[var(--ro-row)]">
                  <span className={cn('num flex size-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold', x.done ? 'border-[var(--ro-green)] bg-[var(--ro-green)] text-white' : 'border-[var(--ro-line)] text-[var(--ro-muted)]')}>{x.done ? <Check size={12} strokeWidth={3} /> : i + 2 + k}</span>
                  <span className={cn('min-w-0 flex-1 pt-0.5 text-[14px] leading-5', x.done && 'text-[var(--ro-muted)]')}>{x.text}</span>
                  {x.minutes > 0 && <span className="num shrink-0 pt-0.5 text-[12px] text-[var(--ro-muted)]">{x.minutes} min</span>}
                </button>
              ))}
              {steps.length > i + 5 && <span className="px-2 pt-1 text-[12px] text-[var(--ro-muted)]">and {steps.length - i - 5} more</span>}
            </section>
          )}
          <div className="flex flex-col gap-4 @min-[1000px]:col-start-2 @min-[1000px]:row-span-2 @min-[1000px]:row-start-1">
            <RecordRun e={e} runs={runs} />
            <Latest entries={entries} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A countdown for a timed step: start, pause, reset; it turns red when the time is up. */
function StepTimer({ minutes }: { minutes: number }): React.JSX.Element {
  const total = Math.round(minutes * 60);
  const [left, setLeft] = useState(total);
  const [running, setRunning] = useState(false);
  const end = useRef(0);
  useEffect(() => {
    if (!running) return;
    end.current = Date.now() + left * 1000;
    const h = window.setInterval(() => {
      const l = Math.round((end.current - Date.now()) / 1000);
      setLeft(l);
      if (l <= 0) {
        setRunning(false);
        try {
          navigator.vibrate?.([300, 150, 300]);
        } catch {
          /* not every device can */
        }
      }
    }, 250);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const over = left <= 0;
  const a = Math.abs(left);
  const text = (left < 0 ? '+' : '') + String(Math.floor(a / 3600) > 0 ? Math.floor(a / 3600) + ':' : '') + String(Math.floor((a % 3600) / 60)).padStart(Math.floor(a / 3600) > 0 ? 2 : 1, '0') + ':' + String(a % 60).padStart(2, '0');
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-[var(--ro-r-md)] border px-4 py-3', over ? 'border-[var(--ro-red)] bg-[var(--ro-red)]/10' : 'border-[var(--ro-line)] bg-[var(--ro-row)]')}>
      <span className={cn('num text-[26px] font-bold leading-8 tracking-tight', over && 'text-[var(--ro-red-text)]')} aria-live="polite">
        {over ? 'Time is up' : text}
      </span>
      <span className="text-[12px] text-[var(--ro-muted)]">of {minutes} min</span>
      <span className="flex-1" />
      {!over && (
        <Button icon={running ? Pause : Play} onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : left === total ? 'Start timer' : 'Resume'}
        </Button>
      )}
      <IconButton
        icon={RotateCcw}
        label="Reset the timer"
        variant="secondary"
        onClick={() => {
          setRunning(false);
          setLeft(total);
        }}
      />
    </div>
  );
}

/** A note, deviation or photo about the current step, written into the journal. */
function StepJournal({ e, stepId, index }: { e: Experiment; stepId: string; index: number }): React.JSX.Element {
  const [kind, setKind] = useState<'deviation' | 'observation' | 'note'>('observation');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const photo = useRef<HTMLInputElement | null>(null);
  const write = async (files: File[]): Promise<void> => {
    if ((text.trim() === '' && files.length === 0) || busy) return;
    setBusy(true);
    const params = { experiment: e.id, kind, text: text.trim(), ref: { kind: 'step', id: stepId } };
    try {
      if (files.length > 0) await opForm('exp.log', params, { files });
      else await op('exp.log', params);
      changed('exp_log', 'experiments');
      setText('');
      setSent(LOG[kind].label + (files.length > 0 ? ' with a photo' : '') + ' written at ' + clock(new Date().toISOString().replace('T', ' ')));
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--ro-hair)] pt-3">
      <span className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[12px] font-semibold text-[var(--ro-ink-2)]">Journal, about step {index + 1}</span>
        {(['observation', 'deviation', 'note'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('inline-flex h-7 items-center gap-1 rounded-[var(--ro-r-sm)] px-2 text-[12px] font-semibold', kind === k ? 'bg-[var(--ro-row-hover)]' : 'text-[var(--ro-muted)] hover:bg-[var(--ro-row)]')}>
            <span className="size-1.5 rounded-full" style={{ background: LOG[k].color }} /> {LOG[k].label}
          </button>
        ))}
      </span>
      <span className="flex items-center gap-1.5">
        <input value={text} onChange={(ev) => setText(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && void write([])} placeholder={LOG[kind].placeholder} aria-label={'Journal entry about step ' + (index + 1)} className={cn(inputCls, 'h-10 min-w-0 flex-1 text-[14px]')} />
        <IconButton icon={Camera} label="Take or add a photo" size={40} variant="secondary" onClick={() => photo.current?.click()} />
        <Button variant="primary" loading={busy} disabled={text.trim() === ''} onClick={() => void write([])}>
          Write
        </Button>
      </span>
      {sent !== '' && <span className="text-[12px] text-[var(--ro-green-text)]">{sent}</span>}
      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(ev) => {
          const files = Array.from(ev.target.files ?? []);
          ev.target.value = '';
          void write(files);
        }}
      />
    </div>
  );
}

/** The last few journal lines, newest first, so the bench view shows what was just written. */
function Latest({ entries }: { entries: ExpEntry[] }): React.JSX.Element | null {
  const shown = entries.filter((x) => x.struck === '').slice(-6).reverse();
  if (shown.length === 0) return null;
  return (
    <section aria-label="Latest in the journal" className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-5">
      <h2 className="text-[15px] font-bold">Latest in the journal</h2>
      <ol className="flex flex-col gap-2">
        {shown.map((x) => (
          <li key={x.id} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 text-[13px] leading-5">
            <span className="num text-[12px] text-[var(--ro-muted)]">{clock(x.at)}</span>
            {x.kind === 'system' ? (
              <span className="text-[var(--ro-muted)]">{x.text}</span>
            ) : (
              <span className="min-w-0">
                <span className="mr-1.5 text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: LOG[x.kind].color }}>
                  {LOG[x.kind].label}
                </span>
                {x.ref !== null && <span className="mr-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)]">{x.ref.label}</span>}
                <span className="line-clamp-3">{x.text !== '' ? x.text : x.files.length > 0 ? plural(x.files.length, 'file') : ''}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The next planned run's conditions, with an input for each measure. */
function RecordRun({ e, runs }: { e: Experiment; runs: ExpRun[] }): React.JSX.Element {
  const conds = e.variables.filter((v) => v.role === 'condition');
  const measures = e.variables.filter((v) => v.role === 'measure');
  const planned = runs.filter((r) => r.status === 'planned').sort((a, b) => a.number - b.number);
  const [pick, setPick] = useState('');
  const run = planned.find((r) => r.id === pick) ?? planned[0];
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  useEffect(() => setVals({}), [run?.id]);
  const save = async (): Promise<void> => {
    if (run === undefined || busy) return;
    const values: Record<string, string> = {};
    for (const m of measures) if ((vals[m.id] ?? '').trim() !== '') values[m.id] = (vals[m.id] ?? '').trim();
    if (Object.keys(values).length === 0) return;
    setBusy(true);
    try {
      await op('exp.update-run', { run: run.id, values });
      changed('exp_runs', 'experiments');
      setSaved(run.code + ' recorded');
      setPick('');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const input = (v: ExpVariable): React.JSX.Element => {
    const choices = v.type === 'yesno' ? ['Yes', 'No'] : v.type === 'category' ? v.options ?? [] : null;
    return choices ? (
      <select value={vals[v.id] ?? ''} onChange={(ev) => setVals({ ...vals, [v.id]: ev.target.value })} aria-label={v.name} className={cn(inputCls, 'h-10 cursor-pointer text-[14px]')}>
        <option value="" />
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    ) : (
      <input value={vals[v.id] ?? ''} onChange={(ev) => setVals({ ...vals, [v.id]: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && void save()} inputMode={v.type === 'number' ? 'decimal' : undefined} aria-label={v.name} className={cn(inputCls, 'num h-10 text-[14px]', v.type === 'number' && 'text-right')} />
    );
  };
  return (
    <section className="flex flex-col gap-3 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-5">
      <header className="flex items-center gap-2">
        <h2 className="text-[15px] font-bold">Record the next run</h2>
        <span className="flex-1" />
        <span className="num text-[12px] text-[var(--ro-muted)]">{planned.length} planned left</span>
      </header>
      {measures.length === 0 ? (
        <p className="text-[13px] text-[var(--ro-muted)]">Add what you measure under Design to record runs here.</p>
      ) : run === undefined ? (
        <p className="text-[13px] text-[var(--ro-muted)]">{runs.length === 0 ? 'No runs planned yet. Plan them under Runs.' : 'Every planned run is recorded.'}</p>
      ) : (
        <>
          <span className="flex items-center gap-2">
            <select value={run.id} onChange={(ev) => setPick(ev.target.value)} aria-label="Run" className={cn(inputCls, 'num h-9 w-24 cursor-pointer text-[14px] font-bold')}>
              {planned.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </select>
            <span className="flex min-w-0 flex-wrap gap-1.5">
              {conds.map((c) => (
                <span key={c.id} className="num inline-flex h-7 items-center rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-2 text-[13px]">
                  <span className="mr-1 text-[var(--ro-muted)]">{c.name}</span>
                  <span className="font-semibold">
                    {shownValue(c, run.values[c.id])}
                    {c.unit !== '' && run.values[c.id] !== undefined ? ' ' + c.unit : ''}
                  </span>
                </span>
              ))}
            </span>
          </span>
          {run.note !== '' && <span className="text-[12px] text-[var(--ro-muted)]">{run.note}</span>}
          <div className="grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2">
            {measures.map((m) => (
              <label key={m.id} className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">
                  {m.name}
                  {m.unit !== '' && <span className="font-normal text-[var(--ro-muted)]"> ({m.unit})</span>}
                </span>
                {input(m)}
              </label>
            ))}
          </div>
          <span className="flex items-center gap-2">
            {saved !== '' && <span className="text-[12px] text-[var(--ro-green-text)]">{saved}</span>}
            <span className="flex-1" />
            <Button variant="primary" icon={Check} loading={busy} disabled={measures.every((m) => (vals[m.id] ?? '').trim() === '')} onClick={() => void save()}>
              Save {run.code}
            </Button>
          </span>
        </>
      )}
    </section>
  );
}
