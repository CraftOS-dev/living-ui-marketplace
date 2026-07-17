import { useEffect, useState } from 'react'
import { Maximize2 } from 'lucide-react'

import type { Activity, RecordRow, RecordType } from '@/types'
import { api } from '@/api'
import { formatCurrency, formatDateShort, relativeTime } from '@/lib/format'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { RecordAvatar, BriefAvatar } from '@/components/common/RecordAvatar'
import { Pill, DealStatusPill } from '@/components/common/Pill'
import { TimelineIcon } from '@/components/record/timeline-meta'

interface RecordPeekProps {
  recordType: RecordType
  recordId: number | null
  onClose: () => void
}

/** Side-panel peek (F4.1): stay in the table context, expand to full page. */
export function RecordPeek({ recordType, recordId, onClose }: RecordPeekProps) {
  const [record, setRecord] = useState<RecordRow | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!recordId) return
    setLoading(true)
    setRecord(null)
    Promise.all([api.records.get(recordType, recordId), api.timeline.get(recordType, recordId, '', 1, 8)])
      .then(([detail, timeline]) => {
        setRecord(detail.record)
        setActivities(timeline.items)
      })
      .catch(() => setRecord(null))
      .finally(() => setLoading(false))
  }, [recordType, recordId])

  const facts: { label: string; value: string }[] = []
  if (record) {
    if (recordType === 'person') {
      if (record.jobTitle) facts.push({ label: 'Title', value: record.jobTitle })
      if (record.company?.name) facts.push({ label: 'Company', value: record.company.name })
      if (record.emails?.[0]) facts.push({ label: 'Email', value: record.emails[0] })
      if (record.location) facts.push({ label: 'Location', value: record.location })
      facts.push({ label: 'Last contacted', value: relativeTime(record.lastInteractionAt) })
    } else if (recordType === 'company') {
      if (record.domain) facts.push({ label: 'Domain', value: record.domain })
      if (record.industry) facts.push({ label: 'Industry', value: record.industry })
      if (record.size) facts.push({ label: 'Size', value: record.size })
      if (record.location) facts.push({ label: 'Location', value: record.location })
    } else {
      facts.push({ label: 'Value', value: formatCurrency(record.value, record.currency) })
      if (record.company?.name) facts.push({ label: 'Company', value: record.company.name })
      if (record.owner) facts.push({ label: 'Owner', value: record.owner })
      if (record.expectedCloseDate) facts.push({ label: 'Expected close', value: formatDateShort(record.expectedCloseDate) })
    }
  }

  return (
    <Sheet open={recordId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0">
        {loading || !record ? (
          <div className="space-y-3 p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <Skeleton className="h-5 w-40" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="border-b p-4 pr-12">
              <div className="flex items-center gap-3">
                <RecordAvatar name={record.name} color={record.avatarColor} recordType={recordType} domain={record.domain} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{record.name}</SheetTitle>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {recordType === 'deal' && record.status ? <DealStatusPill status={record.status} /> : null}
                    {record.memberships?.slice(0, 2).map((membership) =>
                      membership.stage ? (
                        <Pill key={membership.entry.id} label={`${membership.list.name}: ${membership.stage.name}`} color={membership.stage.color} />
                      ) : null
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  onClose()
                  navigateTo(recordPath(recordType, record.id))
                }}
              >
                <Maximize2 /> Open full record
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <p className="label-caps mb-2">Details</p>
              <div className="space-y-1.5">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex gap-2 text-[13px]">
                    <span className="w-28 shrink-0 text-muted-foreground">{fact.label}</span>
                    <span className="min-w-0 truncate">{fact.value}</span>
                  </div>
                ))}
              </div>

              {record.related && (record.related.people.length > 0 || record.related.deals.length > 0 || record.related.companies.length > 0) ? (
                <>
                  <Separator className="my-4" />
                  <p className="label-caps mb-2">Related</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...record.related.companies, ...record.related.people, ...record.related.deals].slice(0, 8).map((brief) => (
                      <button
                        key={`${brief.recordType}-${brief.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
                        onClick={() => {
                          onClose()
                          navigateTo(recordPath(brief.recordType, brief.id))
                        }}
                      >
                        <BriefAvatar brief={brief} size="xs" />
                        {brief.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <Separator className="my-4" />
              <p className="label-caps mb-2">Recent activity</p>
              <div className="space-y-2.5">
                {activities.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No activity yet.</p>
                ) : (
                  activities.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-2 text-[13px]">
                      <TimelineIcon type={activity.type} className="mt-0.5" />
                      <div className="min-w-0">
                        <span className="font-medium">{activity.title}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{relativeTime(activity.occurredAt)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
