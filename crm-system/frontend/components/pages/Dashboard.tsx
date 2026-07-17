import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckSquare,
  Handshake,
  RefreshCcw,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { formatCompactCurrency, relativeTime } from '@/lib/format'
import type { DashboardPayload, Task } from '@/types'
import { api } from '@/api'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { useUiActions } from '@/components/MainView'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { BriefAvatar } from '@/components/common/RecordAvatar'
import { TimelineIcon } from '@/components/record/timeline-meta'

/** Home dashboard (F8.1) + first-run seeding offer (F10.1) + checklist (F10.3). */
export function Dashboard() {
  const { refreshLists, openAiChat } = useUiActions()
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(() => {
    api.reports
      .dashboard()
      .then(setData)
      .catch(() => toast.error('Could not load dashboard'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const onChanged = () => load()
    window.addEventListener('crm:data-changed', onChanged)
    return () => window.removeEventListener('crm:data-changed', onChanged)
  }, [load])

  const seedDemo = async () => {
    setSeeding(true)
    try {
      await api.dataio.seedDemo()
      toast.success('Demo workspace ready — explore the pipeline!')
      refreshLists()
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Seeding failed')
    } finally {
      setSeeding(false)
    }
  }

  const completeTask = async (task: Task) => {
    try {
      await api.tasks.update(task.id, { completed: true })
      toast.success('Task completed 🎉')
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not complete task')
    }
  }

  const dismissChecklist = async () => {
    try {
      await api.state.update({ checklistDismissed: true })
      load()
    } catch {
      /* non-fatal */
    }
  }

  if (loading || !data) {
    return (
      <div className="grid gap-3 p-6 pl-14 md:grid-cols-2 md:pl-6 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-44 w-full" />
        ))}
      </div>
    )
  }

  const isEmpty = data.counts.people === 0 && data.counts.companies === 0 && data.counts.deals === 0

  // First run is never an empty table (F10.1)
  if (isEmpty) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Users className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Welcome to your CRM</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Start with a rich demo workspace — 58 people, 20 companies, deals across a sales and a fundraising
            pipeline, design partners, community leads, notes, tasks, and history. Or bring your own data.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <Button onClick={seedDemo} loading={seeding} className="sm:col-span-1">
              <Sparkles /> Load demo data
            </Button>
            <Button variant="outline" onClick={() => navigateTo('people')}>
              <Upload /> Import a CSV
            </Button>
            <Button variant="outline" onClick={() => navigateTo('people')}>
              Start clean
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">You can switch between demo and clean anytime in Settings.</p>
        </div>
      </div>
    )
  }

  const checklistSteps = [
    { done: data.checklist.steps.hasRecords, label: 'Add your first records', action: () => navigateTo('people') },
    { done: data.checklist.steps.hasDealMoved, label: 'Drag a deal to a new stage', action: () => navigateTo(data.pipeline.list ? `lists/${data.pipeline.list.id}` : 'deals') },
    { done: data.checklist.steps.hasNote, label: 'Write a note on a record', action: () => navigateTo('people') },
    { done: data.checklist.steps.hasTask, label: 'Create a task (press T)', action: () => {} },
  ]
  const checklistDone = checklistSteps.filter((step) => step.done).length
  const wonDelta = data.wonThisMonth.value - data.wonLastMonth.value
  const maxStageValue = Math.max(1, ...data.pipeline.stages.map((entry) => entry.value))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 pl-14 md:p-6 md:pl-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">Home</h1>
          <Button variant="outline" size="sm" className="ml-auto" onClick={openAiChat}>
            <Sparkles /> Ask your CRM
          </Button>
        </div>

        {/* Getting-started checklist (dismissible) */}
        {!data.checklist.dismissed && checklistDone < 4 ? (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3.5">
              <span className="text-[13px] font-medium">Getting started · {checklistDone}/4</span>
              {checklistSteps.map((step) => (
                <button
                  key={step.label}
                  className={cn(
                    'flex items-center gap-1.5 text-[13px]',
                    step.done ? 'text-muted-foreground line-through' : 'text-foreground hover:underline'
                  )}
                  onClick={step.action}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px]',
                      step.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                    )}
                  >
                    {step.done ? '✓' : ''}
                  </span>
                  {step.label}
                </button>
              ))}
              <button className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={dismissChecklist} aria-label="Dismiss checklist">
                <X className="h-3.5 w-3.5" />
              </button>
            </CardContent>
          </Card>
        ) : null}

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Open pipeline"
            value={formatCompactCurrency(data.pipeline.totalValue)}
            hint={`${data.pipeline.openCount} open deals`}
            icon={Handshake}
            onClick={() => (data.pipeline.list ? navigateTo(`lists/${data.pipeline.list.id}`) : navigateTo('deals'))}
          />
          <StatTile
            label="Won this month"
            value={formatCompactCurrency(data.wonThisMonth.value)}
            hint={`${data.wonThisMonth.count} deals`}
            icon={wonDelta >= 0 ? ArrowUpRight : ArrowDownRight}
            trend={data.wonLastMonth.value > 0 ? `${wonDelta >= 0 ? '+' : ''}${formatCompactCurrency(wonDelta)} vs last` : undefined}
            trendUp={wonDelta >= 0}
            onClick={() => navigateTo('reports')}
          />
          <StatTile
            label="People"
            value={String(data.counts.people)}
            hint={`${data.counts.companies} companies`}
            icon={Users}
            onClick={() => navigateTo('people')}
          />
          <StatTile
            label="Tasks due"
            value={String(data.tasksDueToday.length + data.tasksOverdue.length)}
            hint={`${data.tasksOverdue.length} overdue`}
            icon={CheckSquare}
            onClick={() => navigateTo('my-work')}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Pipeline by stage — horizontal bars, stage entity colors */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                Pipeline by stage
                {data.pipeline.list ? (
                  <button className="text-xs font-normal text-primary hover:underline" onClick={() => navigateTo(`lists/${data.pipeline.list!.id}`)}>
                    Open board
                  </button>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.pipeline.stages
                  .filter((entry) => !entry.stage.isLost)
                  .map((entry) => (
                    <div key={entry.stage.id} className="group flex min-w-0 items-center gap-2" title={`${entry.stage.name}: ${entry.count} deals · ${formatCompactCurrency(entry.value)}`}>
                      <span className="w-16 shrink-0 truncate text-[12px] text-muted-foreground sm:w-24">{entry.stage.name}</span>
                      <div className="h-4 min-w-0 flex-1 rounded-sm bg-muted/60">
                        <div
                          className="h-4 max-w-full rounded-sm transition-all"
                          style={{
                            width: `${Math.max(entry.value > 0 ? 2 : 0, (entry.value / maxStageValue) * 100)}%`,
                            backgroundColor: entry.stage.color,
                          }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right text-[12px] tabular-nums sm:w-14">{formatCompactCurrency(entry.value)}</span>
                      <span className="hidden w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground sm:inline">{entry.count}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Tasks due today / overdue */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                Today's tasks
                <button className="text-xs font-normal text-primary hover:underline" onClick={() => navigateTo('my-work')}>
                  My Work
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {[...data.tasksOverdue, ...data.tasksDueToday].slice(0, 6).map((task) => (
                <div key={task.id} className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={false} onCheckedChange={() => completeTask(task)} aria-label={task.title} />
                  <span className="min-w-0 truncate">{task.title}</span>
                  {task.record ? (
                    <button className="ml-auto shrink-0" onClick={() => navigateTo(recordPath(task.record!.recordType, task.record!.id))}>
                      <BriefAvatar brief={task.record} size="xs" />
                    </button>
                  ) : null}
                </div>
              ))}
              {data.tasksDueToday.length + data.tasksOverdue.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Nothing due — press T to add a task.</p>
              ) : null}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.recentActivity.slice(0, 8).map((activity) => (
                <button
                  key={activity.id}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] hover:bg-accent/60"
                  onClick={() => activity.record && navigateTo(recordPath(activity.record.recordType, activity.record.id))}
                >
                  <TimelineIcon type={activity.type} />
                  {activity.record ? <BriefAvatar brief={activity.record} size="xs" /> : null}
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{activity.record?.name}</span>
                    <span className="text-muted-foreground"> · {activity.title}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(activity.occurredAt)}</span>
                </button>
              ))}
              {data.recentActivity.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Activity from notes, emails, and stage moves shows up here.</p>
              ) : null}
            </CardContent>
          </Card>

          {/* Reconnect */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5">
                <RefreshCcw className="h-3.5 w-3.5 text-muted-foreground" /> Reconnect
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.reconnect.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Everyone's been touched in the last 30 days. 🔥</p>
              ) : (
                data.reconnect.map((brief) => (
                  <button
                    key={brief.id}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent/60"
                    onClick={() => navigateTo(recordPath(brief.recordType, brief.id))}
                  >
                    <BriefAvatar brief={brief} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{brief.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {brief.lastInteractionAt ? `Last touch ${relativeTime(brief.lastInteractionAt)}` : 'Never contacted'}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  trendUp,
  onClick,
}: {
  label: string
  value: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  trend?: string
  trendUp?: boolean
  onClick?: () => void
}) {
  return (
    <Card className={cn(onClick && 'cursor-pointer transition-colors hover:bg-accent/40')} onClick={onClick}>
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between">
          <span className="label-caps">{label}</span>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="mt-1.5 text-xl font-semibold tabular-nums">{value}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {hint}
          {trend ? (
            <span className={cn('font-medium', trendUp ? 'text-emerald-600 dark:text-emerald-500' : 'text-destructive')}>{trend}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
