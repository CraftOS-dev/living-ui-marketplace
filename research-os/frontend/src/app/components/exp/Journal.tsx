/**
 * An experiment's journal: the running log, written as it happens.
 *
 * Every entry is stamped with the clock time and the time since the start
 * (T+), grouped by day ("Day 3 · Thu 22 Oct"), and can say what it is about
 * (a protocol step or a run). Corrections keep the original with a reason;
 * removing strikes an entry through with a reason; nothing is erased (good
 * documentation practice). The app writes its own lines: status changes,
 * ticked steps, recorded runs. The entry box is always at the bottom: Enter
 * writes; files can be picked, dropped or pasted.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, Paperclip, Pencil, SendHorizontal, Sparkles, Strikethrough, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op, opForm, opUrl } from '../../lib/api.ts';
import { changed } from '../../lib/live.ts';
import { num, plural } from '../../lib/format.ts';
import type { CorrectionReason, ExpEntry, ExpRun, Experiment, LogKind } from '../../lib/types.ts';
import { Button, IconButton, LoadError, Select, Spinner, inputCls, textareaCls } from '../ui.tsx';
import { clock, dayLabel, parseAt, tplus } from './shared.tsx';

type Kind = Exclude<LogKind, 'system'>;

export const LOG: Record<Kind, { label: string; color: string; placeholder: string }> = {
  note: { label: 'Note', color: 'var(--ro-ink-2)', placeholder: 'Write what you did or thought' },
  observation: { label: 'Observation', color: 'var(--ro-kind-question-text)', placeholder: 'What you see: colour, growth, a reading, behaviour' },
  result: { label: 'Result', color: 'var(--ro-green-text)', placeholder: 'A result, with its number and unit' },
  deviation: { label: 'Deviation', color: 'var(--ro-amber-text)', placeholder: 'What you did differently from the protocol, and why' },
  issue: { label: 'Issue', color: 'var(--ro-red-text)', placeholder: 'What went wrong, and what it affects' },
};

export const REASON: Record<CorrectionReason, string> = { typo: 'Typo', recording: 'Recording error', calculation: 'Calculation error', late: 'Late entry', review: 'Upon review', other: 'Other' };

const startDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function Journal({ e, entries, total, error, reload, runs, onJump }: { e: Experiment; entries: ExpEntry[] | null; total: number; error: string | null; reload: () => void; runs: ExpRun[]; onJump: (ref: { kind: 'step' | 'run'; id: string }) => void }): React.JSX.Element {
  const [show, setShow] = useState<'all' | Kind | 'mine'>('all');
  const [kind, setKind] = useState<Kind>('observation');
  const [about, setAbout] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const scroller = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stick = useRef(true);
  const list = (entries ?? []).filter((x) => show === 'all' || (show === 'mine' ? x.kind !== 'system' : x.kind === show));
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && stick.current) el.scrollTop = el.scrollHeight;
  }, [list.length, entries]);
  const toEnd = (): void => {
    const el = scroller.current;
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
  };
  const addFiles = (picked: FileList | File[] | null): void => {
    if (picked === null) return;
    // Copy now: the picker's list is emptied right after, and a drop's or a paste's when the event ends.
    const copy = Array.from(picked);
    setFiles((f) => [...f, ...copy].slice(0, 20));
  };
  const send = async (): Promise<void> => {
    if ((text.trim() === '' && files.length === 0) || busy) return;
    setBusy(true);
    stick.current = true;
    const [refKind, refId] = about.split(':');
    const params = { experiment: e.id, text: text.trim(), kind, ref: refKind && refId ? { kind: refKind, id: refId } : undefined };
    try {
      if (files.length > 0) await opForm('exp.log', params, { files });
      else await op('exp.log', params);
      setText('');
      setFiles([]);
      changed('exp_log', 'experiments');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  // Day numbers count from the day the experiment started; each day's heading stays in view while its entries scroll.
  const start = e.started_at !== '' ? startDay(parseAt(e.started_at)) : null;
  const days: { day: number; date: Date; items: ExpEntry[] }[] = [];
  for (const x of list) {
    const d = parseAt(x.at);
    const day = startDay(d);
    const last = days[days.length - 1];
    if (last !== undefined && last.day === day) last.items.push(x);
    else days.push({ day, date: d, items: [x] });
  }
  return (
    <div
      className={cn('relative flex min-h-0 flex-1 flex-col', over && 'outline outline-2 -outline-offset-2 outline-[var(--ro-accent)]')}
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes('Files')) {
          ev.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(ev) => {
        if (ev.dataTransfer.files.length === 0) return;
        ev.preventDefault();
        setOver(false);
        addFiles(ev.dataTransfer.files);
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ro-hair)] px-3 py-2">
        <span className="text-[13px] font-bold">Journal</span>
        <span className="num text-[12px] text-[var(--ro-muted)]">{num(total)}</span>
        <span className="flex-1" />
        <select value={show} onChange={(ev) => setShow(ev.target.value as typeof show)} aria-label="Show" className="h-7 cursor-pointer rounded-[var(--ro-r-sm)] bg-transparent px-1 text-[12px] font-semibold text-[var(--ro-ink-2)] outline-none hover:bg-[var(--ro-row)]">
          <option value="all">Everything</option>
          <option value="mine">Written entries only</option>
          {(Object.keys(LOG) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {LOG[k].label}s
            </option>
          ))}
        </select>
      </div>
      <div
        ref={scroller}
        data-scroll
        onScroll={(ev) => {
          const el = ev.currentTarget;
          const end = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          stick.current = end;
          setAtEnd(end);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-2"
      >
        {error !== null ? (
          <div className="py-3">
            <LoadError message={error} onRetry={reload} />
          </div>
        ) : entries === null ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-[12px] leading-5 text-[var(--ro-muted)]">{show === 'all' ? 'Nothing written yet. Write what you do and see as it happens; each entry is stamped with the time.' : 'Nothing of this kind yet.'}</p>
        ) : (
          <div className="flex flex-col">
            {days.map((g) => {
              const n = start !== null && g.day >= start ? Math.round((g.day - start) / 86400000) + 1 : null;
              return (
                <section key={g.day} aria-label={dayLabel(g.date)} className="flex flex-col">
                  <h3 className="sticky top-0 z-[1] -mx-3 flex items-center gap-2 bg-[var(--ro-card)] px-3 pb-1 pt-3 text-[12px] font-bold text-[var(--ro-ink-2)]">
                    {n !== null && <span className="num">Day {n}</span>}
                    {n !== null && <span className="text-[var(--ro-line)]">·</span>}
                    <span>{dayLabel(g.date)}</span>
                    <span className="h-px flex-1 bg-[var(--ro-hair)]" />
                  </h3>
                  <ol className="flex flex-col">
                    {g.items.map((x) => (
                      <li key={x.id} className="flex flex-col">
                        {x.kind === 'system' ? <SystemLine x={x} onJump={onJump} /> : <Entry x={x} tp={tplus(e.started_at, x.at)} onJump={onJump} />}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </div>
      {!atEnd && (
        <button type="button" onClick={toEnd} className="absolute bottom-[150px] left-1/2 z-[2] inline-flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--ro-line)] bg-[var(--ro-card)] px-3 text-[12px] font-semibold shadow-[var(--ro-shadow)] hover:bg-[var(--ro-row)]">
          <ArrowDown size={12} /> Latest
        </button>
      )}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void send();
        }}
        className="flex shrink-0 flex-col gap-1.5 border-t border-[var(--ro-line)] bg-[var(--ro-card)] p-2"
      >
        <span role="radiogroup" aria-label="Kind of entry" className="flex flex-wrap gap-1">
          {(Object.keys(LOG) as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn('inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold', kind === k ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-muted)] hover:bg-[var(--ro-row)]')}>
              <span className="size-1.5 rounded-full" style={{ background: LOG[k].color }} /> {LOG[k].label}
            </button>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="shrink-0 text-[12px] text-[var(--ro-muted)]">About</span>
          <span className="relative flex min-w-0 flex-1">
          <select value={about} onChange={(ev) => setAbout(ev.target.value)} aria-label="What the entry is about" className={cn(inputCls, 'h-7 min-w-0 flex-1 cursor-pointer appearance-none truncate pr-7 text-[12px]')}>
            <option value="">The experiment</option>
            {e.steps.length > 0 && (
              <optgroup label="Protocol steps">
                {e.steps.map((s, i) => (
                  <option key={s.id} value={'step:' + s.id}>
                    Step {i + 1}: {s.text.slice(0, 60)}
                  </option>
                ))}
              </optgroup>
            )}
            {runs.length > 0 && (
              <optgroup label="Runs">
                {runs.slice(0, 300).map((r) => (
                  <option key={r.id} value={'run:' + r.id}>
                    {r.code}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ro-muted)]" />
          </span>
        </span>
        {files.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {files.map((f, i) => (
              <span key={i} className="inline-flex h-6 max-w-[200px] items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] pl-1.5 text-[12px]">
                <Paperclip size={11} className="shrink-0" /> <span className="truncate">{f.name}</span>
                <button type="button" aria-label={'Remove ' + f.name} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded-[3px] p-0.5 hover:bg-[var(--ro-row-hover)]">
                  <X size={10} />
                </button>
              </span>
            ))}
          </span>
        )}
        <span className="flex items-end gap-1.5">
          <textarea
            rows={2}
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                void send();
              }
            }}
            onPaste={(ev) => {
              if (ev.clipboardData.files.length > 0) {
                ev.preventDefault();
                addFiles(ev.clipboardData.files);
              }
            }}
            placeholder={LOG[kind].placeholder}
            aria-label="Journal entry"
            className={cn(textareaCls, 'max-h-40 min-h-[52px] flex-1 [field-sizing:content]')}
          />
          <span className="flex flex-col gap-1">
            <IconButton icon={Paperclip} label="Attach files (or drop, or paste them)" size={30} variant="secondary" onClick={() => fileRef.current?.click()} />
            <IconButton icon={SendHorizontal} label="Write it in the journal (Enter)" size={30} variant="primary" disabled={busy || (text.trim() === '' && files.length === 0)} type="submit" />
          </span>
        </span>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(ev) => {
            addFiles(ev.target.files);
            ev.target.value = '';
          }}
        />
      </form>
    </div>
  );
}

function RefChip({ x, onJump }: { x: ExpEntry; onJump: (ref: { kind: 'step' | 'run'; id: string }) => void }): React.JSX.Element | null {
  if (x.ref === null) return null;
  const r = x.ref;
  return (
    <button type="button" onClick={() => onJump({ kind: r.kind, id: r.id })} title={r.text !== '' ? r.text : 'Show ' + r.label} className="inline-flex h-5 max-w-[160px] items-center rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)] hover:bg-[var(--ro-row-hover)]">
      <span className="truncate">{r.label}</span>
    </button>
  );
}

function SystemLine({ x, onJump }: { x: ExpEntry; onJump: (ref: { kind: 'step' | 'run'; id: string }) => void }): React.JSX.Element {
  return (
    <span className="flex items-start gap-2 py-1 text-[12px] text-[var(--ro-muted)]">
      <span className="num w-10 shrink-0">{clock(x.at)}</span>
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--ro-line)]" />
      <span className="min-w-0 flex-1">
        {x.actor === 'agent' && <Sparkles size={11} className="mr-1 inline text-[var(--ro-accent)]" />}
        {x.text}
      </span>
      {x.ref !== null && x.ref.kind === 'run' && <RefChip x={x} onJump={onJump} />}
    </span>
  );
}

function Entry({ x, tp, onJump }: { x: ExpEntry; tp: string; onJump: (ref: { kind: 'step' | 'run'; id: string }) => void }): React.JSX.Element {
  const K = LOG[x.kind as Kind];
  const [mode, setMode] = useState<'' | 'correct' | 'strike' | 'history'>('');
  const [draft, setDraft] = useState(x.text);
  const [reason, setReason] = useState<CorrectionReason>('typo');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const corrections = x.edits.filter((ed) => ed.action === 'corrected');
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      changed('exp_log', 'experiments');
      setMode('');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const struck = x.struck !== '';
  return (
    <div className="group flex items-start gap-2 border-b border-[var(--ro-hair)] py-2 last:border-0">
      <span className="flex w-10 shrink-0 flex-col">
        <span className="num text-[12px] font-semibold">{clock(x.at)}</span>
        {tp !== '' && <span className="num text-[12px] leading-4 text-[var(--ro-muted)]">{tp}</span>}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: K?.color }}>
            {K?.label ?? x.kind}
          </span>
          <RefChip x={x} onJump={onJump} />
          {x.actor === 'agent' && (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ro-muted)]">
              <Sparkles size={11} className="text-[var(--ro-accent)]" /> Your AI agent
            </span>
          )}
          {x.late && (
            <span className="text-[12px] text-[var(--ro-amber-text)]" title={'Written ' + clock(x.written_at) + ' on ' + dayLabel(parseAt(x.written_at))}>
              Late entry
            </span>
          )}
          <span className="flex-1" />
          {mode === '' && !struck && (
            <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <IconButton icon={Pencil} label="Correct (the original is kept)" size={22} onClick={() => {
                  setDraft(x.text);
                  setMode('correct');
                }} />
              <IconButton icon={Strikethrough} label="Strike out (stays legible)" size={22} variant="danger" onClick={() => {
                  setWhy('');
                  setMode('strike');
                }} />
            </span>
          )}
        </span>
        {mode === 'correct' ? (
          <span className="flex flex-col gap-1.5">
            <textarea autoFocus rows={2} value={draft} onChange={(ev) => setDraft(ev.target.value)} aria-label="Corrected entry" className={cn(textareaCls, '[field-sizing:content]')} />
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-[var(--ro-muted)]">Reason</span>
              <Select ariaLabel="Reason for the correction" className="w-40" value={reason} onChange={(v) => setReason(v as CorrectionReason)} options={(Object.keys(REASON) as CorrectionReason[]).map((r) => ({ value: r, label: REASON[r] }))} />
              <span className="flex-1" />
              <Button size="sm" onClick={() => setMode('')}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={busy} disabled={draft.trim() === x.text} onClick={() => void run(() => op('exp.correct', { entry: x.id, text: draft.trim(), reason }))}>
                Correct
              </Button>
            </span>
          </span>
        ) : (
          x.text !== '' && <p className={cn('whitespace-pre-wrap break-words text-[13px] leading-5', struck && 'text-[var(--ro-muted)] line-through')}>{x.text}</p>
        )}
        {mode === 'strike' && (
          <span className="flex flex-wrap items-center gap-1.5">
            <input autoFocus value={why} onChange={(ev) => setWhy(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && why.trim() !== '' && void run(() => op('exp.strike', { entry: x.id, reason: why.trim() }))} placeholder="Why it is struck out" aria-label="Why it is struck out" className={cn(inputCls, 'h-7 min-w-0 flex-1 text-[12px]')} />
            <Button size="sm" onClick={() => setMode('')}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" loading={busy} disabled={why.trim() === ''} onClick={() => void run(() => op('exp.strike', { entry: x.id, reason: why.trim() }))}>
              Strike out
            </Button>
          </span>
        )}
        {x.files.length > 0 && <Files entry={x} />}
        {struck && <span className="text-[12px] text-[var(--ro-red-text)]">Struck out {clock(x.struck_at)}: {x.struck}</span>}
        {corrections.length > 0 && (
          <span className="flex flex-col gap-1">
            <button type="button" onClick={() => setMode(mode === 'history' ? '' : 'history')} className="self-start text-[12px] text-[var(--ro-muted)] hover:text-[var(--ro-ink)]">
              Corrected {plural(corrections.length, 'time')}: {REASON[corrections[corrections.length - 1]?.reason as CorrectionReason] ?? ''} · {mode === 'history' ? 'hide the original' : 'show the original'}
            </button>
            {mode === 'history' && (
              <ol className="flex flex-col gap-1 border-l-2 border-[var(--ro-line)] pl-2">
                {corrections.map((c, i) => (
                  <li key={i} className="text-[12px]">
                    <span className="text-[var(--ro-muted)]">
                      Before {clock(c.at)} ({REASON[c.reason as CorrectionReason] ?? c.reason}):
                    </span>{' '}
                    <span className="whitespace-pre-wrap text-[var(--ro-ink-2)]">{c.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function Files({ entry }: { entry: ExpEntry }): React.JSX.Element {
  const url = (name: string): string => opUrl('exp.file', { entry: entry.id, name });
  const pics = entry.files.filter((f) => f.image);
  const other = entry.files.filter((f) => !f.image);
  return (
    <span className="flex flex-col gap-1.5">
      {pics.length > 0 && (
        <span className="grid grid-cols-3 gap-1.5">
          {pics.map((f) => (
            <a key={f.name} href={url(f.name)} target="_blank" rel="noreferrer" title={f.shown} className="block overflow-hidden rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-[var(--ro-row)]">
              <img src={url(f.name)} alt={f.shown} loading="lazy" className="aspect-square w-full object-cover" />
            </a>
          ))}
        </span>
      )}
      {other.map((f) => (
        <a key={f.name} href={url(f.name)} className="inline-flex h-6 max-w-full items-center gap-1 self-start rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-1.5 text-[12px] font-semibold hover:bg-[var(--ro-row-hover)]" title={'Download ' + f.shown}>
          <Paperclip size={11} className="shrink-0" /> <span className="truncate">{f.shown}</span>
        </a>
      ))}
    </span>
  );
}
