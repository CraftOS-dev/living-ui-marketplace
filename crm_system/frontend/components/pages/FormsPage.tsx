import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Table, Badge, Modal, Input, Select, EmptyState } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, LeadCaptureForm } from '../../types'

const BACKEND_URL = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}') + '/api'

interface FormsPageProps {
  controller: AppController
  state: AppState
}

interface FormField {
  name: string
  label: string
  type: string
  required: boolean
}

const fieldTypeOptions = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Select' },
  { value: 'textarea', label: 'Textarea' },
]

export function FormsPage({ controller: _controller }: FormsPageProps) {
  const [forms, setForms] = useState<LeadCaptureForm[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [preview, setPreview] = useState<LeadCaptureForm | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formAction, setFormAction] = useState('create_contact')
  const [fields, setFields] = useState<FormField[]>([
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
  ])
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [previewData, setPreviewData] = useState<Record<string, string>>({})

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/forms`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setForms(Array.isArray(data) ? data : data.items || [])
    } catch {
      showToast('Failed to load forms')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadForms()
  }, [loadForms])

  const addField = () => {
    setFields([...fields, { name: '', label: '', type: 'text', required: false }])
  }

  const updateField = (index: number, updates: Partial<FormField>) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...updates } : f)))
  }

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index))
  }

  const handleCreate = async () => {
    if (!formName.trim()) {
      showToast('Form name is required')
      return
    }
    const validFields = fields.filter((f) => f.name && f.label)
    if (validFields.length === 0) {
      showToast('At least one field is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}/forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          fields: validFields,
          submitAction: formAction,
          tagIds: [],
        }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Form created')
      setShowModal(false)
      setFormName('')
      setFields([
        { name: 'first_name', label: 'First Name', type: 'text', required: true },
        { name: 'last_name', label: 'Last Name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
      ])
      loadForms()
    } catch {
      showToast('Failed to create form')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this form?')) return
    try {
      const res = await fetch(`${BACKEND_URL}/forms/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Form deleted')
      loadForms()
    } catch {
      showToast('Failed to delete form')
    }
  }

  const handlePreviewSubmit = async () => {
    if (!preview) return
    setSubmitting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/forms/${preview.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: previewData }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Form submitted successfully (simulation)')
      setPreviewData({})
    } catch {
      showToast('Form submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (f: LeadCaptureForm) => (
        <span style={{ fontWeight: 'var(--font-weight-medium)' as any }}>{f.name}</span>
      ),
    },
    {
      key: 'fields',
      header: 'Fields',
      render: (f: LeadCaptureForm) => (
        <span style={{ color: 'var(--text-secondary)' }}>{f.fields?.length || 0} fields</span>
      ),
    },
    {
      key: 'active',
      header: 'Status',
      render: (f: LeadCaptureForm) => (
        <Badge variant={f.active ? 'success' : 'default'} dot>
          {f.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'submissionsCount',
      header: 'Submissions',
      render: (f: LeadCaptureForm) => f.submissionsCount ?? 0,
    },
    {
      key: 'actions',
      header: '',
      width: '160px',
      render: (f: LeadCaptureForm) => (
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setPreview(f)
              setPreviewData({})
            }}
          >
            Preview
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              handleDelete(f.id)
            }}
          >
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
          Lead Capture Forms
        </h1>
        <Button onClick={() => setShowModal(true)}>New Form</Button>
      </div>

      <Card padding="none">
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading forms...
          </div>
        ) : forms.length === 0 ? (
          <EmptyState
            message="No forms yet"
            action={<Button onClick={() => setShowModal(true)}>New Form</Button>}
          />
        ) : (
          <Table columns={columns} data={forms} rowKey={(f) => f.id} />
        )}
      </Card>

      {/* New Form Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="New Lead Capture Form"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving}>Create</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Form Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g., Contact Us Form"
          />
          <Select
            label="Submit Action"
            options={[
              { value: 'create_contact', label: 'Create Contact' },
              { value: 'create_lead', label: 'Create Lead' },
            ]}
            value={formAction}
            onChange={(e) => setFormAction(e.target.value)}
          />
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'var(--space-2)',
              }}
            >
              <span
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--font-weight-medium)' as any,
                  color: 'var(--text-primary)',
                }}
              >
                Fields
              </span>
              <Button variant="ghost" size="sm" onClick={addField}>
                + Add Field
              </Button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {fields.map((field, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    alignItems: 'center',
                    padding: 'var(--space-2)',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <Input
                    placeholder="Field name"
                    value={field.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <Input
                    placeholder="Label"
                    value={field.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateField(i, { type: e.target.value })}
                    style={{
                      height: 'var(--input-height-md)',
                      padding: '0 var(--space-2)',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    {fieldTypeOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                    />
                    Req
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => removeField(i)}>
                    x
                  </Button>
                </div>
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
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>
            <Button onClick={handlePreviewSubmit} loading={submitting}>
              Submit (Simulate)
            </Button>
          </>
        }
      >
        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              This is a preview of the lead capture form. Fill in and submit to simulate.
            </p>
            {(preview.fields as unknown as FormField[])?.map((field, i) => (
              <div key={i}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-medium)' as any,
                    color: 'var(--text-primary)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  {field.label || field.name}
                  {field.required && <span style={{ color: 'var(--color-error)' }}> *</span>}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={previewData[field.name] || ''}
                    onChange={(e) => setPreviewData({ ...previewData, [field.name]: e.target.value })}
                    rows={3}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2) var(--space-3)',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-size-base)',
                      resize: 'vertical',
                    }}
                  />
                ) : (
                  <input
                    type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                    value={previewData[field.name] || ''}
                    onChange={(e) => setPreviewData({ ...previewData, [field.name]: e.target.value })}
                    style={{
                      width: '100%',
                      height: 'var(--input-height-md)',
                      padding: '0 var(--space-3)',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-size-base)',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
