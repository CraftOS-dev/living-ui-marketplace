import { useEffect, useMemo, useState } from 'react'
import { FiPlus, FiSend, FiTrash2 } from 'react-icons/fi'
import { Button, EmptyState, Input, Modal } from '../ui'
import { useAgentAware } from '../../agent/hooks'
import type { AppController } from '../../AppController'
import type { Template } from '../../types'

interface TemplatesProps {
  controller: AppController
  templates: Template[]
  onEditTemplate: (template: Template) => void
  onStartCampaign: (template: Template) => void
}

export function Templates({
  controller,
  templates,
  onEditTemplate,
  onStartCampaign,
}: TemplatesProps) {
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    controller.refreshTemplates()
  }, [controller])

  useAgentAware('Templates', {
    section: 'templates',
    count: templates.length,
  })

  const sorted = useMemo(() => {
    return [...templates].sort((a, b) => {
      const aUse = a.usageCount || 0
      const bUse = b.usageCount || 0
      if (bUse !== aUse) return bUse - aUse
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return bTime - aTime
    })
  }, [templates])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Templates</h1>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            Start a campaign from any template, or save your own.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<FiPlus size={14} />}
          onClick={() => setShowCreate(true)}
        >
          New blank template
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-5)',
          }}
        >
          <EmptyState
            title="No templates yet"
            message="Built-in templates load on first start. Try refreshing — or create a blank one to start from scratch."
            action={
              <Button variant="primary" onClick={() => setShowCreate(true)}>
                Create a blank template
              </Button>
            }
          />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-3)',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 300px))',
            justifyContent: 'start',
          }}
        >
          {sorted.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onEdit={() => onEditTemplate(tpl)}
              onStartCampaign={() => onStartCampaign(tpl)}
              onDelete={async () => {
                if (window.confirm(`Delete "${tpl.name}"?`)) {
                  await controller.deleteTemplate(tpl.id)
                }
              }}
            />
          ))}
        </div>
      )}

      <CreateBlankTemplateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={async (name) => {
          const created = await controller.saveTemplate({
            name,
            subject: '',
            preheader: '',
            blocks: [
              { type: 'heading', text: 'Hello!', level: 1 },
              { type: 'text', text: 'Write your message here.' },
            ],
          })
          if (created) {
            setShowCreate(false)
            onEditTemplate(created)
          }
        }}
      />
    </div>
  )
}

function TemplateCard({
  template,
  onEdit,
  onStartCampaign,
  onDelete,
}: {
  template: Template
  onEdit: () => void
  onStartCampaign: () => void
  onDelete?: () => void | Promise<void>
}) {
  const [hover, setHover] = useState(false)
  const blockCount = (template.blocks || []).length
  const meta: string[] = []
  if ((template.usageCount || 0) > 0) {
    meta.push(`${template.usageCount} ${template.usageCount === 1 ? 'use' : 'uses'}`)
  }
  meta.push(`${blockCount} ${blockCount === 1 ? 'block' : 'blocks'}`)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        // box-shadow for hover ring so the border thickness stays constant
        boxShadow: hover ? 'inset 0 0 0 1px var(--text-primary)' : 'none',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 170,
        transition: 'box-shadow 100ms ease',
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 'var(--font-size-base)',
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingRight: onDelete ? 28 : 0,
        }}
        title={template.name}
      >
        {template.name}
      </div>
      <div
        style={{
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: '2.7em',
        }}
      >
        {template.subject || template.preheader || 'No subject set'}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 'auto' }}>
        {meta.join(' · ')}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingTop: 8,
        }}
      >
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            color: hover ? 'var(--text-primary)' : 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          Edit →
        </span>
        <span style={{ flex: 1 }} />
        <Button
          size="sm"
          variant="secondary"
          icon={<FiSend size={12} />}
          onClick={(e) => {
            e.stopPropagation()
            onStartCampaign()
          }}
        >
          Start campaign
        </Button>
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          aria-label={`Delete ${template.name}`}
          title="Delete"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 24,
            height: 24,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            borderRadius: 4,
            opacity: hover ? 1 : 0,
            transition: 'opacity 100ms ease, background 100ms ease, color 100ms ease',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-error)'
            e.currentTarget.style.background = 'var(--bg-tertiary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <FiTrash2 size={12} />
        </button>
      )}
    </div>
  )
}

function CreateBlankTemplateModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New blank template"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim())}
          >
            Create
          </Button>
        </>
      }
    >
      <Input
        label="Template name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Welcome v2"
      />
    </Modal>
  )
}
