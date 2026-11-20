/**
 * One checklist task as a row: the round check, the title (and details),
 * who it is about or who does it, the due label. Used on the lifecycle
 * home, the task list, the board, the welcome page and the profile tab.
 */
import { FileText } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { download } from '../../lib/api.ts';
import { t } from '../../lib/i18n.ts';
import { DecisionRow } from '../decision.tsx';
import { Tag } from '../ui.tsx';
import { DueLabel, LANE_ICON, TaskCheck } from './bits.tsx';
import type { Task } from './types.ts';

/** `leaves`: the list shows open tasks only, so marking one done plays the done animation and folds the row away. */
export function TaskRow({ task, today, show = 'person', compact, className, leaves }: { task: Task; today?: string | undefined; show?: 'person' | 'lane' | 'none' | undefined; compact?: boolean | undefined; className?: string | undefined; leaves?: boolean | undefined }): React.JSX.Element {
  const Icon = LANE_ICON[task.assignee_kind];
  const closed = task.status !== 'open';
  const sub =
    show === 'person'
      ? [task.employee_name, task.checklist_name].filter((x) => x !== '').join(' · ')
      : show === 'lane'
        ? task.assignee_label
        : '';
  const cls = cn('flex min-w-0 items-start gap-3 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0', className);
  const body = (
    <>
      <span className="pt-px">
        <TaskCheck task={task} leaves={leaves} />
      </span>
      <span className="min-w-0 flex-1">
        <a href={`#/lifecycle/checklists/${task.checklist}`} className={cn('hr-link hr-focus hr-wrap block rounded-[3px] text-[13px] font-medium leading-5 pointer-coarse:-my-2.5 pointer-coarse:py-2.5', closed && 'text-[var(--hr-muted)] line-through decoration-[var(--hr-line-2)]')}>
          {task.title}
        </a>
        {task.description !== '' && !closed && compact !== true && <span className="hr-wrap block text-[12px] leading-[18px] text-[var(--hr-muted)]">{task.description}</span>}
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--hr-muted)]">
          {show !== 'none' && (
            <span className="inline-flex min-w-0 items-center gap-1">
              {show === 'lane' && <Icon size={12} aria-hidden className="shrink-0" />}
              <span className="truncate">{sub}</span>
            </span>
          )}
          {task.kind === 'document' && <Tag tone={task.document !== null ? 'good' : 'faint'}>{task.document !== null ? t('lifecycle.file_in') : t('lifecycle.needs_file')}</Tag>}
          {task.kind === 'signature' && <Tag tone="faint">{t('lifecycle.signature')}</Tag>}
          {task.assignee_kind === 'agent' && <Tag tone="agent">{t('ui.agent_short')}</Tag>}
          {task.document !== null && task.document.has_file && (
            <button type="button" onClick={() => void download('documents.file', { document: task.document?.id ?? '' }, 'open').catch(() => undefined)} className="hr-link hr-focus inline-flex cursor-pointer items-center gap-1 rounded-[3px] text-[var(--hr-ink-2)] hover:text-[var(--hr-ink)]">
              <FileText size={12} aria-hidden />
              {t('lifecycle.open_file')}
            </button>
          )}
        </span>
        {closed && task.note !== '' && <span className="hr-wrap mt-1 block whitespace-pre-wrap border-l-2 border-[var(--hr-line-2)] pl-2 text-[12px] leading-[18px] text-[var(--hr-ink-2)]">{task.note}</span>}
      </span>
      <span className="shrink-0 pt-0.5">
        <DueLabel task={task} today={today} />
      </span>
    </>
  );
  return leaves === true ? (
    <DecisionRow id={task.id} className={cls}>
      {body}
    </DecisionRow>
  ) : (
    <li className={cls}>{body}</li>
  );
}
