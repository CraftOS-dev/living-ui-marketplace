import { useEffect, useState } from 'react'
import { CheckSquare } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/api'
import type { RecordType } from '@/types'
import { todayIso } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TaskQuickAddProps {
  open: boolean
  defaults?: { recordType?: RecordType; recordId?: number; recordName?: string }
  onClose: () => void
}

/** `t` from anywhere (F5.1): fast task capture with optional record link. */
export function TaskQuickAdd({ open, defaults, onClose }: TaskQuickAddProps) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setTitle('')
      setDueDate(todayIso())
      setError('')
    }
  }, [open])

  const submit = async () => {
    if (!title.trim()) {
      setError('What needs doing?')
      return
    }
    setSubmitting(true)
    try {
      await api.tasks.create({
        title: title.trim(),
        due_date: dueDate || '',
        ...(defaults?.recordType && defaults?.recordId
          ? { record_type: defaults.recordType, record_id: defaults.recordId }
          : {}),
      })
      toast.success('Task created')
      window.dispatchEvent(new CustomEvent('crm:data-changed', { detail: { tasks: true } }))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create task')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-primary" />
            New task
            {defaults?.recordName ? (
              <span className="text-[13px] font-normal text-muted-foreground">on {defaults.recordName}</span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Task</Label>
            <Input
              id="task-title"
              autoFocus
              placeholder="Follow up with…"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                if (error) setError('')
              }}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
            {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-due">Due date</Label>
            <Input id="task-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
