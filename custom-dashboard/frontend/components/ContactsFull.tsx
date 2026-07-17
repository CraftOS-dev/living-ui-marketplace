import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { Contact } from '../types'
import { Button, Input, Textarea, Modal, EmptyState, Avatar } from './ui'
import { Users, Plus, Pencil, Trash2, Search, Star } from 'lucide-react'
import { toast } from 'react-toastify'

interface ContactsFullProps {
  controller: AppController
}

interface FormState {
  name: string
  email: string
  phone: string
  notes: string
}

const EMPTY_FORM: FormState = { name: '', email: '', phone: '', notes: '' }

export function ContactsFull({ controller }: ContactsFullProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const load = () => {
    controller.getContacts().then(setContacts).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [controller])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(contact: Contact) {
    setEditing(contact)
    setForm({
      name: contact.name,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      notes: contact.notes,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const updated = await controller.updateContact(editing.id, form)
        setContacts(prev => prev.map(c => c.id === updated.id ? updated : c))
        toast.success('Contact updated')
      } else {
        const created = await controller.createContact(form)
        setContacts(prev => [...prev, created])
        toast.success('Contact added')
      }
      setModalOpen(false)
    } catch {
      toast.error('Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(contact: Contact) {
    try {
      await controller.deleteContact(contact.id)
      setContacts(prev => prev.filter(c => c.id !== contact.id))
      toast.success('Contact deleted')
    } catch {
      toast.error('Failed to delete contact')
    }
  }

  async function toggleFavorite(contact: Contact) {
    try {
      const updated = await controller.updateContact(contact.id, { favorite: !contact.favorite })
      setContacts(prev => prev.map(c => c.id === contact.id ? updated : c))
    } catch {
      toast.error('Failed to update contact')
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = contacts.filter(c => {
    if (!q) return true
    return c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)
  })
  const sorted = [...filtered].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Users size={20} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Contacts</h2>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
          New Contact
        </Button>
      </div>

      <div style={{ position: 'relative', marginBottom: 'var(--space-4)', maxWidth: 320 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search contacts…"
          style={{ paddingLeft: 30 }}
        />
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Users size={32} />} message={search ? 'No matching contacts' : 'No contacts yet — add one to get started.'} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-3)' }}>
          {sorted.map(c => (
            <div key={c.id} style={{
              display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-primary)',
              backgroundColor: 'var(--bg-secondary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <Avatar name={c.name} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </div>
                  {c.email && (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.email}
                    </div>
                  )}
                  {c.phone && (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.phone}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggleFavorite(c)}
                  title={c.favorite ? 'Unfavorite' : 'Favorite'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.favorite ? 'var(--color-warning)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                >
                  <Star size={16} fill={c.favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => openEdit(c)}
                  title="Edit"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDelete(c)}
                  title="Delete"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', display: 'flex' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Contact' : 'New Contact'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>Save</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Jane Doe"
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="jane@example.com"
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={e => setForm({ ...form, phone: e.target.value })}
            placeholder="555-123-4567"
          />
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Anything worth remembering…"
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}
