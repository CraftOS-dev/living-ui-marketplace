import { useState, useEffect, useCallback } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, Contact } from '../types'
import { Plus, Pencil, Trash2, Search, Star } from 'lucide-react'
import { Modal, Input, Textarea, Button, Avatar } from './ui'
import { toast } from 'react-toastify'

interface ContactsWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

const EMPTY_FORM = { name: '', email: '', phone: '', notes: '' }

export function ContactsWidget({ controller, navigate }: ContactsWidgetProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    return controller.getContacts()
      .then(setContacts)
      .catch(() => {})
  }, [controller])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setAddOpen(true)
  }

  function openEdit(c: Contact) {
    setEditing(c)
    setForm({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', notes: c.notes })
    setAddOpen(true)
  }

  async function handleAdd() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await controller.updateContact(editing.id, form)
        toast.success('Contact updated')
      } else {
        await controller.createContact(form)
        toast.success('Contact added')
      }
      setAddOpen(false)
      await load()
    } catch {
      toast.error(editing ? 'Failed to update contact' : 'Failed to add contact')
    } finally {
      setSaving(false)
    }
  }

  const deleteContact = async (id: number) => {
    try {
      await controller.deleteContact(id)
      setContacts(prev => prev.filter(c => c.id !== id))
      toast.success('Contact deleted')
    } catch {
      toast.error('Failed to delete contact')
    }
  }

  const toggleFavorite = async (c: Contact) => {
    try {
      await controller.updateContact(c.id, { favorite: !c.favorite })
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, favorite: !x.favorite } : x))
    } catch {
      toast.error('Failed to update contact')
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>
  }

  const q = search.trim().toLowerCase()
  const filtered = contacts.filter(c => {
    if (!q) return true
    return c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)
  })
  const sorted = [...filtered].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return a.name.localeCompare(b.name)
  }).slice(0, 4)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ position: 'relative', marginBottom: 'var(--space-2)' }}>
        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search contacts…"
          style={{ paddingLeft: 24, height: 'var(--input-height-sm)', fontSize: 'var(--font-size-xs)' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {sorted.length === 0 ? (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-2)' }}>
            {search ? 'No matching contacts' : 'No contacts yet'}
          </div>
        ) : sorted.map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-primary)',
          }}>
            <Avatar name={c.name} size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any,
                color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.name}
              </div>
              {(c.email || c.phone) && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.email || c.phone}
                </div>
              )}
            </div>
            <button
              onClick={() => toggleFavorite(c)}
              title={c.favorite ? 'Unfavorite' : 'Favorite'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.favorite ? 'var(--color-warning)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
            >
              <Star size={12} fill={c.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => openEdit(c)}
              title="Edit contact"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => deleteContact(c.id)}
              title="Delete contact"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 'var(--space-2)' }}>
        <button
          onClick={() => navigate('contacts')}
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-primary)',
            background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          View all contacts →
        </button>
        <button
          onClick={openAdd}
          title="Quick add contact"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', display: 'flex', padding: 0 }}
        >
          <Plus size={16} />
        </button>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={editing ? 'Edit Contact' : 'New Contact'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleAdd}>{editing ? 'Save' : 'Add'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Jane Doe"
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="jane@example.com"
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="555-123-4567"
          />
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Anything worth remembering…"
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}
