/**
 * Lifecycle building blocks on top of components/ui.tsx: task rows with a
 * one-tap check (document tasks take the file), lane labels and icons, a
 * hairline progress bar, due labels, people and member pickers, and the
 * live-read lists every lifecycle page uses.
 */
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AtSign, Check, FileSignature, FileUp, Laptop, Sparkle, User, UserCheck, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op, opForm } from '../../lib/api.ts';
import { relDay, stampDayKey } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { decide, useOutcome } from '../decision.tsx';
import { Skeleton, Toggle, toast } from '../ui.tsx';
import type { PickItem, Tone } from '../ui.tsx';
import type { Lane, Progress, Task } from './types.ts';

/** Collections a lifecycle view reloads on. */
export const TASK_READS = ['tasks', 'checklists', 'documents'];
export const LETTER_READS = ['letters', 'letter_templates', 'documents'];
export const SEPARATION_READS = ['separations', 'approvals', 'checklists', 'tasks', 'employments', 'assets'];
export const ASSET_READS = ['assets'];
export const HANDBOOK_READS = ['handbook', 'handbook_versions', 'handbook_acks'];
export const GRIEVANCE_READS = ['grievances', 'grievance_types'];

export const LANE_ICON: Record<Lane, LucideIcon> = { hr: Users, manager: UserCheck, it: Laptop, employee: User, member: AtSign, agent: Sparkle };
export const LANE_ORDER: Lane[] = ['hr', 'manager', 'it', 'employee', 'member', 'agent'];

export function laneName(lane: Lane): string {
  return t(`lifecycle.lane.${lane}`);
}

export function kindName(kind: string): string {
  return t(`lifecycle.kind.${kind}`);
}

export const SEPARATION_TONE: Record<string, Tone> = { pending: 'warn', approved: 'rh', completed: 'good', rejected: 'bad', withdrawn: 'faint' };
export const LETTER_TONE: Record<string, Tone> = { draft: 'warn', issued: 'good', void: 'faint' };
export const GRIEVANCE_TONE: Record<string, Tone> = { open: 'warn', investigating: 'rh', resolved: 'good', closed: 'faint', withdrawn: 'faint' };
export const ASSET_TONE: Record<string, Tone> = { in_stock: 'good', issued: 'rh', retired: 'faint' };

/** A thin bar and "7 / 17": closed tasks over all tasks; red ink when something is overdue. */
export function ProgressBar({ progress, className, wide }: { progress: Progress; className?: string | undefined; wide?: boolean | undefined }): React.JSX.Element {
  const closed = progress.done + progress.skipped;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} title={t('lifecycle.progress_title', { done: closed, total: progress.total })}>
      <span className={cn('relative h-1 overflow-hidden rounded-full bg-[var(--hr-line)]', wide === true ? 'w-full min-w-[80px] flex-1' : 'w-16')}>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', progress.percent >= 100 ? 'bg-[var(--hr-good)]' : 'bg-[var(--hr-ink)]')} style={{ width: `${Math.min(100, progress.percent)}%` }} />
      </span>
      <span className="hr-mono hr-num shrink-0 text-[12px] text-[var(--hr-ink-2)]">
        {closed}/{progress.total}
      </span>
      {progress.overdue > 0 && <span className="hr-num shrink-0 whitespace-nowrap text-[12px] text-[var(--hr-bad)]">{t('lifecycle.n_overdue', { n: progress.overdue })}</span>}
    </span>
  );
}

/** "due in 3 days", red when past; "Done" with the day when closed. */
export function DueLabel({ task, today }: { task: Task; today?: string | undefined }): React.JSX.Element | null {
  if (task.status !== 'open') return <span className="hr-label">{task.status === 'skipped' ? t('lifecycle.skipped') : t('lifecycle.done_on', { when: relDay(stampDayKey(task.done_at, { entity: task.entity }), today) })}</span>;
  if (task.due === '') return null;
  return <span className={cn('hr-label whitespace-nowrap', task.overdue && '!text-[var(--hr-bad)]')}>{task.overdue ? t('lifecycle.overdue_since', { when: relDay(task.due, today) }) : t('lifecycle.due', { when: relDay(task.due, today) })}</span>;
}

/** Complete a task at once (instant), with a file for document tasks. */
export async function completeTask(task: Task, file?: File | null, note?: string): Promise<boolean> {
  const fields = { status: 'done', done_at: new Date().toISOString() };
  const r = await act(
    [patch(task.id, fields)],
    () => (file ? opForm('tasks.complete', { task: task.id, note: note ?? '' }, { file }) : op('tasks.complete', { task: task.id, note: note ?? undefined })),
    TASK_READS,
  );
  if (r !== null) toast.success(t('lifecycle.task_done', { title: task.title }), { label: t('lifecycle.undo'), run: () => void reopenTask(task) });
  return r !== null;
}

export async function reopenTask(task: Task): Promise<void> {
  await act([patch(task.id, { status: 'open', done_at: '' })], () => op('tasks.reopen', { task: task.id }), TASK_READS);
}

/**
 * The round check of a task: one tap completes it; a document task opens the
 * file chooser first; a done task can be reopened by whoever may act on it.
 */
export function TaskCheck({ task, size = 20, leaves }: { task: Task; size?: number | undefined; leaves?: boolean | undefined }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  // In a list of open tasks a done task leaves: the check fills, "Done" shows, the row folds (components/decision.tsx).
  const marked = useOutcome(task.id) === 'done';
  const done = task.status !== 'open' || marked;
  const finish = async (file?: File | null): Promise<void> => {
    if (leaves === true) {
      decide(task.id, 'done', () => completeTask(task, file));
      return;
    }
    setBusy(true);
    await completeTask(task, file);
    setBusy(false);
  };
  const needsFile = task.kind === 'document' && task.document === null;
  const run = async (): Promise<void> => {
    if (!task.can.act || busy) return;
    if (done) {
      setBusy(true);
      await reopenTask(task);
      setBusy(false);
      return;
    }
    if (needsFile) {
      input.current?.click();
      return;
    }
    await finish();
  };
  const label = done ? t('lifecycle.reopen_task', { title: task.title }) : needsFile ? t('lifecycle.upload_for', { title: task.title }) : t('lifecycle.complete_task', { title: task.title });
  return (
    <>
      <button
        type="button"
        disabled={!task.can.act}
        aria-label={label}
        title={task.can.act ? label : t('lifecycle.not_yours', { who: task.assignee_label })}
        onClick={() => void run()}
        className={cn('hr-focus group -m-2.5 flex shrink-0 items-center justify-center rounded-full p-2.5', task.can.act ? 'cursor-pointer' : 'cursor-default')}
      >
        <span
          aria-hidden
          className={cn(
            'flex items-center justify-center rounded-full border transition-colors',
            done ? (task.status === 'skipped' ? 'border-[var(--hr-line-2)] bg-[var(--hr-sunk)] text-[var(--hr-muted)]' : 'border-[var(--hr-good)] bg-[var(--hr-good)] text-[var(--hr-page)]') : 'border-[var(--hr-line-2)] bg-[var(--hr-raised)] text-[var(--hr-muted)]',
            task.can.act ? 'group-hover:border-[var(--hr-ink)] group-hover:bg-[var(--hr-hover)]' : 'opacity-60',
            busy && 'opacity-50',
          )}
          style={{ width: size, height: size }}
        >
          {done ? <Check size={size * 0.6} strokeWidth={2.6} aria-hidden /> : needsFile ? <FileUp size={size * 0.55} strokeWidth={2} aria-hidden /> : task.kind === 'signature' ? <FileSignature size={size * 0.55} strokeWidth={2} aria-hidden /> : null}
        </span>
      </button>
      {needsFile && (
        <input
          ref={input}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.txt,.doc,.docx"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (f === null) return;
            void finish(f);
          }}
        />
      )}
    </>
  );
}

/** People the viewer may see (current and starting), as Picker items. */
export function usePeopleItems(entity?: string | undefined): PickItem[] {
  const live = useOp<{ people: { employee: string; employment: string; number: string; name: string; title: string; entity_name: string }[] }>(
    'people.directory',
    { status: 'all', limit: 500, entity: entity !== undefined && entity !== '' ? entity : undefined },
    ['employees', 'employments'],
    { name: 'lifecycle.people' },
  );
  const seen = new Set<string>();
  const out: PickItem[] = [];
  for (const p of live.data?.people ?? []) {
    if (seen.has(p.number)) continue;
    seen.add(p.number);
    out.push({ value: p.number, label: p.name, sub: [p.number, p.title, p.entity_name].filter((x) => x !== '').join(' · '), person: true });
  }
  return out;
}

/** Active members (for a named assignee or an investigator), as Picker items. Needs admin view; empty otherwise. */
export function useMemberItems(enabled: boolean): PickItem[] {
  const live = useOp<{ members: { id: string; name: string; email: string; status: string; role: { name: string } | null }[] }>('members.list', { status: 'active', limit: 500 }, ['members'], { name: 'lifecycle.members', skip: !enabled });
  return (live.data?.members ?? []).map((m) => ({ value: m.id, label: m.name, sub: [m.role?.name ?? '', m.email].filter((x) => x !== '').join(' · '), person: true }));
}

export interface EntityLite {
  id: string;
  name: string;
  country: string;
  currency: string;
}

/** The legal entities the viewer sees. */
export function useEntities(): EntityLite[] {
  const live = useOp<{ entities: EntityLite[] }>('entities.list', {}, ['entities'], { name: 'lifecycle.entities' });
  return live.data?.entities ?? [];
}

/** The legal entities the viewer sees, as Picker items. */
export function useEntityItems(): PickItem[] {
  return useEntities().map((e) => ({ value: e.id, label: e.name, sub: `${e.country} · ${e.currency}` }));
}

/** Scroll pagination: calls onMore when this line comes into view (lists never show a "more" button). */
export function MoreOnScroll({ onMore, active }: { onMore: () => void; active: boolean }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onMore);
  cb.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (el === null || !active) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) cb.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  if (!active) return null;
  return <div ref={ref} aria-hidden className="h-6" />;
}

/** A switch with its words beside it (the whole row toggles it). */
export function LabeledToggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <label className={cn('inline-flex min-w-0 items-center gap-2 text-[13px]', disabled === true ? 'cursor-default opacity-60' : 'cursor-pointer')}>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span className="hr-wrap min-w-0">{label}</span>
    </label>
  );
}

/** Loading rows in the page's own shape (a panel of list rows), instead of a spinner. */
export function SkeletonRows({ rows = 5, bare }: { rows?: number | undefined; bare?: boolean | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col', bare !== true && 'hr-panel')} role="status" aria-label={t('ui.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[var(--hr-hair)] px-3.5 py-3 last:border-b-0">
          <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={i % 2 === 0 ? 'w-3/5' : 'w-2/5'} />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Panel numbers in reading order: call once per panel as it renders ("01", "02", ...), so a hidden panel leaves no gap. */
export function panelNumbers(): () => string {
  let n = 0;
  return () => String(++n).padStart(2, '0');
}
