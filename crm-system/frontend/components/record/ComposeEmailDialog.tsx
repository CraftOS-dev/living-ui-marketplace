import { useEffect, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import type { EmailTemplate, RecordRow, RecordType } from '@/types'
import { api } from '@/api'
import { navigateTo } from '@/hooks/useHashRoute'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const TONES = ['professional', 'friendly', 'concise', 'warm', 'direct'] as const

interface ComposeEmailDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
  record: RecordRow
  recordType: RecordType
  onSent: () => void
}

/** SMTP composer (F6.1) with on-demand AI drafting + tone controls (F9.2). */
export function ComposeEmailDialog({ open, setOpen, record, recordType, onSent }: ComposeEmailDialogProps) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [tone, setTone] = useState<(typeof TONES)[number]>('professional')
  const [instruction, setInstruction] = useState('')
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    setTo(record.emails?.[0] || '')
    api.email.templates().then(setTemplates).catch(() => setTemplates([]))
    api.ai.status().then((status) => setAiConfigured(status.configured)).catch(() => setAiConfigured(false))
  }, [open, record])

  const applyTemplate = async (templateId: string) => {
    const template = templates.find((candidate) => candidate.id === Number(templateId))
    if (!template) return
    // Server renders {{variables}} at send time; show raw here with a hint
    setSubject(template.subject)
    setBody(template.body)
  }

  const draftWithAi = async () => {
    setDrafting(true)
    try {
      const result = await api.ai.emailDraft({
        record_type: recordType,
        record_id: record.id,
        instruction: instruction || 'Write a helpful follow-up email.',
        tone,
        current_draft: body,
        subject,
      })
      if (!result.configured) {
        toast.info(result.message || 'No LLM provider configured in CraftBot.')
        setAiConfigured(false)
      } else if (result.ok) {
        if (result.subject) setSubject(result.subject)
        setBody(result.body || '')
        toast.success('Draft ready — review before sending')
      } else {
        toast.error(result.error || 'Draft failed')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  const send = async () => {
    setSending(true)
    try {
      const result = await api.email.send({
        to,
        subject,
        body,
        record_type: recordType,
        record_id: record.id,
        ...(recordType === 'person' ? { person_id: record.id } : {}),
      })
      if (result.ok) {
        toast.success(`Email sent to ${to}`)
        setOpen(false)
        setSubject('')
        setBody('')
        onSent()
      } else if (result.notConfigured) {
        toast.error('SMTP is not configured yet', {
          description: 'Add your SMTP server in Settings → Email to send for real.',
          action: { label: 'Settings', onClick: () => navigateTo('settings') },
        })
      } else {
        toast.error(result.error || 'Send failed')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compose email</DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Label className="w-14 shrink-0 text-right text-xs text-muted-foreground">To</Label>
            <Input type="email" placeholder="recipient@company.com" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-14 shrink-0 text-right text-xs text-muted-foreground">Subject</Label>
            <Input placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          {templates.length > 0 ? (
            <div className="flex items-center gap-2">
              <Label className="w-14 shrink-0 text-right text-xs text-muted-foreground">Template</Label>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-7">
                  <SelectValue placeholder="Start from a template… ({{variables}} fill at send)" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Textarea
            placeholder="Write your email…"
            rows={9}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />

          {/* AI drafting row — hidden entirely when unconfigured (no dead sparkles, F9.6) */}
          {aiConfigured ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <Input
                placeholder={body ? 'How should AI refine this draft?' : 'What should this email say?'}
                className="h-7 min-w-32 flex-1"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && draftWithAi()}
              />
              <Select value={tone} onValueChange={(value) => setTone(value as (typeof TONES)[number])}>
                <SelectTrigger className="h-7 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {candidate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="secondary" onClick={draftWithAi} loading={drafting}>
                {body ? 'Refine' : 'Draft'}
              </Button>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={send} loading={sending} disabled={!to || (!subject && !body)}>
            <Send /> Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
