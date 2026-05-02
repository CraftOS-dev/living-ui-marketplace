import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Table, Badge, Modal, Input, Textarea, Select, EmptyState } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, EmailTemplate } from '../../types'

const BACKEND_URL = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3111') + '/api'

interface TemplatesPageProps {
  controller: AppController
  state: AppState
}

const categoryOptions = [
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'intro', label: 'Introduction' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'thank_you', label: 'Thank You' },
]

const categoryVariant: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'default'> = {
  follow_up: 'warning',
  intro: 'info',
  proposal: 'primary',
  thank_you: 'success',
}

const KNOWN_VARIABLES = [
  '{{first_name}}',
  '{{last_name}}',
  '{{company_name}}',
  '{{email}}',
  '{{deal_title}}',
  '{{deal_value}}',
]

export function TemplatesPage({ controller: _controller }: TemplatesPageProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [preview, setPreview] = useState<EmailTemplate | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formSubject, setFormSubject] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formCategory, setFormCategory] = useState('follow_up')
  const [saving, setSaving] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/email-templates`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setTemplates(Array.isArray(data) ? data : data.items || [])
    } catch {
      showToast('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const openNew = () => {
    setEditing(null)
    setFormName('')
    setFormSubject('')
    setFormBody('')
    setFormCategory('follow_up')
    setShowModal(true)
  }

  const openEdit = (t: EmailTemplate) => {
    setEditing(t)
    setFormName(t.name)
    setFormSubject(t.subject)
    setFormBody(t.body)
    setFormCategory(t.category || 'follow_up')
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!formName.trim() || !formSubject.trim()) {
      showToast('Name and subject are required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        subject: formSubject.trim(),
        body: formBody,
        category: formCategory,
      }
      if (editing) {
        const res = await fetch(`${BACKEND_URL}/email-templates/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed')
        showToast('Template updated')
      } else {
        const res = await fetch(`${BACKEND_URL}/email-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed')
        showToast('Template created')
      }
      setShowModal(false)
      loadTemplates()
    } catch {
      showToast('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template?')) return
    try {
      const res = await fetch(`${BACKEND_URL}/email-templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Template deleted')
      loadTemplates()
    } catch {
      showToast('Failed to delete template')
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (t: EmailTemplate) => (
        <span style={{ fontWeight: 'var(--font-weight-medium)' as any }}>{t.name}</span>
      ),
    },
    { key: 'subject', header: 'Subject' },
    {
      key: 'category',
      header: 'Category',
      render: (t: EmailTemplate) => (
        <Badge variant={categoryVariant[t.category || ''] || 'default'}>
          {(t.category || 'none').replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'variables',
      header: 'Variables',
      render: (t: EmailTemplate) => (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
          {t.variables?.length || 0}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '180px',
      render: (t: EmailTemplate) => (
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setPreview(t) }}>
            Preview
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(t) }}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}>
            Delete
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 9999,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
          }}
        >
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
          Email Templates
        </h1>
        <Button onClick={openNew}>New Template</Button>
      </div>

      <Card padding="none">
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading templates...
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            message="No email templates yet"
            action={<Button onClick={openNew}>New Template</Button>}
          />
        ) : (
          <Table columns={columns} data={templates} rowKey={(t) => t.id} />
        )}
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Template' : 'New Template'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSubmit} loading={saving}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Template Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g., Follow Up After Demo"
          />
          <Input
            label="Subject"
            value={formSubject}
            onChange={(e) => setFormSubject(e.target.value)}
            placeholder="Email subject line"
          />
          <Select
            label="Category"
            options={categoryOptions}
            value={formCategory}
            onChange={(e) => setFormCategory(e.target.value)}
          />
          <Textarea
            label="Body"
            value={formBody}
            onChange={(e) => setFormBody(e.target.value)}
            rows={8}
            placeholder="Email body content. Use variables like {{first_name}}"
          />
          <div>
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                fontWeight: 'var(--font-weight-medium)' as any,
                color: 'var(--text-secondary)',
                marginBottom: 'var(--space-1)',
              }}
            >
              Available Variables
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
              {KNOWN_VARIABLES.map((v) => (
                <span
                  key={v}
                  onClick={() => setFormBody((b) => b + ' ' + v)}
                  style={{
                    padding: '2px var(--space-2)',
                    fontSize: 'var(--font-size-xs)',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    color: 'var(--color-primary)',
                  }}
                >
                  {v}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? `Preview: ${preview.name}` : ''}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>
        }
      >
        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-secondary)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Subject
              </div>
              <div
                style={{
                  fontWeight: 'var(--font-weight-medium)' as any,
                  color: 'var(--text-primary)',
                }}
              >
                {preview.subject}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-secondary)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Category
              </div>
              <Badge variant={categoryVariant[preview.category || ''] || 'default'}>
                {(preview.category || 'none').replace('_', ' ')}
              </Badge>
            </div>
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-secondary)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Body
              </div>
              <div
                style={{
                  padding: 'var(--space-3)',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-primary)',
                  lineHeight: 1.6,
                }}
              >
                {preview.body}
              </div>
            </div>
            {preview.variables && preview.variables.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  Variables Used
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                  {preview.variables.map((v) => (
                    <Badge key={v} variant="default" size="sm">{v}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
