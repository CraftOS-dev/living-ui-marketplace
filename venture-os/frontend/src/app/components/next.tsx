/**
 * The Next queue on screen (SPEC 2, U7; SPEC 4.3): the generic NextCard
 * that Focus mode shows one at a time, the compact NextRow for Home and
 * lists, and the one way to run a NextItem action (confirm, chip choice,
 * PIN, optimistic removal, the Undo toast).
 *
 * A module that needs more than figures, chips, steps, a body, before and
 * after lines or a quote registers a body renderer under `cards` (the frame
 * around it, the title and the actions, stay the kernel's).
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Banknote, BadgeCheck, Bell, CircleCheck, FileSearch, Gavel, GitPullRequestArrow, Hourglass, ListChecks, Mail, NotebookPen, Radar, Scale, SkipForward, Vote } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { askPin, isOp, runOp } from '../lib/api.ts';
import { PIN_OPS } from '../lib/ops.gen.ts';
import { act, drop } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import { toast } from '../lib/toast.ts';
import type { NextAction, NextItem, NextKind } from '../lib/types.ts';
import { cards } from '../registry.ts';
import { humanize } from '../lib/format.ts';
import { AgentTag, Button, ChipPicker, Citation, FigureStrip, IconButton, Input, Skeleton, Tag, StepTrack, Textarea, chipTone, confirmAsk } from './ui.tsx';

/** No editable fields. */
const EMPTY_FIELDS: Record<string, string> = {};
/** Words for the edit fields an item sends (NextData.edit.fields keys). */
const FIELD_WORDS: Record<string, string> = { subject: 'Subject', body: 'Message' };

export const KIND: Record<NextKind, { label: string; icon: LucideIcon }> = {
  verdict: { label: 'Verdict', icon: FileSearch },
  draft: { label: 'Draft', icon: Mail },
  proposal: { label: 'Proposal', icon: GitPullRequestArrow },
  vote: { label: 'Vote', icon: Vote },
  decision: { label: 'Decision', icon: Gavel },
  verify: { label: 'Verify', icon: BadgeCheck },
  alert: { label: 'Alert', icon: Bell },
  condition: { label: 'Condition', icon: ListChecks },
  payment: { label: 'Payment', icon: Banknote },
  mark: { label: 'Mark', icon: Scale },
  candidate: { label: 'Candidate', icon: Radar },
  note: { label: 'Note', icon: NotebookPen },
  task: { label: 'Task', icon: CircleCheck },
  stall: { label: 'Stalled', icon: Hourglass },
};

export function kindOf(k: string): { label: string; icon: LucideIcon } {
  return KIND[k as NextKind] ?? { label: 'Item', icon: CircleCheck };
}

/** Every view that shows Next items (they reload on any change). */
export const NEXT_READS = ['*'];

/**
 * Run one action of a Next item: ask "Sure?" when it says so, take the
 * chosen chip's value, let op() ask the PIN, take the item off every Next
 * view at once and put it back when the op fails. When the action names an
 * undo, the toast offers it. True when it ran.
 */
export async function runNextAction(item: NextItem, a: NextAction, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (!isOp(a.op)) {
    toast.error('This action is not available.');
    return false;
  }
  if (a.confirm === true && !(await confirmAsk(`${a.label} ${item.title}?`, a.label, a.tone === 'danger' ? 'danger' : 'primary'))) return false;
  const params: Record<string, unknown> = { ...(a.params ?? {}), ...extra };
  // The PIN first, so the card leaves only once the person has confirmed.
  if (PIN_OPS.has(a.op) || a.pin === true) {
    const pin = await askPin({ title: a.label });
    if (pin === null) return false;
    params['pin'] = pin;
  }
  const out = await act([drop(item.key)], () => runOp<unknown>(a.op, params), NEXT_READS);
  if (out === null) return false;
  // An op that answers where its result is (network's "Add note" answers the note) opens it.
  const where = out !== null && typeof out === 'object' ? (out as { href?: unknown }).href : undefined;
  if (typeof where === 'string' && where !== '') go(where);
  const undo = a.undo;
  if (undo !== undefined && isOp(undo.op)) toast.undo(a.done ?? 'Done', () => void act([], () => runOp(undo.op, undo.params ?? {}), NEXT_READS));
  return true;
}

/** The primary action of an item (or its first). */
export function primaryOf(item: NextItem): NextAction | undefined {
  return item.actions.find((a) => a.primary === true) ?? item.actions[0];
}

/* ------------------------------------------------------------------ card */

export interface NextCardProps {
  item: NextItem;
  /** "3 / 12" */
  position?: string | undefined;
  /** E pressed: edit the body when the item allows it. */
  editing?: boolean | undefined;
  onEditing?: ((v: boolean) => void) | undefined;
  /** After an action ran (Focus mode moves on). */
  onDone?: (() => void) | undefined;
  /** Big buttons (phones, Focus). */
  large?: boolean | undefined;
  /** The action whose chips are open (lifted so Focus keys can open it). */
  choosing?: NextAction | null | undefined;
  onChoosing?: ((a: NextAction | null) => void) | undefined;
  /** Focus mode: the Skip button (keyboard X). */
  onSkip?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * One NextItem in full: what it is, the result your AI agent prepared
 * (figures, chips, a StepTrack, a body, before and after lines, a quote)
 * and 1 to 3 actions, the primary black. A `choose` action opens its chips
 * in place; E edits the item's fields (data.edit.fields) in place.
 */
export function NextCard({ item, position, editing, onEditing, onDone, large, choosing: choosingProp, onChoosing, onSkip, className }: NextCardProps): React.JSX.Element {
  const [ownChoosing, setOwnChoosing] = useState<NextAction | null>(null);
  const choosing = choosingProp !== undefined ? choosingProp : ownChoosing;
  const setChoosing = onChoosing ?? setOwnChoosing;
  const [busy, setBusy] = useState('');
  const edit = item.data?.edit;
  const original = edit?.fields ?? EMPTY_FIELDS;
  const [vals, setVals] = useState<Record<string, string>>(original);
  const [saving, setSaving] = useState(false);
  // A fresh item (or the saved draft coming back) starts from what it holds now.
  useEffect(() => {
    if (editing !== true) setVals(original);
  }, [original, editing]);
  const k = kindOf(item.kind);
  const Icon = k.icon;
  const d = item.data ?? {};
  const renderer = item.card !== '' ? cards()[item.card] : undefined;
  const Body = renderer === undefined ? undefined : typeof renderer === 'object' && 'body' in renderer ? renderer.body : renderer;
  const showFigures = !(renderer !== undefined && typeof renderer === 'object' && 'body' in renderer && renderer.figures === false);

  const run = useCallback(
    async (a: NextAction, extra: Record<string, unknown> = {}): Promise<void> => {
      if (a.choose !== null && a.choose !== undefined && extra[a.choose.param] === undefined) {
        setChoosing(a);
        return;
      }
      setBusy(a.label);
      const ok = await runNextAction(item, a, extra);
      setBusy('');
      setChoosing(null);
      if (ok) onDone?.();
    },
    [item, onDone, setChoosing],
  );

  /** Save every edited field through the item's op (edit.params plus the changed fields). */
  const saveEdit = async (): Promise<void> => {
    if (edit === undefined || !isOp(edit.op)) return;
    const changed: Record<string, string> = {};
    for (const k of Object.keys(original)) if (vals[k] !== undefined && vals[k] !== original[k]) changed[k] = vals[k] ?? '';
    if (Object.keys(changed).length === 0) {
      onEditing?.(false);
      return;
    }
    setSaving(true);
    const out = await act([], () => runOp(edit.op, { ...(edit.params ?? {}), ...changed }), NEXT_READS);
    setSaving(false);
    if (out !== null) onEditing?.(false);
  };
  const cancelEdit = (): void => {
    setVals(original);
    onEditing?.(false);
  };

  return (
    <article aria-label={item.title} className={cn('vo-panel flex min-w-0 flex-col', className)}>
      <div className="flex flex-col gap-4 p-5 md:p-6">
        <div className="flex items-center gap-2 text-[12px] text-[var(--vo-muted)]">
          <span className="flex size-6 items-center justify-center rounded-[6px] border border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]">
            <Icon size={13} strokeWidth={1.9} aria-hidden />
          </span>
          <span className="font-medium text-[var(--vo-ink-2)]">{k.label}</span>
          {item.agent === true && <AgentTag />}
          <span className="flex-1" />
          {position !== undefined && <span className="vo-mono vo-num">{position}</span>}
        </div>
        <h2 className="vo-wrap text-[26px] font-semibold leading-8 tracking-[-0.02em]">{item.title}</h2>
        {item.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.chips.map((c) => (
              <Tag key={c.label} tone={chipTone(c.tone)}>
                {c.label}
              </Tag>
            ))}
          </div>
        )}
        {item.steps !== null && <StepTrack labels={item.steps.labels} at={item.steps.at} className="max-w-[420px]" />}
        {showFigures && item.figures.length > 0 && <FigureStrip items={item.figures.slice(0, 3).map((f) => ({ label: f.label, value: f.value }))} />}
        {Body !== undefined && (
          <Suspense fallback={<Skeleton className="h-16 w-full" />}>
            <Body item={item} />
          </Suspense>
        )}
        {d.lines !== undefined && d.lines.length > 0 && (
          <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 gap-y-1.5 rounded-[var(--vo-radius-sm)] bg-[var(--vo-sunk)] px-4 py-3 text-[13px]">
            {d.lines.map((l) => (
              <div key={l.label} className="contents">
                <dt className="text-[var(--vo-muted)]">{l.label}</dt>
                <dd className="vo-wrap min-w-0">
                  {l.before !== undefined && l.before !== '' && (
                    <>
                      <span className="text-[var(--vo-muted)] line-through decoration-[var(--vo-line-2)]">{l.before}</span>
                      <span aria-hidden className="mx-1.5 text-[var(--vo-muted)]">
                        {'→'}
                      </span>
                    </>
                  )}
                  <span className="font-medium">{l.after}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {d.quote !== undefined && (
          <blockquote className="vo-wrap flex items-start gap-2 border-l-2 border-[var(--vo-line-2)] pl-3 text-[13px] leading-5 text-[var(--vo-ink-2)]">
            <span className="min-w-0 flex-1">{d.quote.text}</span>
            {d.quote.source !== undefined && <Citation label={d.quote.source} quote={d.quote.text} href={d.quote.href} source={d.quote.file !== undefined && d.quote.file !== '' ? { file: d.quote.file, page: d.quote.page, anchor: d.quote.anchor, quote: d.quote.text } : undefined} />}
          </blockquote>
        )}
        {editing === true && edit !== undefined ? (
          <div className="flex flex-col gap-2">
            {Object.keys(original)
              .sort((a, b) => (a === 'body' ? 1 : 0) - (b === 'body' ? 1 : 0))
              .map((k, i, all) => {
              const keys = (e: React.KeyboardEvent): void => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void saveEdit();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelEdit();
                }
              };
              const label = FIELD_WORDS[k] ?? humanize(k);
              // The body takes the focus (the text people correct); otherwise the first field.
              const focus = all.includes('body') ? k === 'body' : i === 0;
              return k === 'body' ? (
                <Textarea key={k} value={vals[k] ?? ''} autoFocus={focus} minRows={6} maxRows={18} aria-label={label} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} onKeyDown={keys} />
              ) : (
                <Input key={k} value={vals[k] ?? ''} autoFocus={focus} aria-label={label} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} onKeyDown={keys} />
              );
            })}
            {/* While editing, Save is the one black button (the primary action waits below, outlined). */}
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" busy={saving} onClick={() => void saveEdit()}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          d.body !== undefined && <div className="vo-wrap vo-scroll max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-[var(--vo-radius-sm)] border border-[var(--vo-hair)] bg-[var(--vo-raised)] px-4 py-3 text-[13px] leading-5">{d.body}</div>
        )}
      </div>
      <footer className={cn('flex flex-wrap items-center gap-2 border-t border-[var(--vo-hair)] px-5 py-3 md:px-6', large === true && 'flex-col items-stretch')}>
        {choosing !== null && choosing.choose !== null && choosing.choose !== undefined ? (
          <>
            <ChipPicker label={choosing.label} keys options={choosing.choose.options} value="" onChange={(v) => void run(choosing, { [choosing.choose?.param ?? 'value']: v })} className="min-w-0 flex-1" />
            <Button variant="ghost" size={large === true ? 'lg' : 'md'} onClick={() => setChoosing(null)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {large === true &&
              item.actions
                .filter((a) => a.primary === true)
                .map((a) => (
                  <Button key={a.label} variant={editing === true ? 'default' : 'primary'} size="lg" busy={busy === a.label} disabled={busy !== '' || editing === true} onClick={() => void run(a)}>
                    {a.label}
                  </Button>
                ))}
            <div className={cn('flex min-w-0 flex-wrap items-center gap-2', large === true ? 'w-full' : 'flex-1')}>
              {item.href !== '' && <IconButton icon={ArrowUpRight} label="Open" size={large === true ? 40 : 32} onClick={() => go(item.href)} />}
              {onSkip !== undefined && <IconButton icon={SkipForward} label="Skip (X)" size={large === true ? 40 : 32} disabled={busy !== '' || editing === true} onClick={onSkip} />}
              {edit !== undefined && editing !== true && (
                <Button variant="ghost" size={large === true ? 'lg' : 'md'} kbd="E" onClick={() => onEditing?.(true)}>
                  Edit
                </Button>
              )}
              <span className="flex-1" />
              {item.actions
                .filter((a) => a.primary !== true)
                .map((a) => (
                  <Button key={a.label} variant={a.tone === 'danger' ? 'danger' : 'default'} size={large === true ? 'lg' : 'md'} busy={busy === a.label} disabled={busy !== '' || editing === true} onClick={() => void run(a)}>
                    {a.label}
                  </Button>
                ))}
              {large !== true &&
                item.actions
                  .filter((a) => a.primary === true)
                  .map((a) => (
                    <Button key={a.label} variant={editing === true ? 'default' : 'primary'} kbd="A" busy={busy === a.label} disabled={busy !== '' || editing === true} onClick={() => void run(a)}>
                      {a.label}
                    </Button>
                  ))}
            </div>
          </>
        )}
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------- row */

/**
 * A compact Next row (Home's top five, module lists): the kind icon, the
 * title, one figure, the primary action inline. The row opens Focus mode at
 * the item.
 */
export function NextRow({ item, onOpen }: { item: NextItem; onOpen?: ((item: NextItem) => void) | undefined }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const k = kindOf(item.kind);
  const Icon = k.icon;
  const p = primaryOf(item);
  const fig = item.figures?.[0];
  return (
    <div className="group flex h-11 min-w-0 items-center gap-3 border-b border-[var(--vo-hair)] px-1 transition-colors duration-150 last:border-b-0 hover:bg-[var(--vo-hover)]">
      <button type="button" onClick={() => onOpen?.(item)} className="vo-focus flex h-full min-w-0 flex-1 items-center gap-3 rounded-[var(--vo-radius-sm)] pl-1 text-left">
        <span title={k.label} className="flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]">
          <Icon size={13} strokeWidth={1.9} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.title}</span>
        {item.agent === true && <AgentTag />}
        {fig !== undefined && <span className="vo-mono vo-num hidden shrink-0 text-[13px] text-[var(--vo-ink-2)] sm:inline">{fig.value}</span>}
      </button>
      {p !== undefined && (p.choose === null || p.choose === undefined) && (
        <Button
          size="sm"
          busy={busy}
          onClick={() => {
            setBusy(true);
            void runNextAction(item, p).finally(() => setBusy(false));
          }}
        >
          {p.label}
        </Button>
      )}
      {p !== undefined && p.choose !== null && p.choose !== undefined && (
        <Button size="sm" onClick={() => onOpen?.(item)}>
          {p.label}
        </Button>
      )}
    </div>
  );
}
