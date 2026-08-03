import { useState, useEffect, useCallback } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, Note } from '../types'
import { Pin, Plus, Pencil, Trash2, Search } from 'lucide-react'
import { Modal, Input, Textarea, Button } from './ui'
import { toast } from 'react-toastify'

interface NotesWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

export function NotesWidget({ controller, navigate }: NotesWidgetProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', content: '' })
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    return controller.getNotes()
      .then(setNotes)
      .catch(() => {})
  }, [controller])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  function openAdd() {
    setEditing(null)
    setForm({ title: '', content: '' })
    setModalOpen(true)
  }

  function openEdit(n: Note) {
    setEditing(n)
    setForm({ title: n.title, content: n.content })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error('Title is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await controller.updateNote(editing.id, form)
        toast.success('Note updated')
      } else {
        await controller.createNote({ title: form.title })
        toast.success('Note created')
      }
      setModalOpen(false)
      await load()
    } catch {
      toast.error(editing ? 'Failed to update note' : 'Failed to create note')
    } finally {
      setSaving(false)
    }
  }

  const deleteNote = async (id: number) => {
    try {
      await controller.deleteNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      toast.success('Note deleted')
    } catch {
      toast.error('Failed to delete note')
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  const modal = (
    <Modal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      title={editing ? 'Edit Note' : 'New Note'}
      footer={
        <>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save' : 'Create'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Title"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Shopping list"
        />
        {editing && (
          <Textarea
            label="Content"
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            rows={5}
          />
        )}
      </div>
    </Modal>
  )

  const q = search.trim().toLowerCase()
  const filtered = notes.filter(n => {
    if (!q) return true
    return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  })
  const sorted = [...filtered].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ position: 'relative', marginBottom: 'var(--space-2)' }}>
        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search notes…"
          style={{ paddingLeft: 24, height: 'var(--input-height-sm)', fontSize: 'var(--font-size-xs)' }}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-2)' }}>
            {search ? 'No matching notes' : 'No notes yet'}
          </div>
        ) : sorted.map(note => {
          const preview = note.content ? note.content.slice(0, 60) : ''
          return (
            <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', padding: 'var(--space-1) 0' }}>
              {note.pinned && <Pin size={11} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 'var(--font-weight-medium)' as any,
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {note.title}
                </div>
                {preview && (
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {preview}
                  </div>
                )}
              </div>
              <button
                onClick={() => openEdit(note)}
                title="Edit note"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => deleteNote(note.id)}
                title="Delete note"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 'var(--space-2)' }}>
        <button
          onClick={() => navigate('notes')}
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-primary)',
            background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Open notes →
        </button>
        <button
          onClick={openAdd}
          title="Quick add note"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', display: 'flex', padding: 0 }}
        >
          <Plus size={16} />
        </button>
      </div>
      {modal}
    </div>
  )
}
