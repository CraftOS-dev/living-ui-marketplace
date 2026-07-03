import { useState, useEffect, useRef } from 'react'
import type { AppController } from '../AppController'
import type { Note } from '../types'
import { Button, Input, Textarea, EmptyState } from './ui'
import { FileText, Pin, Plus, Trash2, Search } from 'lucide-react'
import { toast } from 'react-toastify'

interface NotesFullProps {
  controller: AppController
}

export function NotesFull({ controller }: NotesFullProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selected, setSelected] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [titleVal, setTitleVal] = useState('')
  const [contentVal, setContentVal] = useState('')
  const [search, setSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef<() => void>(() => {})

  const load = () => {
    controller.getNotes().then(ns => {
      setNotes(ns)
      if (ns.length > 0 && !selected) {
        selectNote(ns[0])
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [controller])

  function selectNote(note: Note) {
    setSelected(note)
    setTitleVal(note.title)
    setContentVal(note.content)
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  const persistSave = async (id: number, title: string, content: string) => {
    setSaving(true)
    try {
      const updated = await controller.updateNote(id, { title, content })
      setNotes(prev => prev.map(n => n.id === id ? updated : n))
      setSelected(updated)
    } catch {
      toast.error('Auto-save failed')
    } finally {
      setSaving(false)
    }
  }

  saveRef.current = () => {
    if (selected) persistSave(selected.id, titleVal, contentVal)
  }

  const scheduleAutosave = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => saveRef.current(), 500)
  }

  const handleTitleChange = (v: string) => {
    setTitleVal(v)
    scheduleAutosave()
  }

  const handleContentChange = (v: string) => {
    setContentVal(v)
    scheduleAutosave()
  }

  const createNote = async () => {
    try {
      const n = await controller.createNote({ title: 'Untitled', content: '' })
      setNotes(prev => [n, ...prev])
      selectNote(n)
    } catch {
      toast.error('Failed to create note')
    }
  }

  const deleteNote = async (id: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    try {
      await controller.deleteNote(id)
      const remaining = notes.filter(n => n.id !== id)
      setNotes(remaining)
      if (selected?.id === id) {
        if (remaining.length > 0) selectNote(remaining[0])
        else { setSelected(null); setTitleVal(''); setContentVal('') }
      }
    } catch {
      toast.error('Failed to delete note')
    }
  }

  const togglePin = async (note: Note) => {
    try {
      const updated = await controller.updateNote(note.id, { pinned: !note.pinned })
      setNotes(prev => prev.map(n => n.id === note.id ? updated : n))
      if (selected?.id === note.id) setSelected(updated)
    } catch {
      toast.error('Failed to toggle pin')
    }
  }

  const sortedNotes = [...notes]
    .filter(n => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 0 }}>
      {/* Sidebar */}
      <div style={{
        width: 220, flexShrink: 0,
        borderRight: '1px solid var(--border-primary)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Button variant="primary" size="sm" fullWidth icon={<Plus size={14} />} onClick={createNote}>
            New Note
          </Button>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search notes…"
              style={{ paddingLeft: 30 }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>
          ) : sortedNotes.length === 0 ? (
            <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>
              {search ? 'No matching notes' : 'No notes yet'}
            </div>
          ) : sortedNotes.map(n => (
            <div
              key={n.id}
              onClick={() => selectNote(n)}
              style={{
                padding: 'var(--space-3)',
                borderBottom: '1px solid var(--border-primary)',
                cursor: 'pointer',
                backgroundColor: selected?.id === n.id ? 'var(--color-primary-light)' : 'transparent',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 2 }}>
                {n.pinned && <Pin size={10} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />}
                <span style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--font-weight-medium)' as any,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: selected?.id === n.id ? 'var(--color-primary)' : 'var(--text-primary)',
                }}>
                  {n.title || 'Untitled'}
                </span>
              </div>
              {n.content && (
                <div style={{
                  fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {n.content.slice(0, 50)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <EmptyState icon={<FileText size={32} />} message="Select a note or create a new one" />
        ) : (
          <>
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid var(--border-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ flex: 1, maxWidth: 400 }}>
                <Input
                  value={titleVal}
                  onChange={e => handleTitleChange(e.target.value)}
                  style={{ fontWeight: 'var(--font-weight-semibold)' as any, border: 'none', background: 'transparent', fontSize: 'var(--font-size-base)' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                {saving && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Saving…</span>}
                <button
                  onClick={() => togglePin(selected)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 'var(--space-1)', color: selected.pinned ? 'var(--color-primary)' : 'var(--text-muted)' }}
                  title={selected.pinned ? 'Unpin' : 'Pin'}
                >
                  <Pin size={16} />
                </button>
                <button
                  onClick={() => deleteNote(selected.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 'var(--space-1)', color: 'var(--text-muted)' }}
                  title="Delete note"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, padding: 'var(--space-4)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Textarea
                value={contentVal}
                onChange={e => handleContentChange(e.target.value)}
                placeholder="Start writing…"
                style={{ flex: 1, resize: 'none', height: '100%', fontFamily: 'var(--font-sans)', lineHeight: 'var(--line-height-relaxed)', border: 'none', background: 'transparent' }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
