import { useCallback, useEffect, useMemo, useState } from 'react'
import { History, Send } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { formatDate, relativeTime } from '@/lib/format'
import type { Activity, RecordType } from '@/types'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { TimelineIcon, isSystemActivity } from '@/components/record/timeline-meta'
import { Pill } from '@/components/common/Pill'

const FILTERS: { id: string; label: string; types: string }[] = [
  { id: 'all', label: 'All', types: '' },
  { id: 'emails', label: 'Emails', types: 'email' },
  { id: 'notes', label: 'Notes', types: 'note_created,note' },
  { id: 'tasks', label: 'Tasks', types: 'task_created,task_completed' },
  { id: 'meetings', label: 'Meetings', types: 'call,meeting' },
  { id: 'changes', label: 'Changes', types: 'created,field_change,stage_change,list_added' },
]

const COMPOSER_KINDS = [
  { id: 'note', label: 'Note' },
  { id: 'call', label: 'Call' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'email', label: 'Email (log only)' },
]

interface TimelinePanelProps {
  recordType: RecordType
  recordId: number
  nonce: number
  onLogged: () => void
}

/** Activity tab (F4.2/§6.4): composer on top, day-grouped timeline below. */
export function TimelinePanel({ recordType, recordId, nonce, onLogged }: TimelinePanelProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  // Composer state
  const [kind, setKind] = useState('note')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (requestedPage: number, append: boolean) => {
      const types = FILTERS.find((candidate) => candidate.id === filter)?.types || ''
      try {
        const result = await api.timeline.get(recordType, recordId, types, requestedPage, 30)
        setActivities((current) => (append ? [...current, ...result.items] : result.items))
        setTotal(result.total)
        setPage(requestedPage)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not load timeline')
      } finally {
        setLoading(false)
      }
    },
    [recordType, recordId, filter]
  )

  useEffect(() => {
    setLoading(true)
    load(1, false)
  }, [load, nonce])

  const submit = async () => {
    if (!body.trim()) return
    setSaving(true)
    try {
      if (kind === 'note') {
        await api.notes.create({ record_type: recordType, record_id: recordId, content: body.trim() })
      } else {
        await api.timeline.logActivity({ record_type: recordType, record_id: recordId, type: kind, body: body.trim() })
      }
      setBody('')
      toast.success(kind === 'note' ? 'Note added' : 'Activity logged')
      onLogged()
      load(1, false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  // Group by day, newest first
  const groups = useMemo(() => {
    const map = new Map<string, Activity[]>()
    for (const activity of activities) {
      const day = (activity.occurredAt || '').slice(0, 10) || 'unknown'
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(activity)
    }
    return Array.from(map.entries())
  }, [activities])

  return (
    <div className="mx-auto max-w-2xl">
      {/* Composer */}
      <div className="rounded-lg border border-border bg-card p-3">
        <Textarea
          placeholder={kind === 'note' ? 'Leave a note… (markdown supported)' : 'What happened?'}
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
          }}
          className="border-0 p-1 shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex items-center gap-2">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-7 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPOSER_KINDS.map((composerKind) => (
                <SelectItem key={composerKind.id} value={composerKind.id}>
                  {composerKind.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">⌘↵ to save</span>
          <Button size="sm" className="ml-auto" onClick={submit} disabled={!body.trim()} loading={saving}>
            <Send /> Save
          </Button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((candidate) => (
          <button
            key={candidate.id}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
              filter === candidate.id
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            onClick={() => setFilter(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={History}
          compact
          title="No activity yet"
          description="Notes, emails, tasks, and stage changes will show up here automatically."
        />
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map(([day, dayActivities]) => (
            <div key={day}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {formatDate(day)}
              </div>
              <div className="space-y-1 border-l border-border pl-4">
                {dayActivities.map((activity) =>
                  isSystemActivity(activity.type) ? (
                    <SystemEntry key={activity.id} activity={activity} />
                  ) : (
                    <ContentEntry key={activity.id} activity={activity} />
                  )
                )}
              </div>
            </div>
          ))}
          {activities.length < total ? (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => load(page + 1, true)}>
                Load older activity
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** Compact gray one-liner for system-generated changes. */
function SystemEntry({ activity }: { activity: Activity }) {
  const stageTo = activity.extra?.to as string | undefined
  const stageColor = activity.extra?.toColor as string | undefined
  return (
    <div className="relative flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
      <span className="absolute -left-[21.5px] flex h-4 w-4 items-center justify-center rounded-full bg-background">
        <TimelineIcon type={activity.type} />
      </span>
      <span className="min-w-0 truncate">
        {activity.type === 'stage_change' && stageTo ? (
          <>
            Moved to <Pill label={stageTo} color={stageColor || '#8b8b94'} className="mx-0.5" />
          </>
        ) : (
          activity.title
        )}
        {activity.actor ? <span className="text-muted-foreground/70"> · {activity.actor}</span> : null}
      </span>
      <span className="ml-auto shrink-0 text-[11px]">{relativeTime(activity.occurredAt)}</span>
    </div>
  )
}

/** Card treatment for human content: notes, emails, calls, meetings. */
function ContentEntry({ activity }: { activity: Activity }) {
  return (
    <div className="relative my-1.5 rounded-md border border-border bg-card p-3">
      <span className="absolute -left-[27.5px] top-3.5 flex h-4 w-4 items-center justify-center rounded-full bg-background">
        <TimelineIcon type={activity.type} />
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium">{activity.title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(activity.occurredAt)}</span>
      </div>
      {activity.body ? <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{activity.body}</p> : null}
      {activity.actor ? <div className="mt-1.5 text-[11px] text-muted-foreground/70">{activity.actor}</div> : null}
    </div>
  )
}
