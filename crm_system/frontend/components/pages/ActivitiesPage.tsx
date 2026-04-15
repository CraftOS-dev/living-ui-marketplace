import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Select, Table, Badge, Modal, Input, Textarea, EmptyState } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, Activity } from '../../types'

const BACKEND_URL = 'http://localhost:{{BACKEND_PORT}}/api'

interface ActivitiesPageProps {
  controller: AppController
  state: AppState
}

const typeOptions = [
  { value: '', label: 'All Types' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'task', label: 'Task' },
]

const completionOptions = [
  { value: '', label: 'All Status' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'Pending' },
]

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

const typeBadgeVariant: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'error' | 'default'> = {
  call: 'info',
  email: 'primary',
  meeting: 'warning',
  task: 'success',
}

export function ActivitiesPage({ controller }: ActivitiesPageProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [completionFilter, setCompletionFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Form state
  const [formSubject, setFormSubject] = useState('')
  const [formType, setFormType] = useState('call')
  const [formEntityType, setFormEntityType] = useState('contact')
  const [formEntityId, setFormEntityId] = useState('1')
  const [formDueDate, setFormDueDate] = useState('')
  const [formPriority, setFormPriority] = useState('normal')
  const [formDescription, setFormDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadActivities = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { perPage: 100 }
      if (typeFilter) params.activityType = typeFilter
      if (completionFilter === 'completed') params.isCompleted = true
      if (completionFilter === 'pending') params.isCompleted = false
      const result = await controller.fetchActivities(params as any)
      setActivities(result.items || [])
    } catch (err) {
      showToast('Failed to load activities')
    } finally {
      setLoading(false)
    }
  }, [controller, typeFilter, completionFilter, showToast])

  useEffect(() => {
    loadActivities()
  }, [loadActivities])

  const handleToggleComplete = async (activity: Activity) => {
    try {
      const res = await fetch(`${BACKEND_URL}/activities/${activity.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: !activity.isCompleted }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast(activity.isCompleted ? 'Marked as pending' : 'Marked as completed')
      loadActivities()
    } catch {
      showToast('Failed to update activity')
    }
  }

  const handleSubmit = async () => {
    if (!formSubject.trim()) {
      showToast('Subject is required')
      return
    }
    setSaving(true)
    try {
      await controller.createActivity({
        entityType: formEntityType,
        entityId: parseInt(formEntityId) || 1,
        activityType: formType,
        subject: formSubject.trim(),
        description: formDescription || undefined,
        dueDate: formDueDate || undefined,
        priority: formPriority,
      })
      showToast('Activity created')
      setShowModal(false)
      resetForm()
      loadActivities()
    } catch {
      showToast('Failed to create activity')
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setFormSubject('')
    setFormType('call')
    setFormEntityType('contact')
    setFormEntityId('1')
    setFormDueDate('')
    setFormPriority('normal')
    setFormDescription('')
  }

  const columns = [
    {
      key: 'subject',
      header: 'Subject',
      render: (a: Activity) => (
        <span style={{ fontWeight: 'var(--font-weight-medium)' as any }}>{a.subject}</span>
      ),
    },
    {
      key: 'activityType',
      header: 'Type',
      render: (a: Activity) => (
        <Badge variant={typeBadgeVariant[a.activityType] || 'default'}>
          {a.activityType}
        </Badge>
      ),
    },
    {
      key: 'entity',
      header: 'Entity',
      render: (a: Activity) => (
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          {a.entityType} #{a.entityId}
        </span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      render: (a: Activity) =>
        a.dueDate ? new Date(a.dueDate).toLocaleDateString() : '--',
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (a: Activity) => {
        const v = a.priority === 'high' ? 'error' : a.priority === 'normal' ? 'warning' : 'default'
        return <Badge variant={v as any}>{a.priority}</Badge>
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (a: Activity) => (
        <Badge variant={a.isCompleted ? 'success' : 'warning'} dot>
          {a.isCompleted ? 'Completed' : 'Pending'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '100px',
      render: (a: Activity) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            handleToggleComplete(a)
          }}
        >
          {a.isCompleted ? 'Undo' : 'Complete'}
        </Button>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Toast */}
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

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
          Activities
        </h1>
        <Button onClick={() => setShowModal(true)}>Log Activity</Button>
      </div>

      {/* Filter Toolbar */}
      <Card padding="sm">
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
          <div style={{ width: 200 }}>
            <Select
              label="Type"
              options={typeOptions}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            />
          </div>
          <div style={{ width: 200 }}>
            <Select
              label="Status"
              options={completionOptions}
              value={completionFilter}
              onChange={(e) => setCompletionFilter(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading activities...
          </div>
        ) : activities.length === 0 ? (
          <EmptyState
            message="No activities found"
            action={<Button onClick={() => setShowModal(true)}>Log Activity</Button>}
          />
        ) : (
          <Table
            columns={columns}
            data={activities}
            rowKey={(a) => a.id}
          />
        )}
      </Card>

      {/* Log Activity Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Log Activity"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSubmit} loading={saving}>Save</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Subject"
            value={formSubject}
            onChange={(e) => setFormSubject(e.target.value)}
            placeholder="Activity subject"
          />
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div style={{ flex: 1 }}>
              <Select
                label="Type"
                options={[
                  { value: 'call', label: 'Call' },
                  { value: 'email', label: 'Email' },
                  { value: 'meeting', label: 'Meeting' },
                  { value: 'task', label: 'Task' },
                ]}
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label="Priority"
                options={priorityOptions}
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div style={{ flex: 1 }}>
              <Select
                label="Entity Type"
                options={[
                  { value: 'contact', label: 'Contact' },
                  { value: 'company', label: 'Company' },
                  { value: 'deal', label: 'Deal' },
                ]}
                value={formEntityType}
                onChange={(e) => setFormEntityType(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label="Entity ID"
                type="number"
                value={formEntityId}
                onChange={(e) => setFormEntityId(e.target.value)}
              />
            </div>
          </div>
          <Input
            label="Due Date"
            type="datetime-local"
            value={formDueDate}
            onChange={(e) => setFormDueDate(e.target.value)}
          />
          <Textarea
            label="Description"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            rows={3}
            placeholder="Optional description"
          />
        </div>
      </Modal>
    </div>
  )
}
