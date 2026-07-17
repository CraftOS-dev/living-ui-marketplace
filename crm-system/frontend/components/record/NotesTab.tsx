import { useCallback, useEffect, useState } from 'react'
import { Pin, PinOff, SquarePen, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { relativeTime } from '@/lib/format'
import type { Note, RecordType } from '@/types'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'

interface NotesTabProps {
  recordType: RecordType
  recordId: number
  onChanged: () => void
}

export function NotesTab({ recordType, recordId, onChanged }: NotesTabProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    api.notes
      .list(recordType, recordId)
      .then(setNotes)
      .catch(() => toast.error('Could not load notes'))
      .finally(() => setLoading(false))
  }, [recordType, recordId])

  useEffect(() => {
    load()
  }, [load])

  const startEdit = (note: Note) => {
    setEditingId(note.id)
    setTitle(note.title)
    setContent(note.content)
    setComposing(true)
  }

  const save = async () => {
    if (!content.trim() && !title.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        await api.notes.update(editingId, { title, content })
        toast.success('Note updated')
      } else {
        await api.notes.create({ record_type: recordType, record_id: recordId, title, content })
        toast.success('Note added')
      }
      setComposing(false)
      setEditingId(null)
      setTitle('')
      setContent('')
      load()
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  const togglePin = async (note: Note) => {
    await api.notes.update(note.id, { pinned: !note.pinned })
    load()
  }

  const remove = async (note: Note) => {
    await api.notes.remove(note.id)
    toast.success('Note deleted')
    load()
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {composing ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <Input
            placeholder="Title (optional)"
            className="mb-2 border-0 px-1 text-sm font-medium shadow-none focus-visible:ring-0"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            autoFocus
            placeholder={'Write your note…\n\nMarkdown-ish: # headings, **bold**, - lists, - [ ] checkboxes'}
            rows={6}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="border-0 p-1 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setComposing(false)
                setEditingId(null)
                setTitle('')
                setContent('')
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} loading={saving} disabled={!content.trim() && !title.trim()}>
              {editingId ? 'Save changes' : 'Add note'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setComposing(true)}>
          <SquarePen /> New note
        </Button>
      )}

      {notes.length === 0 && !composing ? (
        <EmptyState
          icon={SquarePen}
          compact
          title="No notes yet"
          description="Capture call recaps, research, and context here."
          actionLabel="Write the first note"
          onAction={() => setComposing(true)}
        />
      ) : (
        notes.map((note) => (
          <div key={note.id} className="group rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              {note.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
              <span className="text-[13px] font-medium">{note.title || 'Note'}</span>
              <span className="text-[11px] text-muted-foreground">
                {note.createdBy ? `${note.createdBy} · ` : ''}
                {relativeTime(note.updatedAt)}
                {note.updatedAt !== note.createdAt ? ' (edited)' : ''}
              </span>
              <div className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button variant="ghost" size="icon-sm" onClick={() => togglePin(note)} aria-label={note.pinned ? 'Unpin' : 'Pin'}>
                  {note.pinned ? <PinOff /> : <Pin />}
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => startEdit(note)} aria-label="Edit">
                  <SquarePen />
                </Button>
                <Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => remove(note)} aria-label="Delete">
                  <Trash2 />
                </Button>
              </div>
            </div>
            <MarkdownishBody content={note.content} />
          </div>
        ))
      )}
    </div>
  )
}

/** Light markdown rendering: headings, bold, bullet lists, checkboxes (F4.4). */
function MarkdownishBody({ content }: { content: string }) {
  const lines = (content || '').split('\n')
  return (
    <div className="mt-1.5 space-y-0.5 text-[13px]">
      {lines.map((line, index) => {
        const bolded = line.replace(/\*\*(.+?)\*\*/g, '$1')
        if (line.startsWith('# ')) {
          return (
            <div key={index} className="pt-1 text-sm font-semibold">
              {bolded.slice(2)}
            </div>
          )
        }
        if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
          const checked = line.startsWith('- [x] ')
          return (
            <div key={index} className="flex items-center gap-1.5">
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px] ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                {checked ? '✓' : ''}
              </span>
              <span className={checked ? 'text-muted-foreground line-through' : ''}>{bolded.slice(6)}</span>
            </div>
          )
        }
        if (line.startsWith('- ')) {
          return (
            <div key={index} className="flex gap-1.5">
              <span className="text-muted-foreground">•</span>
              <span>{bolded.slice(2)}</span>
            </div>
          )
        }
        return line.trim() ? (
          <p key={index} className={line === bolded ? '' : 'font-medium'}>
            {bolded}
          </p>
        ) : (
          <div key={index} className="h-1.5" />
        )
      })}
    </div>
  )
}
