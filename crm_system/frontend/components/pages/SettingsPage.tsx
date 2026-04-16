import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Input, Select, Toggle, Tabs, TabList, Tab, TabPanel, Badge, Alert, Modal } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, DealStage, Tag, CustomField } from '../../types'

const BACKEND_URL = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}') + '/api'

interface SettingsPageProps {
  controller: AppController
  state: AppState
}

export function SettingsPage({ controller }: SettingsPageProps) {
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

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

      <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
        Settings
      </h1>

      <Tabs defaultTab="stages">
        <TabList>
          <Tab id="stages">Pipeline Stages</Tab>
          <Tab id="tags">Tags</Tab>
          <Tab id="fields">Custom Fields</Tab>
          <Tab id="smtp">SMTP</Tab>
          <Tab id="data">Data</Tab>
        </TabList>

        <TabPanel id="stages">
          <PipelineStagesTab controller={controller} showToast={showToast} />
        </TabPanel>
        <TabPanel id="tags">
          <TagsTab controller={controller} showToast={showToast} />
        </TabPanel>
        <TabPanel id="fields">
          <CustomFieldsTab showToast={showToast} />
        </TabPanel>
        <TabPanel id="smtp">
          <SmtpTab controller={controller} showToast={showToast} />
        </TabPanel>
        <TabPanel id="data">
          <DataTab controller={controller} showToast={showToast} />
        </TabPanel>
      </Tabs>
    </div>
  )
}

// =============================================================================
// Pipeline Stages Tab
// =============================================================================

function PipelineStagesTab({ controller, showToast }: { controller: AppController; showToast: (m: string) => void }) {
  const [stages, setStages] = useState<DealStage[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<DealStage | null>(null)
  const [formName, setFormName] = useState('')
  const [formProbability, setFormProbability] = useState('50')
  const [formColor, setFormColor] = useState('#6366f1')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await controller.fetchStages()
      setStages(data.sort((a, b) => a.position - b.position))
    } catch {
      showToast('Failed to load stages')
    } finally {
      setLoading(false)
    }
  }, [controller, showToast])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setEditing(null)
    setFormName('')
    setFormProbability('50')
    setFormColor('#6366f1')
    setShowModal(true)
  }

  const openEdit = (s: DealStage) => {
    setEditing(s)
    setFormName(s.name)
    setFormProbability(String(s.probabilityDefault))
    setFormColor(s.color || '#6366f1')
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) { showToast('Name is required'); return }
    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        probabilityDefault: parseInt(formProbability) || 50,
        color: formColor,
        position: editing ? editing.position : stages.length,
      }
      if (editing) {
        const res = await fetch(`${BACKEND_URL}/stages/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed')
        showToast('Stage updated')
      } else {
        const res = await fetch(`${BACKEND_URL}/stages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed')
        showToast('Stage created')
      }
      setShowModal(false)
      load()
    } catch {
      showToast('Failed to save stage')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this stage? Deals in this stage may be affected.')) return
    try {
      const res = await fetch(`${BACKEND_URL}/stages/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Stage deleted')
      load()
    } catch {
      showToast('Failed to delete stage')
    }
  }

  const handleReorder = async (id: number, direction: 'up' | 'down') => {
    const idx = stages.findIndex((s) => s.id === id)
    if ((direction === 'up' && idx <= 0) || (direction === 'down' && idx >= stages.length - 1)) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    try {
      await fetch(`${BACKEND_URL}/stages/${stages[idx].id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: stages[swapIdx].position }),
      })
      await fetch(`${BACKEND_URL}/stages/${stages[swapIdx].id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: stages[idx].position }),
      })
      load()
    } catch {
      showToast('Failed to reorder')
    }
  }

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>Loading stages...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={openNew} size="sm">Add Stage</Button>
      </div>
      {stages.length === 0 ? (
        <Card><p style={{ margin: 0, color: 'var(--text-secondary)' }}>No pipeline stages configured.</p></Card>
      ) : (
        stages.map((s) => (
          <Card key={s.id} padding="sm">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button variant="ghost" size="sm" onClick={() => handleReorder(s.id, 'up')} style={{ padding: '0 4px', height: 16, fontSize: 10 }}>
                  ^
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleReorder(s.id, 'down')} style={{ padding: '0 4px', height: 16, fontSize: 10 }}>
                  v
                </Button>
              </div>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: s.color || 'var(--color-primary)',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'var(--font-weight-medium)' as any }}>{s.name}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                  {s.probabilityDefault}% probability | {s.dealCount} deals
                  {s.isClosedWon && ' | Won'}
                  {s.isClosedLost && ' | Lost'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)}>Delete</Button>
              </div>
            </div>
          </Card>
        ))
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Stage' : 'Add Stage'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>{editing ? 'Update' : 'Create'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} />
          <Input label="Default Probability (%)" type="number" value={formProbability} onChange={(e) => setFormProbability(e.target.value)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--text-primary)' }}>
              Color
            </label>
            <input
              type="color"
              value={formColor}
              onChange={(e) => setFormColor(e.target.value)}
              style={{ width: 60, height: 36, padding: 0, border: 'none', cursor: 'pointer' }}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

// =============================================================================
// Tags Tab
// =============================================================================

function TagsTab({ controller, showToast }: { controller: AppController; showToast: (m: string) => void }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Tag | null>(null)
  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState('#6366f1')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await controller.fetchTags()
      setTags(data)
    } catch {
      showToast('Failed to load tags')
    } finally {
      setLoading(false)
    }
  }, [controller, showToast])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setEditing(null)
    setFormName('')
    setFormColor('#6366f1')
    setShowModal(true)
  }

  const openEdit = (t: Tag) => {
    setEditing(t)
    setFormName(t.name)
    setFormColor(t.color || '#6366f1')
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) { showToast('Name is required'); return }
    setSaving(true)
    try {
      if (editing) {
        const res = await fetch(`${BACKEND_URL}/tags/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName.trim(), color: formColor }),
        })
        if (!res.ok) throw new Error('Failed')
        showToast('Tag updated')
      } else {
        await controller.createTag({ name: formName.trim(), color: formColor })
        showToast('Tag created')
      }
      setShowModal(false)
      load()
    } catch {
      showToast('Failed to save tag')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this tag?')) return
    try {
      const res = await fetch(`${BACKEND_URL}/tags/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Tag deleted')
      load()
    } catch {
      showToast('Failed to delete tag')
    }
  }

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>Loading tags...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={openNew} size="sm">Add Tag</Button>
      </div>
      {tags.length === 0 ? (
        <Card><p style={{ margin: 0, color: 'var(--text-secondary)' }}>No tags yet.</p></Card>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {tags.map((t) => (
            <Card key={t.id} padding="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: t.color || 'var(--color-primary)',
                }}
              />
              <span style={{ fontWeight: 'var(--font-weight-medium)' as any }}>{t.name}</span>
              <Button variant="ghost" size="sm" onClick={() => openEdit(t)} style={{ padding: '0 4px' }}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(t.id)} style={{ padding: '0 4px' }}>
                x
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Tag' : 'Add Tag'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>{editing ? 'Update' : 'Create'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--text-primary)' }}>
              Color
            </label>
            <input
              type="color"
              value={formColor}
              onChange={(e) => setFormColor(e.target.value)}
              style={{ width: 60, height: 36, padding: 0, border: 'none', cursor: 'pointer' }}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

// =============================================================================
// Custom Fields Tab
// =============================================================================

function CustomFieldsTab({ showToast }: { showToast: (m: string) => void }) {
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [formEntity, setFormEntity] = useState('contact')
  const [formName, setFormName] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formType, setFormType] = useState('text')
  const [formRequired, setFormRequired] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/custom-fields`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setFields(Array.isArray(data) ? data : data.items || [])
    } catch {
      setFields([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!formName.trim() || !formLabel.trim()) { showToast('Name and label required'); return }
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: formEntity,
          fieldName: formName.trim(),
          fieldLabel: formLabel.trim(),
          fieldType: formType,
          required: formRequired,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Custom field created')
      setShowModal(false)
      setFormName('')
      setFormLabel('')
      load()
    } catch {
      showToast('Failed to create field')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this custom field?')) return
    try {
      const res = await fetch(`${BACKEND_URL}/custom-fields/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Field deleted')
      load()
    } catch {
      showToast('Failed to delete field')
    }
  }

  const grouped = fields.reduce<Record<string, CustomField[]>>((acc, f) => {
    if (!acc[f.entityType]) acc[f.entityType] = []
    acc[f.entityType].push(f)
    return acc
  }, {})

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>Loading custom fields...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={() => setShowModal(true)} size="sm">Add Field</Button>
      </div>
      {Object.keys(grouped).length === 0 ? (
        <Card><p style={{ margin: 0, color: 'var(--text-secondary)' }}>No custom fields configured.</p></Card>
      ) : (
        Object.entries(grouped).map(([entity, entityFields]) => (
          <div key={entity}>
            <h4 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              {entity}
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {entityFields.map((f) => (
                <Card key={f.id} padding="sm">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 'var(--font-weight-medium)' as any }}>{f.fieldLabel}</span>
                      <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                        ({f.fieldName})
                      </span>
                    </div>
                    <Badge variant="default" size="sm">{f.fieldType}</Badge>
                    {f.required && <Badge variant="error" size="sm">Required</Badge>}
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(f.id)}>Delete</Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Add Custom Field"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Create</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Select
            label="Entity Type"
            options={[
              { value: 'contact', label: 'Contact' },
              { value: 'company', label: 'Company' },
              { value: 'deal', label: 'Deal' },
            ]}
            value={formEntity}
            onChange={(e) => setFormEntity(e.target.value)}
          />
          <Input label="Field Name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., industry_code" />
          <Input label="Field Label" value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="e.g., Industry Code" />
          <Select
            label="Field Type"
            options={[
              { value: 'text', label: 'Text' },
              { value: 'number', label: 'Number' },
              { value: 'date', label: 'Date' },
              { value: 'boolean', label: 'Boolean' },
              { value: 'select', label: 'Select' },
            ]}
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
          />
          <Toggle checked={formRequired} onChange={setFormRequired} label="Required" />
        </div>
      </Modal>
    </div>
  )
}

// =============================================================================
// SMTP Tab
// =============================================================================

function SmtpTab({ controller, showToast }: { controller: AppController; showToast: (m: string) => void }) {
  const [loading, setLoading] = useState(true)
  const [smtpServer, setSmtpServer] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [emailAddress, setEmailAddress] = useState('')
  const [password, setPassword] = useState('')
  const [useTls, setUseTls] = useState(true)
  const [fromName, setFromName] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const config = await controller.getSmtpConfig()
        setSmtpServer(config.smtpServer || '')
        setSmtpPort(String(config.smtpPort || 587))
        setEmailAddress(config.emailAddress || '')
        setUseTls(config.useTls !== false)
        setFromName(config.fromName || '')
      } catch {
        // No config yet
      } finally {
        setLoading(false)
      }
    })()
  }, [controller])

  const handleSave = async () => {
    if (!smtpServer.trim() || !emailAddress.trim()) {
      showToast('Server and email are required')
      return
    }
    setSaving(true)
    try {
      await controller.updateSmtpConfig({
        smtpServer: smtpServer.trim(),
        smtpPort: parseInt(smtpPort) || 587,
        emailAddress: emailAddress.trim(),
        password: password || undefined,
        useTls,
        fromName: fromName || undefined,
      })
      showToast('SMTP config saved')
    } catch {
      showToast('Failed to save SMTP config')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/smtp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Test failed')
      showToast('SMTP test successful')
    } catch {
      showToast('SMTP test failed - check your settings')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>Loading SMTP config...</div>

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 500 }}>
        <Input label="SMTP Server" value={smtpServer} onChange={(e) => setSmtpServer(e.target.value)} placeholder="smtp.gmail.com" />
        <Input label="Port" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
        <Input label="Email Address" type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="you@example.com" />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="App password" />
        <Input label="From Name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Company" />
        <Toggle checked={useTls} onChange={setUseTls} label="Use TLS" />
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <Button onClick={handleSave} loading={saving}>Save</Button>
          <Button variant="secondary" onClick={handleTest} loading={testing}>Test Connection</Button>
        </div>
      </div>
    </Card>
  )
}

// =============================================================================
// Data Tab
// =============================================================================

function DataTab({ controller, showToast }: { controller: AppController; showToast: (m: string) => void }) {
  const [seeding, setSeeding] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const handleSeed = async () => {
    setSeeding(true)
    try {
      await controller.seedDemoData()
      showToast('Demo data seeded successfully')
    } catch {
      showToast('Failed to seed demo data')
    } finally {
      setSeeding(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/seed/reset`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Failed')
      showToast('All data has been reset')
      setConfirmReset(false)
      // Refresh app
      await controller.refresh()
    } catch {
      showToast('Failed to reset data')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card>
        <h3 style={{ margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)' as any }}>
          Seed Demo Data
        </h3>
        <p style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          Populate the CRM with sample contacts, companies, deals, and activities for testing.
        </p>
        <Button onClick={handleSeed} loading={seeding}>Seed Demo Data</Button>
      </Card>

      <Card>
        <h3 style={{ margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-error)' }}>
          Reset All Data
        </h3>
        <p style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          This will permanently delete all data from the CRM. This action cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setConfirmReset(true)}>Reset All Data</Button>
      </Card>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Confirm Reset"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleReset} loading={resetting}>Yes, Reset Everything</Button>
          </>
        }
      >
        <Alert variant="error">
          This will permanently delete ALL contacts, companies, deals, activities, and settings. This cannot be undone.
        </Alert>
      </Modal>
    </div>
  )
}
