import { useEffect, useState } from 'react'
import { Pin, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import type { RecordRow, RecordType } from '@/types'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'

interface AiSummaryDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
  record: RecordRow
  recordType: RecordType
  onSaved: () => void
}

/** "Summarize this relationship" (F9.1) — explicit, labeled, saveable as a pinned note. */
export function AiSummaryDialog({ open, setOpen, record, recordType, onSaved }: AiSummaryDialogProps) {
  const [summary, setSummary] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.ai.summary(recordType, record.id)
      if (!result.configured) {
        setConfigured(false)
      } else if (result.ok) {
        setConfigured(true)
        setSummary(result.summary || '')
      } else {
        setConfigured(true)
        setError(result.error || 'Summary failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Summary failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setSummary('')
      setConfigured(null)
      generate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const saveAsNote = async () => {
    setSaving(true)
    try {
      await api.notes.create({
        record_type: recordType,
        record_id: record.id,
        title: 'AI summary',
        content: summary,
        pinned: true,
      })
      toast.success('Saved as a pinned note')
      setOpen(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI summary — {record.name}
          </DialogTitle>
          <DialogDescription>Generated on demand from this record's fields, notes, and timeline.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : configured === false ? (
          <EmptyState
            icon={Sparkles}
            compact
            title="No LLM provider configured"
            description="Connect an LLM provider in CraftBot settings to generate relationship summaries."
          />
        ) : error ? (
          <div className="py-2 text-[13px] text-destructive">{error}</div>
        ) : (
          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-[13px]">
            {summary}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          {configured && !loading && !error && summary ? (
            <>
              <Button variant="outline" onClick={generate}>
                Regenerate
              </Button>
              <Button onClick={saveAsNote} loading={saving}>
                <Pin /> Save as pinned note
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
