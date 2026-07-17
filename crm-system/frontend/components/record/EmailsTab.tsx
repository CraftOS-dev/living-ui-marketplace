import { useCallback, useEffect, useState } from 'react'
import { Mail, PencilLine, Send } from 'lucide-react'
import { toast } from 'sonner'

import { relativeTime } from '@/lib/format'
import type { EmailLog, RecordRow, RecordType } from '@/types'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface EmailsTabProps {
  recordType: RecordType
  recordId: number
  record: RecordRow
  onCompose: () => void
  nonce: number
}

export function EmailsTab({ recordType, recordId, record, onCompose, nonce }: EmailsTabProps) {
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState(false)

  const load = useCallback(() => {
    api.email
      .logs(recordType, recordId)
      .then((result) => setLogs(result.items))
      .catch(() => toast.error('Could not load emails'))
      .finally(() => setLoading(false))
  }, [recordType, recordId])

  useEffect(() => {
    load()
  }, [load, nonce])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCompose}>
          <Send /> Compose email
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
          <PencilLine /> Log an email
        </Button>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          icon={Mail}
          compact
          title="No emails on this record"
          description="Send via SMTP or paste a thread to log it on the timeline."
        />
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{log.subject || '(no subject)'}</span>
                <Badge variant={log.status === 'sent' ? 'secondary' : log.status === 'failed' ? 'destructive' : 'outline'}>
                  {log.status === 'logged' ? 'logged' : log.status}
                </Badge>
                <span className="ml-auto text-[11px] text-muted-foreground">{relativeTime(log.sentAt)}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {log.direction === 'outbound' ? `To ${log.to || '—'}` : `Logged${log.to ? ` · ${log.to}` : ''}`}
              </div>
              {log.body ? <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted-foreground">{log.body}</p> : null}
              {log.error && log.status !== 'sent' ? <p className="mt-1 text-[11px] text-destructive">{log.error}</p> : null}
            </div>
          ))}
        </div>
      )}

      <LogEmailDialog
        open={logOpen}
        setOpen={setLogOpen}
        recordType={recordType}
        recordId={recordId}
        defaultTo={record.emails?.[0] || ''}
        onLogged={load}
      />
    </div>
  )
}

/** F6.2 — paste/summarize a thread onto the timeline. */
function LogEmailDialog({
  open,
  setOpen,
  recordType,
  recordId,
  defaultTo,
  onLogged,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  recordType: RecordType
  recordId: number
  defaultTo: string
  onLogged: () => void
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [to, setTo] = useState(defaultTo)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setSubject('')
      setBody('')
      setTo(defaultTo)
    }
  }, [open, defaultTo])

  const save = async () => {
    setSaving(true)
    try {
      await api.email.logManual({
        subject,
        body,
        to,
        record_type: recordType,
        record_id: recordId,
      })
      toast.success('Email logged to the timeline')
      setOpen(false)
      onLogged()
      window.dispatchEvent(new CustomEvent('crm:data-changed', { detail: { email: true } }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not log email')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log an email</DialogTitle>
          <DialogDescription>Paste a sent/received email so the timeline stays complete — nothing is sent.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          <Input placeholder="To / from" value={to} onChange={(event) => setTo(event.target.value)} />
          <Input placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          <Textarea placeholder="Paste the email content…" rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!body.trim() && !subject.trim()}>
            Log email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
