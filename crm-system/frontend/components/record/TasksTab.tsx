import { useCallback, useEffect, useState } from 'react'
import { CheckSquare, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { dueLabel } from '@/lib/format'
import type { RecordType, Task } from '@/types'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { useUiActions } from '@/components/MainView'

interface TasksTabProps {
  recordType: RecordType
  recordId: number
  recordName: string
  onChanged: () => void
}

export function TasksTab({ recordType, recordId, recordName, onChanged }: TasksTabProps) {
  const { openNewTask } = useUiActions()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    api.tasks
      .list({ recordType, recordId })
      .then(setTasks)
      .catch(() => toast.error('Could not load tasks'))
      .finally(() => setLoading(false))
  }, [recordType, recordId])

  useEffect(() => {
    load()
    const onDataChanged = () => load()
    window.addEventListener('crm:data-changed', onDataChanged)
    return () => window.removeEventListener('crm:data-changed', onDataChanged)
  }, [load])

  const toggle = async (task: Task) => {
    // Optimistic satisfying tick (U-16)
    setTasks((current) => current.map((candidate) => (candidate.id === task.id ? { ...candidate, completed: !task.completed } : candidate)))
    try {
      await api.tasks.update(task.id, { completed: !task.completed })
      if (!task.completed) toast.success('Task completed 🎉')
      load()
      onChanged()
    } catch (error) {
      setTasks((current) => current.map((candidate) => (candidate.id === task.id ? { ...candidate, completed: task.completed } : candidate)))
      toast.error(error instanceof Error ? error.message : 'Could not update task')
    }
  }

  const remove = async (task: Task) => {
    await api.tasks.remove(task.id)
    toast.success('Task deleted')
    load()
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  const open = tasks.filter((task) => !task.completed)
  const done = tasks.filter((task) => task.completed)

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Button variant="outline" size="sm" onClick={() => openNewTask({ recordType, recordId, recordName })}>
        <Plus /> New task
      </Button>

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          compact
          title="No tasks on this record"
          description="Press T anywhere or use the button above."
        />
      ) : (
        <>
          <div className="space-y-1">
            {open.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={toggle} onDelete={remove} />
            ))}
          </div>
          {done.length > 0 ? (
            <>
              <p className="label-caps pt-2">Completed</p>
              <div className="space-y-1">
                {done.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={toggle} onDelete={remove} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: (task: Task) => void; onDelete: (task: Task) => void }) {
  const due = dueLabel(task.dueDate)
  return (
    <div className="group flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2">
      <Checkbox checked={task.completed} onCheckedChange={() => onToggle(task)} aria-label={task.title} />
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', task.completed && 'text-muted-foreground line-through')}>
        {task.title}
      </span>
      {task.dueDate ? (
        <span
          className={cn(
            'shrink-0 text-[11px] font-medium',
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
