/**
 * References on a deal: counts by kind and signal, a one-line log (name,
 * kind, signal: picking the signal logs the call), the calls logged, and the
 * names your AI agent suggested from the firm's own records (Suggest names),
 * each logged with one signal click or dismissed.
 */
import { useState } from 'react';
import { Pencil, PhoneCall, Sparkle, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { fmtDay } from '../../lib/format.ts';
import { act, drop, patch, useOp } from '../../lib/live.ts';
import { AgentTag, Button, Empty, IconButton, Input, LoadError, Segmented, Skeleton, StepTrack, Tag, Tip } from '../ui.tsx';
import type { RefKind, Reference, RefsView, Signal } from './types.ts';
import { REF_READS } from './types.ts';
import { AgentSteps, AskAgent, stateOfTrack } from '../agent.tsx';

const KINDS: { value: RefKind; label: string }[] = [
  { value: 'backchannel', label: 'Backchannel' },
  { value: 'provided', label: 'Provided' },
  { value: 'customer', label: 'Customer' },
  { value: 'expert', label: 'Expert' },
];
const KIND_LABEL: Record<RefKind, string> = { backchannel: 'Backchannel', provided: 'Provided', customer: 'Customer', expert: 'Expert' };
const SIGNALS: { value: Signal; label: string; cls: string }[] = [
  { value: 'positive', label: 'Positive', cls: 'bg-[var(--vo-good)] border-[var(--vo-good)]' },
  { value: 'neutral', label: 'Neutral', cls: 'bg-[var(--vo-line-2)] border-[var(--vo-line-2)]' },
  { value: 'negative', label: 'Negative', cls: 'bg-[var(--vo-bad)] border-[var(--vo-bad)]' },
];

function SignalDot({ s, size = 8 }: { s: Signal | ''; size?: number }): React.JSX.Element {
  const x = SIGNALS.find((o) => o.value === s);
  return <span role="img" aria-label={x?.label ?? 'No signal'} title={x?.label ?? 'No signal'} className={cn('inline-block shrink-0 rounded-full border-[1.5px]', x !== undefined ? x.cls : 'border-dashed border-[var(--vo-line-2)]')} style={{ width: size, height: size }} />;
}

/** Three signal dots as buttons; a click picks (and usually logs). */
function SignalPick({ onPick, disabled }: { onPick: (s: Signal) => void; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <span role="group" aria-label="Signal" className="flex shrink-0 items-center gap-0.5">
      {SIGNALS.map((s) => (
        <button key={s.value} type="button" title={s.label} aria-label={s.label} disabled={disabled} onClick={() => onPick(s.value)} className="vo-focus vo-tap-sq flex size-7 items-center justify-center rounded-[var(--vo-radius-sm)] transition-colors duration-150 hover:bg-[var(--vo-active)] disabled:opacity-40">
          <span className={cn('size-2.5 rounded-full border-[1.5px]', s.cls)} />
        </button>
      ))}
    </span>
  );
}

export function References({ dealId, edit }: { dealId: string; edit: boolean }): React.JSX.Element {
  const live = useOp<RefsView>('refs.list', { deal: dealId }, REF_READS, { name: 'refs.list' });
  const v = live.data;
  const job = v?.ask ?? null;
  return (
    <section aria-label="References" className="vo-in flex min-w-0 flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="vo-label">References</span>
        {v !== null && (
          <span className="flex flex-wrap items-center gap-1.5">
            {KINDS.filter((k) => (v.counts.by_kind[k.value] ?? 0) > 0).map((k) => (
              <Tag key={k.value}>
                {k.label}
                <span className="vo-mono vo-num text-[var(--vo-muted)]">{v.counts.by_kind[k.value]}</span>
              </Tag>
            ))}
            {SIGNALS.filter((s) => (v.counts.by_signal[s.value] ?? 0) > 0).map((s) => (
              <span key={s.value} title={s.label} className="flex items-center gap-1 pl-1">
                <SignalDot s={s.value} />
                <span className="vo-mono vo-num text-[12px] text-[var(--vo-ink-2)]">{v.counts.by_signal[s.value]}</span>
              </span>
            ))}
          </span>
        )}
        <span className="flex-1" />
        {job !== null && job.open && <AgentSteps track={job} compact className="w-24" />}
        {edit && <AskAgent label="Suggest names" variant="ghost" title="Names from the firm's records who worked with the founders" state={stateOfTrack(job)} onAsk={(again) => op('refs.ask', { deal: dealId, ...(again !== '' ? { again } : {}) })} reads={REF_READS} />}
      </div>
      <div className="vo-panel min-w-0">
        {v === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Skeleton className="m-4 h-16" />
          )
        ) : (
          <>
            {edit && <LogRow dealId={dealId} />}
            {v.references.length === 0 && !edit && <Empty icon={PhoneCall} title="No references" />}
            {v.references.length > 0 && (
              <ul className="min-w-0 py-1">
                {v.references.map((r) => (r.status === 'suggested' ? <SuggestedRow key={r.id} r={r} edit={edit} /> : <LoggedRow key={r.id} r={r} edit={edit} />))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Name, kind, signal: picking the signal logs the call. */
function LogRow({ dealId }: { dealId: string }): React.JSX.Element {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RefKind>('backchannel');
  const [busy, setBusy] = useState(false);
  const log = async (signal: Signal): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    const out = await act([], () => op('refs.log', { deal: dealId, name: name.trim(), kind, signal }), REF_READS);
    setBusy(false);
    if (out !== null) setName('');
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--vo-hair)] px-4 py-2.5">
      <Input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-48 max-w-full flex-1 sm:flex-none" disabled={busy} />
      <Segmented size="sm" label="Kind" value={kind} onChange={setKind} options={KINDS} />
      <SignalPick onPick={(s) => void log(s)} disabled={busy || name.trim() === ''} />
    </div>
  );
}

function LoggedRow({ r, edit }: { r: Reference; edit: boolean }): React.JSX.Element {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(r.note);
  const save = async (): Promise<void> => {
    setNoting(false);
    if (note.trim() === r.note) return;
    await act([patch(r.id, { note: note.trim() })], () => op('refs.log', { reference: r.id, kind: r.kind, signal: r.signal === '' ? 'neutral' : r.signal, note: note.trim(), day: r.day }), REF_READS);
  };
  const who = [r.title, r.company?.name].filter((x) => x !== undefined && x !== '').join(', ');
  return (
    <li className="group flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 transition-colors duration-150 hover:bg-[var(--vo-hover)] sm:flex-nowrap">
      <SignalDot s={r.signal} />
      <span className="flex min-w-0 items-baseline gap-2 sm:w-[34%]">
        <span className="vo-wrap min-w-0 text-[13px] font-medium">{r.name}</span>
        {who !== '' && <span className="hidden truncate text-[12px] text-[var(--vo-muted)] md:inline">{who}</span>}
      </span>
      <Tag>{KIND_LABEL[r.kind]}</Tag>
      {noting ? (
        <Input autoFocus aria-label="Note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => (e.key === 'Enter' ? void save() : e.key === 'Escape' ? (setNote(r.note), setNoting(false)) : undefined)} className="h-7 min-w-0 flex-1" />
      ) : (
        <span className="vo-wrap min-w-0 flex-1 text-[12px] text-[var(--vo-ink-2)]">{r.note}</span>
      )}
      {edit && !noting && (
        <span className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton icon={Pencil} label="Note" size={28} onRow onClick={() => setNoting(true)} />
        </span>
      )}
      <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-muted)]">{r.day !== '' ? fmtDay(r.day) : ''}</span>
    </li>
  );
}

function SuggestedRow({ r, edit }: { r: Reference; edit: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const log = async (signal: Signal): Promise<void> => {
    setBusy(true);
    await act([patch(r.id, { status: 'logged', signal })], () => op('refs.log', { reference: r.id, signal }), REF_READS);
    setBusy(false);
  };
  const dismiss = (): void => void act([drop(r.id)], () => op('refs.dismiss', { reference: r.id }), REF_READS);
  const why = r.why?.text ?? '';
  return (
    <li className="group flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 transition-colors duration-150 hover:bg-[var(--vo-hover)] sm:flex-nowrap">
      <AgentTag />
      <span className="vo-wrap min-w-0 text-[13px] font-medium sm:w-[30%]">{r.name}</span>
      <span className="vo-wrap min-w-0 flex-1 text-[12px] text-[var(--vo-ink-2)]">{why}</span>
      {edit && (
        <span className="flex shrink-0 items-center gap-1">
          <SignalPick onPick={(s) => void log(s)} disabled={busy} />
          <IconButton icon={X} label="Dismiss" size={28} onRow onClick={dismiss} />
        </span>
      )}
    </li>
  );
}
