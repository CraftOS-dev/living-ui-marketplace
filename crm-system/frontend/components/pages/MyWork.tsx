import { useCallback, useEffect, useState } from 'react'
import { CheckSquare, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { dueLabel } from '@/lib/format'
import type { MyWork as MyWorkPayload, Task } from '@/types'
import { api } from '@/api'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { useUiActions } from '@/components/MainView'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { BriefAvatar } from '@/components/common/RecordAvatar'

const BUCKETS: { key: keyof Pick<MyWorkPayload, 'overdue' | 'today' | 'upcoming' | 'someday'>; label: string; tone?: string }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'text-destructive' },
  { key: 'today', label: 'Today', tone: 'text-primary' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'someday', label: 'No date' },
]

/** My Work (F5.2): overdue / today / upcoming / no-date buckets. */
export function MyWork() {
  const { openNewTask } = useUiActions()
  const [work, setWork] = useState<MyWorkPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    api.tasks
      .myWork()
      .then(setWork)
      .catch(() => toast.error('Could not load tasks'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const onChanged = () => load()
    window.addEventListener('crm:data-changed', onChanged)
    return () => window.removeEventListener('crm:data-changed', onChanged)
  }, [load])

  const toggle = async (task: Task, completed: boolean) => {
    try {
      await api.tasks.update(task.id, { completed })
      if (completed) toast.success('Task completed 🎉')
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update task')
    }
  }

  const remove = async (task: Task) => {
    await api.tasks.remove(task.id)
    toast.success('Task deleted')
    load()
  }

  if (loading || !work) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6 pl-14 md:pl-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  const totalOpen = work.counts.open

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-4 pl-14 md:p-6 md:pl-6">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">My Work</h1>
          <span className="text-[13px] text-muted-foreground">{totalOpen} open</span>
          <Button size="sm" className="ml-auto" onClick={() => openNewTask()}>
            <Plus /> New task
          </Button>
        </div>

        {totalOpen === 0 && work.completed.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="A clean slate"
            description="Capture follow-ups with T from anywhere — they all land here."
            actionLabel="Create a task"
            onAction={() => openNewTask()}
          />
        ) : (
          <>
            {BUCKETS.map((bucket) => {
              const tasks = work[bucket.key]
              if (tasks.length === 0) return null
              return (
                <section key={bucket.key}>
                  <h2 className={cn('label-caps mb-2', bucket.tone)}>
                    {bucket.label} <span className="ml-1 tabular-nums">{tasks.length}</span>
                  </h2>
                  <div className="space-y-1">
                    {tasks.map((task) => (
                      <WorkRow key={task.id} task={task} onToggle={toggle} onDelete={remove} />
                    ))}
                  </div>
                </section>
              )
            })}

            {work.completed.length > 0 ? (
              <section>
                <h2 className="label-caps mb-2 text-muted-foreground">Recently completed</h2>
                <div className="space-y-1">
                  {work.completed.map((task) => (
                    <WorkRow key={task.id} task={task} onToggle={toggle} onDelete={remove} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function WorkRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task
  onToggle: (task: Task, completed: boolean) => void
  onDelete: (task: Task) => void
}) {
  const due = dueLabel(task.dueDate)
  return (
    <div className="group flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2">
      <Checkbox
        checked={task.completed}
        onCheckedChange={(checked) => onToggle(task, checked === true)}
        aria-label={task.title}
      />
      <div className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px]', task.completed && 'text-muted-foreground line-through')}>
          {task.title}
        </span>
        {task.description ? <span className="block truncate text-[11px] text-muted-foreground">{task.description}</span> : null}
      </div>
      {task.record ? (
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => navigateTo(recordPath(task.record!.recordType, task.record!.id))}
        >
          <BriefAvatar brief={task.record} size="xs" />
          <span className="max-w-28 truncate">{task.record.name}</span>
        </button>
      ) : null}
      {task.dueDate ? (
        <span
          className={cn(
            'shrink-0 text-[11px] font-medium tabular-nums',
            due.tone === 'overdue' && !task.completed ? 'text-destructive' : due.tone === 'today' ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          {due.label}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        onClick={() => onDelete(task)}
        aria-label="Delete task"
      >
        <Trash2 />
      </Button>
    </div>
  )
}
