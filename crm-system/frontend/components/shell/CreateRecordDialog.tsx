import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/api'
import type { RecordBrief, RecordType } from '@/types'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { BriefAvatar } from '@/components/common/RecordAvatar'

const TITLES: Record<RecordType, string> = {
  person: 'New person',
  company: 'New company',
  deal: 'New deal',
}

const personSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  job_title: z.string().optional(),
  company_name: z.string().optional(),
})

const companySchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  domain: z.string().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
})

const dealSchema = z.object({
  name: z.string().min(1, 'Deal name is required'),
  value: z.coerce.number().min(0, 'Must be ≥ 0').optional(),
  expected_close_date: z.string().optional(),
  description: z.string().optional(),
})

interface CreateRecordDialogProps {
  recordType: RecordType
  defaults?: Record<string, unknown>
  onClose: () => void
  onCreated?: (id: number) => void
}

export function CreateRecordDialog({ recordType, defaults, onClose, onCreated }: CreateRecordDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  const [duplicates, setDuplicates] = useState<RecordBrief[]>([])

  const schema = recordType === 'person' ? personSchema : recordType === 'company' ? companySchema : dealSchema
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema as never),
    defaultValues: {
      first_name: '', last_name: '', email: '', job_title: '', company_name: '',
      name: '', domain: '', industry: '', location: '',
      value: 0, expected_close_date: '', description: '',
      ...(defaults || {}),
    },
  })

  // Inline duplicate warning (F1.4): check email/domain as the user types
  const watchedEmail = form.watch('email') as string | undefined
  const watchedDomain = form.watch('domain') as string | undefined
  useEffect(() => {
    const email = (watchedEmail || '').trim()
    const domain = (watchedDomain || '').trim()
    if ((recordType === 'person' && !email.includes('@')) || (recordType === 'company' && !domain)) {
      setDuplicates([])
      return
    }
    if (recordType === 'deal') return
    const timer = window.setTimeout(() => {
      api.records
        .checkDuplicates(recordType, recordType === 'person' ? { email } : { domain })
        .then((result) => setDuplicates(result.duplicates))
        .catch(() => setDuplicates([]))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [watchedEmail, watchedDomain, recordType])

  const onSubmit = async (values: Record<string, unknown>) => {
    setSubmitting(true)
    try {
      let body: Record<string, unknown> = {}
      if (recordType === 'person') {
        body = {
          first_name: values.first_name,
          last_name: values.last_name || '',
          emails: values.email ? [values.email] : [],
          job_title: values.job_title || '',
        }
        const companyName = String(values.company_name || '').trim()
        if (companyName) {
          // Find-or-create the company by name, then link
          const existing = await api.search(companyName, 3)
          const match = existing.companies.find((c) => c.name.toLowerCase() === companyName.toLowerCase())
          const company = match ?? (await api.records.create('company', { name: companyName }))
          body.company_id = company.id
        }
      } else if (recordType === 'company') {
        body = {
          name: values.name,
          domain: values.domain || '',
          industry: values.industry || '',
          location: values.location || '',
        }
      } else {
        body = {
          name: values.name,
          value: Number(values.value || 0),
          expected_close_date: values.expected_close_date || '',
          description: values.description || '',
          ...(defaults?.list_id ? { list_id: defaults.list_id, stage_id: defaults.stage_id } : {}),
        }
      }
      const created = await api.records.create(recordType, body)
      toast.success(`${created.name} created`, {
        action: { label: 'Open', onClick: () => navigateTo(recordPath(recordType, created.id)) },
      })
      onCreated?.(created.id)
      window.dispatchEvent(new CustomEvent('crm:data-changed', { detail: { recordType } }))
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{TITLES[recordType]}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            {recordType === 'person' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="first_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl><Input autoFocus {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="last_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl><Input {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="ada@company.com" {...(field as object)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="job_title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job title</FormLabel>
                      <FormControl><Input {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="company_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company</FormLabel>
                      <FormControl><Input placeholder="Acme Inc" {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </>
            )}

            {recordType === 'company' && (
              <>
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input autoFocus {...(field as object)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="domain" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Domain</FormLabel>
                      <FormControl><Input placeholder="acme.com" {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="industry" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <FormControl><Input {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="location" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl><Input placeholder="San Francisco, CA" {...(field as object)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            )}

            {recordType === 'deal' && (
              <>
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deal name</FormLabel>
                    <FormControl><Input autoFocus placeholder="Acme — platform pilot" {...(field as object)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="value" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Value (USD)</FormLabel>
                      <FormControl><Input type="number" min={0} step="0.01" {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="expected_close_date" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected close</FormLabel>
                      <FormControl><Input type="date" {...(field as object)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Textarea rows={2} {...(field as object)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            )}

            {duplicates.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/60 p-2.5 text-[13px]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium">Possible duplicate</div>
                  {duplicates.slice(0, 3).map((brief) => (
                    <button
                      key={brief.id}
                      type="button"
                      className="mt-1 flex items-center gap-1.5 text-primary hover:underline"
                      onClick={() => {
                        onClose()
                        navigateTo(recordPath(brief.recordType, brief.id))
                      }}
                    >
                      <BriefAvatar brief={brief} size="xs" />
                      <span className="truncate">Open {brief.name} instead</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
