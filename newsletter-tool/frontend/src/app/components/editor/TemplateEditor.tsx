/**
 * Template editor.
 *
 * Reuses the WYSIWYG canvas + sidebar from the campaign editor, minus the
 * audience/schedule/send concerns. Custom templates are fully editable with
 * debounced auto-save; built-in templates are read-only with a "Duplicate to
 * edit" affordance.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FiArrowLeft,
  FiCheck,
  FiCopy,
  FiSend,
  FiTrash2,
} from 'react-icons/fi'
import { Button, Input } from '../ui'
import { useAgentAware } from '../../agent/hooks'
import type { AppController } from '../../AppController'
import type {
  CampaignDesign,
  EmailBlock,
  Template,
} from '../../types'
import { CampaignCanvas } from './CampaignCanvas'
import { EditorSidebar } from './EditorSidebar'

interface TemplateEditorProps {
  controller: AppController
  template: Template
  onClose: () => void
  onStartCampaign: (template: Template) => void
  onDeleted: () => void
}

export function TemplateEditor({
  controller,
  template,
  onClose,
  onStartCampaign,
  onDeleted,
}: TemplateEditorProps) {
  const [working, setWorking] = useState<Template>(template)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  // Sync incoming template prop changes (e.g. when user opens a different one).
  useEffect(() => {
    setWorking(template)
  }, [template.id])  // eslint-disable-line react-hooks/exhaustive-deps

  useAgentAware('TemplateEditor', {
    templateId: template.id,
    isBuiltin: template.isBuiltin,
    blocks: (working.blocks || []).length,
  })

  const update = useCallback((patch: Partial<Template>) => {
    setWorking((prev) => ({ ...prev, ...patch }))
  }, [])

  // Auto-save on every edit
  const lastSavedJson = useRef<string>('')
  useEffect(() => {
    const snapshot = JSON.stringify({
      name: working.name,
      subject: working.subject,
      preheader: working.preheader,
      blocks: working.blocks,
      design: working.design,
    })
    if (!lastSavedJson.current) {
      lastSavedJson.current = snapshot
      return
    }
    if (snapshot === lastSavedJson.current) return

    const handle = window.setTimeout(async () => {
      setSaving(true)
      const saved = await controller.saveTemplate({
        id: working.id,
        name: working.name || 'Untitled template',
        subject: working.subject || '',
        preheader: working.preheader || '',
        blocks: working.blocks || [],
        design: (working.design || {}) as Record<string, unknown>,
        silent: true,
      })
      if (!isMounted.current) return
      if (saved) {
        lastSavedJson.current = snapshot
        setSavedFlash(true)
        window.setTimeout(() => isMounted.current && setSavedFlash(false), 1500)
      }
      setSaving(false)
    }, 700)
    return () => window.clearTimeout(handle)
  }, [working, controller])

  async function handleDuplicate() {
    const created = await controller.saveTemplate({
      name: `${working.name} (copy)`,
      subject: working.subject || '',
      preheader: working.preheader || '',
      blocks: working.blocks || [],
      design: (working.design || {}) as Record<string, unknown>,
    })
    if (created) {
      setWorking(created)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${working.name}"?`)) return
    const ok = await controller.deleteTemplate(working.id)
    if (ok) onDeleted()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          icon={<FiArrowLeft size={14} />}
          onClick={onClose}
        >
          Templates
        </Button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input
            value={working.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Template name"
            style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          {saving ? (
            'Saving…'
          ) : savedFlash ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--color-success)',
              }}
            >
              <FiCheck size={12} /> Saved
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<FiCopy size={14} />}
          onClick={handleDuplicate}
        >
          Duplicate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<FiTrash2 size={14} />}
          onClick={handleDelete}
          aria-label="Delete template"
        >
          Delete
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<FiSend size={14} />}
          onClick={() => onStartCampaign(working)}
        >
          Start campaign
        </Button>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Subject line"
          value={working.subject}
          onChange={(e) => update({ subject: e.target.value })}
          hint="The first thing recipients see in their inbox."
        />
        <Input
          label="Preheader"
          value={working.preheader}
          onChange={(e) => update({ preheader: e.target.value })}
          hint="Short preview text shown after the subject."
        />
      </div>

      <div
        style={{
          display: 'grid',
          gap: 'var(--space-3)',
          gridTemplateColumns:
            typeof window !== 'undefined' && window.innerWidth >= 960
              ? '240px minmax(0, 1fr)'
              : 'minmax(0, 1fr)',
          alignItems: 'flex-start',
        }}
      >
        <EditorSidebar
          design={(working.design || {}) as CampaignDesign}
          onChangeDesign={(d) => update({ design: d })}
          onAddBlock={(b: EmailBlock) =>
            update({ blocks: [...(working.blocks || []), b] })
          }
        />
        <CampaignCanvas
          blocks={working.blocks || []}
          design={(working.design || {}) as CampaignDesign}
          onChange={(blocks) => update({ blocks })}
        />
      </div>
    </div>
  )
}
