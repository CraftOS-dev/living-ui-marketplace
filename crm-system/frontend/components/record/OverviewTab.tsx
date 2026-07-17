import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'

import { formatCompactCurrency, formatDateShort, relativeTime } from '@/lib/format'
import type { Activity, Note, RecordRow, RecordType } from '@/types'
import { api } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TimelineIcon } from '@/components/record/timeline-meta'

interface OverviewTabProps {
  record: RecordRow
  recordType: RecordType
  nonce: number
  onOpenActivity: () => void
}

/** Overview: highlight tiles (F4.5) + recent digest + pinned notes. */
export function OverviewTab({ record, recordType, nonce, onOpenActivity }: OverviewTabProps) {
  const [recent, setRecent] = useState<Activity[]>([])
  const [pinnedNotes, setPinnedNotes] = useState<Note[]>([])
  const [openTaskCount, setOpenTaskCount] = useState(0)

  useEffect(() => {
    api.timeline.get(recordType, record.id, '', 1, 6).then((result) => setRecent(result.items)).catch(() => {})
    api.notes.list(recordType, record.id).then((notes) => setPinnedNotes(notes.filter((note) => note.pinned).slice(0, 3))).catch(() => {})
    api.tasks.list({ recordType, recordId: record.id }).then((tasks) => setOpenTaskCount(tasks.filter((task) => !task.completed).length)).catch(() => {})
  }, [recordType, record.id, nonce])

  const highlights: { label: string; value: string }[] = []
  if (recordType === 'deal') {
    highlights.push({ label: 'Value', value: formatCompactCurrency(record.value, record.currency) })
    const stage = record.memberships?.find((membership) => membership.stage)?.stage
    if (stage) highlights.push({ label: 'Stage', value: stage.name })
    highlights.push({ label: 'Status', value: (record.status || 'open').toUpperCase() })
    if (record.expectedCloseDate) highlights.push({ label: 'Expected close', value: formatDateShort(record.expectedCloseDate) })
    if (record.owner) highlights.push({ label: 'Owner', value: record.owner })
  } else if (recordType === 'person') {
    if (record.jobTitle) highlights.push({ label: 'Title', value: record.jobTitle })
    if (record.company?.name) highlights.push({ label: 'Company', value: record.company.name })
    highlights.push({ label: 'Last contacted', value: relativeTime(record.lastInteractionAt) })
    highlights.push({ label: 'Deals', value: String(record.related?.deals.length || 0) })
  } else {
    if (record.industry) highlights.push({ label: 'Industry', value: record.industry })
    if (record.size) highlights.push({ label: 'Size', value: record.size })
    highlights.push({ label: 'People', value: String(record.related?.people.length || 0) })
    highlights.push({ label: 'Deals', value: String(record.related?.deals.length || 0) })
  }
  highlights.push({ label: 'Open tasks', value: String(openTaskCount) })

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Highlight tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {highlights.slice(0, 6).map((highlight) => (
          <Card key={highlight.label}>
            <CardContent className="p-3">
              <div className="label-caps">{highlight.label}</div>
              <div className="mt-1 truncate text-sm font-semibold tabular-nums">{highlight.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {record.description ? (
        <div>
          <p className="label-caps mb-1.5">About</p>
          <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{record.description}</p>
        </div>
      ) : null}

      {pinnedNotes.length > 0 ? (
        <div>
          <p className="label-caps mb-2">Pinned notes</p>
          <div className="space-y-2">
            {pinnedNotes.map((note) => (
              <div key={note.id} className="rounded-md border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Pin className="h-3 w-3 text-primary" />
                  {note.title || 'Note'}
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted-foreground">{note.content}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="label-caps">Recent activity</p>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={onOpenActivity}>
            View all
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing yet — leave a note or log a call from the Activity tab.</p>
        ) : (
          <div className="space-y-1.5">
            {recent.map((activity) => (
              <div key={activity.id} className="flex items-center gap-2 text-[13px]">
                <TimelineIcon type={activity.type} />
                <span className="min-w-0 truncate">{activity.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(activity.occurredAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
