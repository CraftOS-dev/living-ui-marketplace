/**
 * Deadline building blocks shared by Today, Deadlines, matter and agreement
 * pages: the row, the grouped list with bulk actions, and the dialogs that
 * close (with a reason), extend (tier preview), move (diff preview),
 * reassign, and explain ("Why this date?").
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarClock, Check, ChevronRight, HelpCircle, Lock, MoreHorizontal, Undo2, UserRound } from 'lucide-react';
import { Button, Dialog, Drawer, DropdownMenu, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { op, opToast } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLiveRecords } from '../lib/live.ts';
import {
  WINDOW_LABEL,
  d10,
  deadlineSeverity,
  fmtDate,
  fmtShort,
  targetPassed,
  today,
  windowOf,
} from '../lib/format.ts';
import type { Window } from '../lib/format.ts';
import { CATEGORY_LABEL, DEADLINE_STATUS_LABEL, KIND_HELP, KIND_LABEL, SOURCE_LABEL } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { DeadlineRec, DeadlineStatus } from '../lib/types.ts';
import { Checkbox, Field, GroupHeader, IdentityChip, JurChip, Notice, Pill, Ref, TONE_BAR, Tag } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */

export interface DeadlineActions {
  onDone: (d: DeadlineRec) => void;
  onClose: (d: DeadlineRec[]) => void;
  onExtend: (d: DeadlineRec) => void;
  onMove: (d: DeadlineRec[]) => void;
  onReassign: (d: DeadlineRec[]) => void;
  onWhy: (d: DeadlineRec) => void;
}

function subjectLink(d: DeadlineRec): string {
  if (d.matter) return href('matter', d.matter);
  if (d.agreement) return href('agreement', d.agreement);
  if (d.work) return href('work', d.work);
  if (d.disclosure) return href('invention', d.disclosure);
  return '';
}

export function DeadlineRow({
  d,
  actions,
  selected,
  onSelect,
  showSubject = true,
  subjectLabel,
}: {
  d: DeadlineRec;
  actions: DeadlineActions | null;
  selected?: boolean | undefined;
  onSelect?: ((v: boolean) => void) | undefined;
  showSubject?: boolean | undefined;
  subjectLabel?: ReactNode | undefined;
}): React.JSX.Element {
  const { userName } = useApp();
  const sev = deadlineSeverity(d);
  const open = d.status === 'open';
  const target = d10(d.target_date);
  const due = d10(d.due_date);
  const fin = d10(d.final_date);
  const link = subjectLink(d);
  const assignee = userName(d.assignee);
  const menu = actions !== null && open;

  return (
    <div className={cn('group grid grid-cols-[4px_minmax(0,1fr)_auto] items-stretch border-b border-[var(--agent-app-border)]/70 last:border-0', selected && 'bg-[var(--agent-app-accent)]/5')}>
      <div className={cn(open ? TONE_BAR[sev.tone] : 'bg-transparent')} aria-hidden />
      <div className="flex min-w-0 items-start gap-3 py-2.5 pl-3 pr-2">
        {onSelect !== undefined && open && (
          <div className="pt-0.5">
            <Checkbox checked={selected === true} onChange={onSelect} ariaLabel={`Select ${d.title}`} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showSubject && d.ref !== '' && (
              <a href={link} className="hover:underline">
                <Ref>{d.ref}</Ref>
              </a>
            )}
            {showSubject && d.jurisdiction !== '' && <JurChip code={d.jurisdiction} />}
            <button
              type="button"
              className={cn('min-w-0 text-left text-sm font-medium hover:underline', !open && 'text-[var(--agent-app-muted)] line-through decoration-1')}
              onClick={() => actions?.onWhy(d)}
            >
              {d.title}
            </button>
            {open ? (
              <Pill tone={sev.tone}>{sev.label}</Pill>
            ) : (
              <Pill tone={d.status === 'done' ? 'good' : d.status === 'missed' ? 'bad' : 'neutral'}>{DEADLINE_STATUS_LABEL[d.status]}</Pill>
            )}
            {d.locked && (
              <span title="Date locked by a person; recalculation will not move it" className="text-[var(--agent-app-muted)]">
                <Lock size={12} aria-hidden />
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--agent-app-muted)]">
            {showSubject && subjectLabel !== undefined && <span className="truncate">{subjectLabel}</span>}
            <span className="tabular-nums">
              {target !== '' && target !== due && open && (
                <span className={cn(targetPassed(d) && 'font-medium text-amber-700 dark:text-amber-400')}>
                  Target {fmtShort(target)}
                  {targetPassed(d) ? ' (passed)' : ''} ·{' '}
                </span>
              )}
              <span className="text-[var(--agent-app-text)]/80">Due {fmtDate(due)}</span>
              {fin !== '' && fin !== due && <span> · Final {fmtShort(fin)}</span>}
              {d10(d.grace_end) !== '' && <span> · Grace to {fmtShort(d.grace_end)}</span>}
            </span>
            <Tag title={KIND_HELP[d.kind]}>{KIND_LABEL[d.kind]}</Tag>
            {d.source !== '' && <Tag title="Where this date came from">{SOURCE_LABEL[d.source] ?? d.source}</Tag>}
            {!open && d.close_reason !== '' && <span className="truncate">“{d.close_reason}”</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 pr-3">
        {assignee !== '' ? (
          <IdentityChip name={assignee} size="sm" title={`Assigned to ${assignee}`} />
        ) : open ? (
          <span title="Nobody assigned" className="flex size-5 items-center justify-center rounded-full border border-dashed border-[var(--agent-app-border)] text-[var(--agent-app-muted)]">
            <UserRound size={11} aria-hidden />
          </span>
        ) : null}
        {menu && actions !== null && (
          <>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => actions.onDone(d)} title="Mark done">
              <Check size={13} aria-hidden /> Done
            </Button>
            <DropdownMenu
              align="right"
              trigger={
                <span className="flex size-7 items-center justify-center border border-[var(--agent-app-border)] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30" aria-label="More actions">
                  <MoreHorizontal size={14} />
                </span>
              }
              items={[
                { label: 'Why this date?', icon: <HelpCircle size={14} />, onSelect: () => actions.onWhy(d) },
                { label: 'Close with a reason', icon: <Check size={14} />, onSelect: () => actions.onClose([d]) },
                ...(d.kind === 'extendable' || d.kind === 'designated'
                  ? [{ label: 'Extend', icon: <CalendarClock size={14} />, onSelect: () => actions.onExtend(d) }]
                  : []),
                { label: 'Move date', icon: <Undo2 size={14} />, onSelect: () => actions.onMove([d]) },
                { label: 'Reassign', icon: <UserRound size={14} />, onSelect: () => actions.onReassign([d]) },
              ]}
            />
          </>
        )}
        {!menu && actions !== null && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => actions.onWhy(d)}>
            Details <ChevronRight size={13} aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grouped list with bulk bar                                          */
/* ------------------------------------------------------------------ */

const WINDOWS: Window[] = ['overdue', 'week', 'd30', 'd60', 'd90', 'later'];

export function DeadlineList({
  deadlines,
  actions,
  grouped = true,
  bulk = true,
  subjectLabel,
  empty,
}: {
  deadlines: DeadlineRec[];
  actions: DeadlineActions | null;
  grouped?: boolean | undefined;
  bulk?: boolean | undefined;
  subjectLabel?: ((d: DeadlineRec) => ReactNode) | undefined;
  empty?: ReactNode | undefined;
}): React.JSX.Element {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const open = deadlines.filter((d) => d.status === 'open');
  const selected = open.filter((d) => sel.has(d.id));
  const toggle = (id: string, v: boolean): void => {
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  };
  const groups = useMemo((): { key: string; label: string; items: DeadlineRec[] }[] => {
    if (!grouped) return [{ key: 'all', label: '', items: deadlines }];
    const map = new Map<string, DeadlineRec[]>();
    for (const w of WINDOWS) map.set(w, []);
    const closed: DeadlineRec[] = [];
    for (const d of deadlines) {
      if (d.status !== 'open') closed.push(d);
      else map.get(windowOf(d10(d.due_date)))?.push(d);
    }
    const out: { key: string; label: string; items: DeadlineRec[] }[] = WINDOWS.map((w) => ({ key: w as string, label: WINDOW_LABEL[w], items: map.get(w) ?? [] })).filter((g) => g.items.length > 0);
    if (closed.length) out.push({ key: 'closed', label: 'Closed', items: closed });
    return out;
  }, [deadlines, grouped]);

  if (deadlines.length === 0) return <>{empty}</>;

  return (
    <div>
      {bulk && actions !== null && selected.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-2">
          <span className="text-[13px] font-medium">{selected.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => actions.onClose(selected)}>
            Close
          </Button>
          <Button size="sm" variant="outline" onClick={() => actions.onReassign(selected)}>
            Reassign
          </Button>
          <Button size="sm" variant="outline" onClick={() => actions.onMove(selected)}>
            Move dates
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {groups.map((g) => {
        const openInGroup = g.items.filter((d) => d.status === 'open');
        const all = openInGroup.length > 0 && openInGroup.every((d) => sel.has(d.id));
        return (
          <div key={g.key}>
            {g.label !== '' && (
              <GroupHeader
                label={g.label}
                count={g.items.length}
                tone={g.key === 'overdue' ? 'bad' : undefined}
                right={
                  bulk && actions !== null && openInGroup.length > 0 ? (
                    <Checkbox
                      checked={all}
                      indeterminate={!all && openInGroup.some((d) => sel.has(d.id))}
                      onChange={(v) => {
                        setSel((s) => {
                          const n = new Set(s);
                          for (const d of openInGroup) {
                            if (v) n.add(d.id);
                            else n.delete(d.id);
                          }
                          return n;
                        });
                      }}
                      ariaLabel={`Select all in ${g.label}`}
                    />
                  ) : undefined
                }
              />
            )}
            {g.items.map((d) => (
              <DeadlineRow
                key={d.id}
                d={d}
                actions={actions}
                selected={sel.has(d.id)}
                onSelect={bulk && actions !== null ? (v) => toggle(d.id, v) : undefined}
                subjectLabel={subjectLabel?.(d)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controller: one hook wires every dialog                            */
/* ------------------------------------------------------------------ */

type Dlg =
  | { kind: 'close'; items: DeadlineRec[] }
  | { kind: 'extend'; item: DeadlineRec }
  | { kind: 'move'; items: DeadlineRec[] }
  | { kind: 'reassign'; items: DeadlineRec[] }
  | { kind: 'why'; item: DeadlineRec }
  | null;

/** Returns row actions (null when the user cannot edit) plus the dialogs element. */
export function useDeadlineActions(onChanged?: () => void): { actions: DeadlineActions; readOnlyActions: DeadlineActions; dialogs: React.JSX.Element; canEdit: boolean } {
  const { can } = useApp();
  const [dlg, setDlg] = useState<Dlg>(null);
  const changed = (): void => onChanged?.();

  const doneNow = async (d: DeadlineRec): Promise<void> => {
    const r = await opToast<{ closed: number; results: { next: { title: string; due_date: string } | null }[] }>('deadlines/close', {
      ids: [d.id],
      status: 'done',
      reason: '',
    });
    if (r !== null) {
      const next = r.results[0]?.next;
      toast.success(next ? `Done. Next: ${next.title}, due ${fmtDate(next.due_date)}` : 'Marked done');
      changed();
    }
  };

  const actions: DeadlineActions = {
    onDone: (d) => void doneNow(d),
    onClose: (items) => setDlg({ kind: 'close', items }),
    onExtend: (item) => setDlg({ kind: 'extend', item }),
    onMove: (items) => setDlg({ kind: 'move', items }),
    onReassign: (items) => setDlg({ kind: 'reassign', items }),
    onWhy: (item) => setDlg({ kind: 'why', item }),
  };
  const readOnlyActions: DeadlineActions = { ...actions };

  const dialogs = (
    <>
      {dlg?.kind === 'close' && <CloseDialog items={dlg.items} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'extend' && <ExtendDialog item={dlg.item} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'move' && <MoveDialog items={dlg.items} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'reassign' && <ReassignDialog items={dlg.items} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'why' && (
        <WhyDrawer
          item={dlg.item}
          onClose={() => setDlg(null)}
          onAction={can.edit ? (next) => setDlg(next) : undefined}
        />
      )}
    </>
  );
  return { actions, readOnlyActions, dialogs, canEdit: can.edit };
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

const CLOSE_OPTIONS: { value: DeadlineStatus; label: string; help: string }[] = [
  { value: 'done', label: 'Done', help: 'The action was taken. Recurring fees create their next cycle.' },
  { value: 'not_needed', label: 'Not needed', help: 'No action is required, for example the case was abandoned on purpose.' },
  { value: 'transferred', label: 'Transferred', help: 'Handled elsewhere, for example by another firm or owner.' },
  { value: 'missed', label: 'Missed', help: 'The date passed without action. Check grace periods and restoration options.' },
  { value: 'cancelled', label: 'Cancelled', help: 'The deadline no longer applies.' },
];

function CloseDialog({ items: itemsIn, onClose, onDone }: { items: DeadlineRec[]; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const items = useLiveRecords('deadlines', itemsIn);
  const [status, setStatus] = useState<DeadlineStatus>('done');
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState(today());
  const [busy, setBusy] = useState(false);
  const needsReason = status !== 'done';
  const submit = async (): Promise<void> => {
    if (needsReason && reason.trim() === '') {
      toast.error('Give a reason so the history stays clear.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ closed: number; results: { id: string; error?: string }[] }>('deadlines/close', {
        ids: items.map((d) => d.id),
        status,
        reason,
        closed_on: when,
      });
      const failed = r.results.filter((x) => x.error !== undefined);
      if (failed.length) toast.error(`${failed.length} could not be closed: ${failed[0]?.error ?? ''}`);
      if (r.closed) toast.success(`Closed ${r.closed} deadline${r.closed === 1 ? '' : 's'}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={items.length === 1 ? `Close: ${items[0]?.title ?? ''}` : `Close ${items.length} deadlines`}
      description="Deadlines are never deleted. The status and reason stay in the history."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Close {items.length === 1 ? 'deadline' : `${items.length} deadlines`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          {CLOSE_OPTIONS.map((o) => (
            <label key={o.value} className={cn('flex cursor-pointer items-start gap-2.5 border px-3 py-2', status === o.value ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]')}>
              <input type="radio" name="close-status" className="mt-1 accent-[var(--agent-app-accent)]" checked={status === o.value} onChange={() => setStatus(o.value)} />
              <span>
                <span className="text-[13px] font-medium">{o.label}</span>
                <span className="block text-xs text-[var(--agent-app-muted)]">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label={needsReason ? 'Reason' : 'Note (optional)'} required={needsReason}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needsReason ? 'Why is this closing without action?' : 'What was done'} />
        </Field>
        <Field label="Closed on">
          <input type="date" className="h-9 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 text-sm" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

interface ExtPreview {
  from: string;
  to: string;
  label: string;
  steps: string[];
}

function ExtendDialog({ item: itemIn, onClose, onDone }: { item: DeadlineRec; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const item = useLiveRecords('deadlines', useMemo(() => [itemIn], [itemIn]))[0] ?? itemIn;
  const [tiers, setTiers] = useState<{ months: number; label: string }[] | null>(null);
  const [level, setLevel] = useState(Math.max(1, item.extension_level + 1));
  const [preview, setPreview] = useState<ExtPreview | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (lv: number): Promise<void> => {
    setErr('');
    try {
      setPreview(await op<ExtPreview>('deadlines/extend', { id: item.id, level: lv, preview: true }));
    } catch (e) {
      setPreview(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    let cancelled = false;
    op<{ extensions: { months: number; label: string }[]; extension_level: number }>('deadlines/explain', { id: item.id })
      .then((r) => {
        if (cancelled) return;
        setTiers(r.extensions ?? []);
        const first = Math.max(1, (r.extension_level ?? 0) + 1);
        setLevel(first);
        if ((r.extensions ?? []).length >= first) void load(first);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setTiers([]);
          setErr(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.updated]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<ExtPreview>('deadlines/extend', { id: item.id, level });
      toast.success(`Extended to ${fmtDate(r.to)}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const available = (tiers ?? []).map((t, i) => ({ ...t, level: i + 1 })).filter((t) => t.level > item.extension_level);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Extend: ${item.title}`}
      description={`Currently due ${fmtDate(item.due_date)}${d10(item.final_date) ? `, final date ${fmtDate(item.final_date)}` : ''}.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={preview === null}>
            Extend
          </Button>
        </>
      }
    >
      {tiers === null ? (
        <p className="text-sm text-[var(--agent-app-muted)]">Loading extension options...</p>
      ) : available.length === 0 ? (
        <Notice tone="warn">{err || 'No further extensions are available for this deadline.'}</Notice>
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label="Extension"
            value={String(level)}
            options={available.map((t) => ({ value: String(t.level), label: t.label }))}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLevel(v);
              void load(v);
            }}
          />
          {preview !== null && (
            <div className="border border-[var(--agent-app-border)] px-3 py-2 text-[13px]">
              <div>
                Due date moves from <b>{fmtDate(preview.from)}</b> to <b>{fmtDate(preview.to)}</b>.
              </div>
              {preview.steps.map((s2) => (
                <div key={s2} className="mt-1 text-xs text-[var(--agent-app-muted)]">
                  {s2}
                </div>
              ))}
              <div className="mt-2 text-xs text-[var(--agent-app-muted)]">File the extension request and pay the fee at the office as well.</div>
            </div>
          )}
          {err !== '' && <Notice tone="bad">{err}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

interface MovePreview {
  moves: { id: string; title: string; from: string; to: string; final: string; past_final: boolean }[];
}

function MoveDialog({ items: itemsIn, onClose, onDone }: { items: DeadlineRec[]; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const items = useLiveRecords('deadlines', itemsIn);
  const [mode, setMode] = useState<'days' | 'date'>(items.length === 1 ? 'date' : 'days');
  const [days, setDays] = useState(7);
  const [date, setDate] = useState(d10(items[0]?.due_date ?? ''));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const payload = (): Record<string, unknown> => ({ ids: items.map((d) => d.id), ...(mode === 'days' ? { days } : { date }), reason });
  const doPreview = async (): Promise<void> => {
    try {
      setPreview(await op<MovePreview>('deadlines/move', { ...payload(), preview: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const submit = async (): Promise<void> => {
    if (reason.trim() === '') {
      toast.error('Give a reason for moving the date.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<MovePreview>('deadlines/move', payload());
      toast.success(`Moved ${r.moves.length} deadline${r.moves.length === 1 ? '' : 's'}; the new dates are locked.`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={items.length === 1 ? `Move: ${items[0]?.title ?? ''}` : `Move ${items.length} deadlines`}
      description="Moved dates are locked so recalculation never overrides them. Use this for dates the office itself changed or for internal planning."
      className="w-[min(92vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => void doPreview()}>
            Preview
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Move
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant={mode === 'days' ? 'primary' : 'outline'} onClick={() => setMode('days')}>
            By days
          </Button>
          <Button size="sm" variant={mode === 'date' ? 'primary' : 'outline'} onClick={() => setMode('date')}>
            To a date
          </Button>
        </div>
        {mode === 'days' ? (
          <Field label="Days (negative moves earlier)">
            <input type="number" className="h-9 w-32 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </Field>
        ) : (
          <Field label="New due date">
            <input type="date" className="h-9 w-44 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        <Field label="Reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: office corrected the notification date" />
        </Field>
        {preview !== null && (
          <div className="max-h-48 overflow-y-auto border border-[var(--agent-app-border)] text-[13px]">
            {preview.moves.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-1.5 last:border-0">
                <span className="truncate">{m.title}</span>
                <span className={cn('shrink-0 tabular-nums', m.past_final && 'text-red-600')}>
                  {fmtShort(m.from)} → {fmtShort(m.to)}
                  {m.past_final ? ' (after final date)' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ReassignDialog({ items: itemsIn, onClose, onDone }: { items: DeadlineRec[]; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const items = useLiveRecords('deadlines', itemsIn);
  const { users } = useApp();
  const [assignee, setAssignee] = useState(items.length === 1 ? (items[0]?.assignee ?? '') : '');
  const [busy, setBusy] = useState(false);
  const people = users.filter((u) => u.role !== 'inventor' && u.role !== 'viewer');
  const submit = async (): Promise<void> => {
    setBusy(true);
    const r = await opToast<{ updated: number }>('deadlines/reassign', { ids: items.map((d) => d.id), assignee }, 'Reassigned');
    setBusy(false);
    if (r !== null) {
      onDone();
      onClose();
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={items.length === 1 ? 'Reassign deadline' : `Reassign ${items.length} deadlines`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <Select
        label="Assign to"
        value={assignee}
        placeholder="Nobody"
        options={people.map((u) => ({ value: u.id, label: `${u.name || u.email}` }))}
        onChange={(e) => setAssignee(e.target.value)}
      />
    </Dialog>
  );
}

interface Explain {
  id: string;
  title: string;
  due_date: string;
  target_date: string;
  final_date: string;
  grace_end: string;
  source: string;
  rule_code: string;
  citation: string;
  locked: boolean;
  steps: string[];
}

export function WhyDrawer({
  item: itemIn,
  onClose,
  onAction,
}: {
  item: DeadlineRec;
  onClose: () => void;
  onAction?: ((next: Dlg) => void) | undefined;
}): React.JSX.Element {
  const { userName } = useApp();
  // Follows the deadline live: a date moved by a colleague or an agent while
  // the drawer is open shows here, with a fresh explanation.
  const item = useLiveRecords('deadlines', useMemo(() => [itemIn], [itemIn]))[0] ?? itemIn;
  const steps = item.calculation?.steps ?? [];
  const [loaded, setLoaded] = useState<Explain | null>(null);
  useEffect(() => {
    let cancelled = false;
    op<Explain>('deadlines/explain', { id: item.id })
      .then((r) => {
        if (!cancelled) setLoaded(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id, item.updated]);
  const s = loaded?.steps ?? steps;
  const open = item.status === 'open';
  return (
    <Drawer open onClose={onClose} title="Why this date?" width={520}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {item.ref !== '' && <Ref>{item.ref}</Ref>}
            {item.jurisdiction !== '' && <JurChip code={item.jurisdiction} />}
            <Tag>{KIND_LABEL[item.kind]}</Tag>
            {item.category !== '' && <Tag>{CATEGORY_LABEL[item.category]}</Tag>}
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug">{item.title}</h3>
          <p className="mt-1 text-xs text-[var(--agent-app-muted)]">{KIND_HELP[item.kind]}</p>
        </div>
        <div className="grid grid-cols-3 border border-[var(--agent-app-border)]">
          {[
            ['Target', item.target_date],
            ['Due', item.due_date],
            ['Final', item.final_date || item.grace_end],
          ].map(([label, v]) => (
            <div key={label} className="border-r border-[var(--agent-app-border)] px-3 py-2 last:border-r-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{label === 'Final' && !item.final_date && item.grace_end ? 'Grace ends' : label}</div>
              <div className="mt-0.5 font-mono text-[13px]">{d10(v ?? '') ? fmtDate(v ?? '') : '-'}</div>
            </div>
          ))}
        </div>
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">How it was calculated</h4>
          {s.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">Entered by hand{item.source === 'manual' ? '' : ` (${SOURCE_LABEL[item.source] ?? item.source})`}. No calculation steps are recorded.</p>
          ) : (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed marker:font-mono marker:text-[var(--agent-app-muted)]">
              {s.map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ol>
          )}
        </div>
        {(item.citation !== '' || item.rule_code !== '') && (
          <div className="border-t border-[var(--agent-app-border)] pt-3 text-xs text-[var(--agent-app-muted)]">
            {item.citation !== '' && <div>Legal basis: {item.citation}</div>}
            {item.rule_code !== '' && <div className="mt-0.5 font-mono">Rule {item.rule_code}</div>}
            {item.locked && (
              <div className="mt-1 flex items-center gap-1">
                <Lock size={11} aria-hidden /> Locked: recalculation will not move this date.
              </div>
            )}
          </div>
        )}
        {item.notes !== '' && <Notice>{item.notes}</Notice>}
        {!open && (
          <div className="border border-[var(--agent-app-border)] px-3 py-2 text-[13px]">
            <b>{DEADLINE_STATUS_LABEL[item.status]}</b>
            {item.closed_at ? ` on ${fmtDate(item.closed_at)}` : ''}
            {item.closed_by ? ` by ${userName(item.closed_by)}` : ''}
            {item.close_reason !== '' && <div className="mt-1 text-[var(--agent-app-muted)]">{item.close_reason}</div>}
          </div>
        )}
        {open && onAction !== undefined && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'close', items: [item] })}>
              Close with a reason
            </Button>
            {(item.kind === 'extendable' || item.kind === 'designated') && (
              <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'extend', item })}>
                Extend
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'move', items: [item] })}>
              Move date
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'reassign', items: [item] })}>
              Reassign
            </Button>
          </div>
        )}
        {subjectLink(item) !== '' && (
          <a className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline" href={subjectLink(item)} onClick={onClose}>
            Open the record →
          </a>
        )}
      </div>
    </Drawer>
  );
}
