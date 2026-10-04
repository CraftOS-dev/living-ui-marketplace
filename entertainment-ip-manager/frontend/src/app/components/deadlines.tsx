/**
 * Deadline building blocks shared by Today, Deadlines and every record page:
 * the row, the grouped list with bulk actions, and the dialogs that close
 * (with a reason), extend (tier preview), move (diff preview), reassign, and
 * explain ("Why this date?", steps in the reader's language).
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarClock, Check, ChevronRight, HelpCircle, Lock, MoreHorizontal, Undo2, UserRound } from 'lucide-react';
import { Button, Dialog, Drawer, DropdownMenu, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { op, opToast } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLiveRecords } from '../lib/live.ts';
import { d10, deadlineSeverity, fmtDate, fmtShort, targetPassed, today, windowLabel, windowOf } from '../lib/format.ts';
import type { Window } from '../lib/format.ts';
import { bi, enumLabel, t, tf, tn } from '../lib/i18n.ts';
import { toneOf } from '../lib/labels.ts';
import { subjectHref } from '../lib/router.ts';
import type { DeadlineRec } from '../lib/records.ts';
import type { Bi, RuleExtension } from '../lib/shapes.ts';
import { Checkbox, Field, GroupHeader, IdentityChip, JurChip, Notice, Pill, Ref, TONE_BAR, Tag } from './ui.tsx';
import { DeleteButton } from './deleteRecord.tsx';

type CloseStatus = 'done' | 'not_needed' | 'transferred' | 'missed' | 'cancelled';

/** Relation fields that can carry a deadline's subject, with the subject type each means. */
const SUBJECT_FIELDS: [keyof DeadlineRec, string][] = [
  ['matter', 'matter'],
  ['agreement', 'agreement'],
  ['work', 'work'],
  ['character', 'character'],
  ['talent', 'talent'],
  ['product', 'product'],
  ['approval', 'approval'],
  ['permission', 'permission'],
  ['committee', 'committee'],
  ['case_ref', 'case'],
  ['registration', 'registration'],
  ['claim', 'claim'],
  ['recordation', 'recordation'],
  ['society_contract', 'society_contract'],
  ['fan_registration', 'fan_registration'],
  ['enrollment', 'enrollment'],
];

/** The record a deadline is about: { type, id } or null. */
export function deadlineSubject(d: DeadlineRec): { type: string; id: string } | null {
  for (const [field, type] of SUBJECT_FIELDS) {
    const v = d[field];
    if (typeof v === 'string' && v !== '') return { type, id: v };
  }
  return null;
}

function subjectLink(d: DeadlineRec): string {
  const s = deadlineSubject(d);
  return s === null ? '' : subjectHref(s.type, s.id);
}

export function kindHelp(kind: string): string {
  return (
    {
      hard: t('Set by law. Missing it can lose the right; it cannot be extended.'),
      extendable: t('Can be extended once or more, usually for a fee.'),
      designated: t('A period the office or the other side set in its letter.'),
      internal: t('Our own working date.'),
      reminder: t('A reminder, not a legal deadline.'),
    }[kind] ?? ''
  );
}

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

export function DeadlineRow({
  d,
  actions,
  canEdit,
  selected,
  onSelect,
  showSubject = true,
}: {
  d: DeadlineRec;
  actions: DeadlineActions;
  canEdit: boolean;
  selected?: boolean | undefined;
  onSelect?: ((v: boolean) => void) | undefined;
  showSubject?: boolean | undefined;
}): React.JSX.Element {
  const { userName } = useApp();
  const sev = deadlineSeverity(d);
  const open = d.status === 'open';
  const target = d10(d.target_date);
  const due = d10(d.due_date);
  const fin = d10(d.final_date);
  const link = subjectLink(d);
  const assignee = userName(d.assignee);
  const menu = canEdit && open;
  const title = tf(d, 'title');

  return (
    <div className={cn('group grid grid-cols-[4px_minmax(0,1fr)_auto] items-stretch border-b border-[var(--agent-app-border)]/70 last:border-0', selected && 'bg-[var(--agent-app-accent)]/5')}>
      <div className={cn(open ? TONE_BAR[sev.tone] : 'bg-transparent')} aria-hidden />
      <div className="flex min-w-0 items-start gap-3 py-2.5 pl-3 pr-2">
        {onSelect !== undefined && open && (
          <div className="pt-0.5">
            <Checkbox checked={selected === true} onChange={onSelect} ariaLabel={t('Select {name}', { name: title })} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showSubject && d.ref !== '' && (
              <a href={link} className="hover:underline">
                <Ref>{d.ref}</Ref>
              </a>
            )}
            {showSubject && d.jurisdiction !== '' && d.jurisdiction !== '*' && <JurChip code={d.jurisdiction} />}
            <button
              type="button"
              className={cn('min-w-0 break-words text-left text-sm font-medium hover:underline', !open && 'text-[var(--agent-app-muted)] line-through decoration-1')}
              onClick={() => actions.onWhy(d)}
            >
              {title}
            </button>
            {open ? <Pill tone={sev.tone}>{sev.label}</Pill> : <Pill tone={toneOf('deadlines.status', d.status)}>{enumLabel('deadlines.status', d.status)}</Pill>}
            {d.locked && (
              <span title={t('Date locked by a person; recalculation will not move it')} className="text-[var(--agent-app-muted)]">
                <Lock size={12} aria-hidden />
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--agent-app-muted)]">
            {showSubject && d.subject_label !== '' && (
              <a href={link} className="min-w-0 truncate hover:underline">
                {d.subject_label}
              </a>
            )}
            <span className="tabular-nums">
              {target !== '' && target !== due && open && (
                <span className={cn(targetPassed(d) && 'font-medium text-amber-700 dark:text-amber-400')}>
                  {targetPassed(d) ? t('Target {date} (passed)', { date: fmtShort(target) }) : t('Target {date}', { date: fmtShort(target) })}
                  {' · '}
                </span>
              )}
              <span className="text-[var(--agent-app-text)]/80">{t('Due {date}', { date: fmtDate(due) })}</span>
              {fin !== '' && fin !== due && <span>{' · '}{t('Final {date}', { date: fmtShort(fin) })}</span>}
              {d10(d.grace_end) !== '' && <span>{' · '}{t('Grace to {date}', { date: fmtShort(d.grace_end) })}</span>}
            </span>
            <Tag title={kindHelp(d.kind)}>{enumLabel('deadlines.kind', d.kind)}</Tag>
            {d.source !== '' && <Tag title={t('Where this date came from')}>{enumLabel('deadlines.source', d.source)}</Tag>}
            {!open && d.close_reason !== '' && <span className="truncate">{d.close_reason}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 pr-3">
        {assignee !== '' ? (
          <IdentityChip name={assignee} size="sm" title={t('Assigned to {name}', { name: assignee })} />
        ) : open ? (
          <span title={t('Nobody assigned')} className="hidden size-5 items-center justify-center rounded-full border border-dashed border-[var(--agent-app-border)] text-[var(--agent-app-muted)] sm:flex">
            <UserRound size={11} aria-hidden />
          </span>
        ) : null}
        {menu && (
          <>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => actions.onDone(d)} title={t('Mark done')}>
              <Check size={13} aria-hidden /> <span className="hidden sm:inline">{t('Done')}</span>
            </Button>
            <DropdownMenu
              align="right"
              trigger={
                <span className="flex size-7 items-center justify-center border border-[var(--agent-app-border)] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30" aria-label={t('More actions')}>
                  <MoreHorizontal size={14} />
                </span>
              }
              items={[
                { label: t('Why this date?'), icon: <HelpCircle size={14} />, onSelect: () => actions.onWhy(d) },
                { label: t('Close with a reason'), icon: <Check size={14} />, onSelect: () => actions.onClose([d]) },
                ...(d.kind === 'extendable' || d.kind === 'designated' ? [{ label: t('Extend'), icon: <CalendarClock size={14} />, onSelect: () => actions.onExtend(d) }] : []),
                { label: t('Move date'), icon: <Undo2 size={14} />, onSelect: () => actions.onMove([d]) },
                { label: t('Reassign'), icon: <UserRound size={14} />, onSelect: () => actions.onReassign([d]) },
              ]}
            />
          </>
        )}
        {!menu && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => actions.onWhy(d)}>
            {t('Details')} <ChevronRight size={13} aria-hidden />
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
  canEdit,
  grouped = true,
  bulk = true,
  showSubject = true,
  empty,
}: {
  deadlines: DeadlineRec[];
  actions: DeadlineActions;
  canEdit: boolean;
  grouped?: boolean | undefined;
  bulk?: boolean | undefined;
  showSubject?: boolean | undefined;
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
    const out = WINDOWS.map((w) => ({ key: w as string, label: windowLabel(w), items: map.get(w) ?? [] })).filter((g) => g.items.length > 0);
    if (closed.length) out.push({ key: 'closed', label: t('Closed'), items: closed });
    return out;
  }, [deadlines, grouped]);

  if (deadlines.length === 0) return <>{empty}</>;

  return (
    <div>
      {bulk && canEdit && selected.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-2">
          <span className="text-[13px] font-medium">{t('{n} selected', { n: selected.length })}</span>
          <Button size="sm" variant="outline" onClick={() => actions.onClose(selected)}>
            {t('Close')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => actions.onReassign(selected)}>
            {t('Reassign')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => actions.onMove(selected)}>
            {t('Move dates')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            {t('Clear')}
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
                  bulk && canEdit && openInGroup.length > 0 ? (
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
                      ariaLabel={t('Select all in {group}', { group: g.label })}
                    />
                  ) : undefined
                }
              />
            )}
            {g.items.map((d) => (
              <DeadlineRow key={d.id} d={d} actions={actions} canEdit={canEdit} selected={sel.has(d.id)} onSelect={bulk && canEdit ? (v) => toggle(d.id, v) : undefined} showSubject={showSubject} />
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

/**
 * Row actions plus the dialogs element. Pass both `actions` and `canEdit` to
 * DeadlineList: people who cannot edit still get "Why this date?".
 *
 *   const dl = useDeadlineActions();
 *   <DeadlineList deadlines={rows} actions={dl.actions} canEdit={dl.canEdit} />
 *   {dl.dialogs}
 */
export function useDeadlineActions(onChanged?: () => void): { actions: DeadlineActions; dialogs: React.JSX.Element; canEdit: boolean } {
  const { can } = useApp();
  const [dlg, setDlg] = useState<Dlg>(null);
  const changed = (): void => onChanged?.();

  const doneNow = async (d: DeadlineRec): Promise<void> => {
    const r = await opToast<{ closed: number; results: { next: { title: string; title_ja: string; due_date: string } | null }[] }>('deadlines/close', {
      ids: [d.id],
      status: 'done',
      reason: '',
    });
    if (r !== null) {
      const next = r.results[0]?.next;
      toast.success(next ? t('Done. Next: {title}, due {date}', { title: tf(next, 'title'), date: fmtDate(next.due_date) }) : t('Marked done'));
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

  const dialogs = (
    <>
      {dlg?.kind === 'close' && <CloseDialog items={dlg.items} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'extend' && <ExtendDialog item={dlg.item} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'move' && <MoveDialog items={dlg.items} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'reassign' && <ReassignDialog items={dlg.items} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === 'why' && <WhyDrawer item={dlg.item} onClose={() => setDlg(null)} onAction={can.edit ? (next) => setDlg(next) : undefined} />}
    </>
  );
  return { actions, dialogs, canEdit: can.edit };
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function closeOptions(): { value: CloseStatus; label: string; help: string }[] {
  return [
    { value: 'done', label: t('Done'), help: t('The action was taken. Recurring items create their next cycle.') },
    { value: 'not_needed', label: t('Not needed'), help: t('No action is required, for example the right was let go on purpose.') },
    { value: 'transferred', label: t('Transferred'), help: t('Handled elsewhere, for example by another firm or owner.') },
    { value: 'missed', label: t('Missed'), help: t('The date passed without action. Check grace periods and restoration options.') },
    { value: 'cancelled', label: t('Cancelled'), help: t('The deadline no longer applies.') },
  ];
}

function CloseDialog({ items: itemsIn, onClose, onDone }: { items: DeadlineRec[]; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const items = useLiveRecords('deadlines', itemsIn);
  const [status, setStatus] = useState<CloseStatus>('done');
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState(today());
  const [busy, setBusy] = useState(false);
  const needsReason = status !== 'done';
  const submit = async (): Promise<void> => {
    if (needsReason && reason.trim() === '') {
      toast.error(t('Give a reason so the history stays clear.'));
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ closed: number; results: { id: string; error?: string; error_ja?: string }[] }>('deadlines/close', {
        ids: items.map((d) => d.id),
        status,
        reason,
        closed_on: when,
      });
      const failed = r.results.filter((x) => x.error !== undefined);
      if (failed.length) toast.error(t('{n} could not be closed: {error}', { n: failed.length, error: bi({ en: failed[0]?.error ?? '', ja: failed[0]?.error_ja ?? '' }) }));
      if (r.closed) toast.success(tn(r.closed, 'Closed {n} deadline', 'Closed {n} deadlines'));
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
      title={items.length === 1 ? t('Close: {title}', { title: tf(items[0], 'title') }) : t('Close {n} deadlines', { n: items.length })}
      description={t('Deadlines are never deleted. The status and reason stay in the history.')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          {closeOptions().map((o) => (
            <label key={o.value} className={cn('flex cursor-pointer items-start gap-2.5 border px-3 py-2', status === o.value ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]')}>
              <input type="radio" name="close-status" className="mt-1 accent-[var(--agent-app-accent)]" checked={status === o.value} onChange={() => setStatus(o.value)} />
              <span>
                <span className="text-[13px] font-medium">{o.label}</span>
                <span className="block text-xs text-[var(--agent-app-muted)]">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label={needsReason ? t('Reason') : t('Note (optional)')} required={needsReason}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needsReason ? t('Why is this closing without action?') : t('What was done')} />
        </Field>
        <Field label={t('Closed on')}>
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
  label_ja: string;
  steps: Bi[];
}

function ExtendDialog({ item: itemIn, onClose, onDone }: { item: DeadlineRec; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const item = useLiveRecords('deadlines', useMemo(() => [itemIn], [itemIn]))[0] ?? itemIn;
  const [tiers, setTiers] = useState<RuleExtension[] | null>(null);
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
    op<{ extensions: RuleExtension[]; extension_level: number }>('deadlines/explain', { id: item.id })
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
      toast.success(t('Extended to {date}', { date: fmtDate(r.to) }));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const available = (tiers ?? []).map((x, i) => ({ ...x, level: i + 1 })).filter((x) => x.level > item.extension_level);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Extend: {title}', { title: tf(item, 'title') })}
      description={d10(item.final_date) ? t('Currently due {due}, final date {final}.', { due: fmtDate(item.due_date), final: fmtDate(item.final_date) }) : t('Currently due {due}.', { due: fmtDate(item.due_date) })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={preview === null}>
            {t('Extend')}
          </Button>
        </>
      }
    >
      {tiers === null ? (
        <p className="text-sm text-[var(--agent-app-muted)]">{t('Loading extension options...')}</p>
      ) : available.length === 0 ? (
        <Notice tone="warn">{err || t('No further extensions are available for this deadline.')}</Notice>
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label={t('Extension')}
            value={String(level)}
            options={available.map((x) => ({ value: String(x.level), label: tf(x, 'label') }))}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLevel(v);
              void load(v);
            }}
          />
          {preview !== null && (
            <div className="border border-[var(--agent-app-border)] px-3 py-2 text-[13px]">
              <div>{t('Due date moves from {from} to {to}.', { from: fmtDate(preview.from), to: fmtDate(preview.to) })}</div>
              {preview.steps.map((s2, i) => (
                <div key={i} className="mt-1 text-xs text-[var(--agent-app-muted)]">
                  {bi(s2)}
                </div>
              ))}
              <div className="mt-2 text-xs text-[var(--agent-app-muted)]">{t('File the extension request and pay any fee as well.')}</div>
            </div>
          )}
          {err !== '' && <Notice tone="bad">{err}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

interface MovePreview {
  moves: { id: string; title: string; title_ja: string; from: string; to: string; final: string; past_final: boolean }[];
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
      toast.error(t('Give a reason for moving the date.'));
      return;
    }
    setBusy(true);
    try {
      const r = await op<MovePreview>('deadlines/move', payload());
      toast.success(tn(r.moves.length, 'Moved {n} deadline; the new date is locked.', 'Moved {n} deadlines; the new dates are locked.'));
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
      title={items.length === 1 ? t('Move: {title}', { title: tf(items[0], 'title') }) : t('Move {n} deadlines', { n: items.length })}
      description={t('Moved dates are locked so recalculation never overrides them. Use this for dates the office itself changed or for internal planning.')}
      className="w-[min(92vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="outline" onClick={() => void doPreview()}>
            {t('Preview')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Move')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant={mode === 'days' ? 'primary' : 'outline'} onClick={() => setMode('days')}>
            {t('By days')}
          </Button>
          <Button size="sm" variant={mode === 'date' ? 'primary' : 'outline'} onClick={() => setMode('date')}>
            {t('To a date')}
          </Button>
        </div>
        {mode === 'days' ? (
          <Field label={t('Days (negative moves earlier)')}>
            <input type="number" className="h-9 w-32 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </Field>
        ) : (
          <Field label={t('New due date')}>
            <input type="date" className="h-9 w-44 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        <Field label={t('Reason')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('For example: the office corrected the notification date')} />
        </Field>
        {preview !== null && (
          <div className="max-h-48 overflow-y-auto border border-[var(--agent-app-border)] text-[13px]">
            {preview.moves.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-1.5 last:border-0">
                <span className="truncate">{tf(m, 'title')}</span>
                <span className={cn('shrink-0 tabular-nums', m.past_final && 'text-red-600')}>
                  {fmtShort(m.from)} {'>'} {fmtShort(m.to)}
                  {m.past_final ? ` ${t('(after final date)')}` : ''}
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
  const internal = new Set(['admin', 'manager', 'rights', 'licensing', 'talent_manager', 'contributor']);
  const people = users.filter((u) => internal.has(u.role));
  const submit = async (): Promise<void> => {
    setBusy(true);
    const r = await opToast<{ updated: number }>('deadlines/reassign', { ids: items.map((d) => d.id), assignee }, t('Reassigned'));
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
      title={items.length === 1 ? t('Reassign deadline') : t('Reassign {n} deadlines', { n: items.length })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <Select label={t('Assign to')} value={assignee} placeholder={t('Nobody')} options={people.map((u) => ({ value: u.id, label: u.name || u.email }))} onChange={(e) => setAssignee(e.target.value)} />
    </Dialog>
  );
}

interface Explain {
  id: string;
  title: string;
  title_ja: string;
  due_date: string;
  target_date: string;
  final_date: string;
  grace_end: string;
  source: string;
  rule_code: string;
  citation: string;
  locked: boolean;
  steps: Bi[];
}

export function WhyDrawer({ item: itemIn, onClose, onAction }: { item: DeadlineRec; onClose: () => void; onAction?: ((next: Dlg) => void) | undefined }): React.JSX.Element {
  const { userName } = useApp();
  // Follows the deadline live: a date moved by a colleague or an agent while
  // the drawer is open shows here, with a fresh explanation.
  const item = useLiveRecords('deadlines', useMemo(() => [itemIn], [itemIn]))[0] ?? itemIn;
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
  const steps: Bi[] = loaded?.steps ?? item.calculation?.steps ?? [];
  const open = item.status === 'open';
  const link = subjectLink(item);
  const dates: [string, string][] = [
    [t('Target'), item.target_date],
    [t('Due'), item.due_date],
    [!item.final_date && item.grace_end ? t('Grace ends') : t('Final'), item.final_date || item.grace_end],
  ];
  return (
    <Drawer open onClose={onClose} title={t('Why this date?')} width={520}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {item.ref !== '' && <Ref>{item.ref}</Ref>}
            {item.jurisdiction !== '' && item.jurisdiction !== '*' && <JurChip code={item.jurisdiction} />}
            <Tag>{enumLabel('deadlines.kind', item.kind)}</Tag>
            {item.category !== '' && <Tag>{enumLabel('deadlines.category', item.category)}</Tag>}
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug">{tf(item, 'title')}</h3>
          {item.subject_label !== '' && <p className="mt-0.5 text-[13px] text-[var(--agent-app-muted)]">{item.subject_label}</p>}
          <p className="mt-1 text-xs text-[var(--agent-app-muted)]">{kindHelp(item.kind)}</p>
        </div>
        <div className="grid grid-cols-3 border border-[var(--agent-app-border)]">
          {dates.map(([label, v]) => (
            <div key={label} className="min-w-0 border-r border-[var(--agent-app-border)] px-3 py-2 last:border-r-0">
              <div className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{label}</div>
              <div className="mt-0.5 text-[13px] tabular-nums">{d10(v) ? fmtDate(v) : '-'}</div>
            </div>
          ))}
        </div>
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('How it was calculated')}</h4>
          {steps.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Entered by hand. No calculation steps are recorded.')}</p>
          ) : (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed marker:font-mono marker:text-[var(--agent-app-muted)]">
              {steps.map((line, i) => (
                <li key={i}>{bi(line)}</li>
              ))}
            </ol>
          )}
        </div>
        {(item.citation !== '' || item.rule_code !== '' || item.locked) && (
          <div className="border-t border-[var(--agent-app-border)] pt-3 text-xs text-[var(--agent-app-muted)]">
            {item.citation !== '' && <div>{t('Legal basis: {citation}', { citation: item.citation })}</div>}
            {item.rule_code !== '' && <div className="mt-0.5 font-mono">{t('Rule {code}', { code: item.rule_code })}</div>}
            {item.locked && (
              <div className="mt-1 flex items-center gap-1">
                <Lock size={11} aria-hidden /> {t('Locked: recalculation will not move this date.')}
              </div>
            )}
          </div>
        )}
        {item.notes !== '' && <Notice>{item.notes}</Notice>}
        {!open && (
          <div className="border border-[var(--agent-app-border)] px-3 py-2 text-[13px]">
            <b>{enumLabel('deadlines.status', item.status)}</b>
            {item.closed_at ? ` ${t('on {date}', { date: fmtDate(item.closed_at) })}` : ''}
            {item.closed_by ? ` ${t('by {name}', { name: userName(item.closed_by) })}` : ''}
            {item.close_reason !== '' && <div className="mt-1 text-[var(--agent-app-muted)]">{item.close_reason}</div>}
          </div>
        )}
        {open && onAction !== undefined && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'close', items: [item] })}>
              {t('Close with a reason')}
            </Button>
            {(item.kind === 'extendable' || item.kind === 'designated') && (
              <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'extend', item })}>
                {t('Extend')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'move', items: [item] })}>
              {t('Move date')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'reassign', items: [item] })}>
              {t('Reassign')}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {link !== '' ? (
            <a className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline" href={link} onClick={onClose}>
              {t('Open the record')}
            </a>
          ) : (
            <span />
          )}
          {/* Admins only (the button hides itself otherwise); closing with a reason is the normal path. */}
          <DeleteButton collection="deadlines" id={item.id} onDeleted={onClose} />
        </div>
      </div>
    </Drawer>
  );
}
