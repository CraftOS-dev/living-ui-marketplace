import { useEffect, useState } from 'react'
import { useAgentAware } from '../agent/hooks'
import { useAppState } from '../hooks/useAppState'
import { useViewport } from '../hooks/useViewport'
import type { AppController } from '../AppController'
import { Sidebar } from './Sidebar'
import { Dashboard } from './sections/Dashboard'
import { Subscribers } from './sections/Subscribers'
import { Templates } from './sections/Templates'
import { Campaigns } from './sections/Campaigns'
import { Schedule } from './sections/Schedule'
import { Settings as SettingsSection } from './sections/Settings'
import { CampaignEditor } from './editor/CampaignEditor'
import { TemplateEditor } from './editor/TemplateEditor'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const state = useAppState(controller)
  const viewport = useViewport()
  const [collapsed, setCollapsed] = useState(false)
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null)
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null)

  // When viewport shrinks, force collapse — and conversely expand on desktop.
  useEffect(() => {
    if (viewport.size === 'tablet') setCollapsed(true)
    if (viewport.size === 'desktop') setCollapsed(false)
  }, [viewport.size])

  useAgentAware('MainView', {
    section: state.activeSection,
    editingCampaignId,
    viewport: viewport.size,
  })

  const llmConnected = !!state.integrations?.llm.connected
  const gmailConnected = !!state.integrations?.gmail.google_workspace

  const isMobile = viewport.size === 'mobile'

  const editingTemplate =
    editingTemplateId !== null
      ? state.templates.find((t) => t.id === editingTemplateId) || null
      : null

  async function startCampaignFromTemplate(template: { id: number; name: string }) {
    const created = await controller.createCampaign(
      `${template.name} — campaign`,
      template.id,
    )
    if (created) {
      setEditingTemplateId(null)
      controller.setActiveSection('campaigns')
      setEditingCampaignId(created.id)
    }
  }

  let body: React.ReactNode = null
  if (editingCampaignId !== null) {
    body = (
      <CampaignEditor
        controller={controller}
        campaignId={editingCampaignId}
        tags={state.tags}
        subscribers={state.subscribers}
        llmConnected={llmConnected}
        gmailConnected={gmailConnected}
        onClose={() => setEditingCampaignId(null)}
      />
    )
  } else if (editingTemplate) {
    body = (
      <TemplateEditor
        controller={controller}
        template={editingTemplate}
        onClose={() => setEditingTemplateId(null)}
        onStartCampaign={startCampaignFromTemplate}
        onDeleted={() => setEditingTemplateId(null)}
      />
    )
  } else {
    switch (state.activeSection) {
      case 'dashboard':
        body = (
          <Dashboard
            controller={controller}
            dashboard={state.dashboard}
            subscribers={state.subscribers}
            campaigns={state.campaigns}
            templates={state.templates}
            integrations={state.integrations}
            onOpenCampaigns={() => controller.setActiveSection('campaigns')}
            onOpenSubscribers={() => controller.setActiveSection('subscribers')}
            onOpenSchedule={() => controller.setActiveSection('schedule')}
            onNewCampaign={async () => {
              const created = await controller.createCampaign('New campaign')
              if (created) {
                controller.setActiveSection('campaigns')
                setEditingCampaignId(created.id)
              }
            }}
            onEditCampaign={(id) => {
              controller.setActiveSection('campaigns')
              setEditingCampaignId(id)
            }}
            onCreateFromTemplate={async (templateId) => {
              const tpl = state.templates.find((t) => t.id === templateId)
              const name = tpl ? `${tpl.name} — campaign` : 'New campaign'
              const created = await controller.createCampaign(name, templateId)
              if (created) {
                controller.setActiveSection('campaigns')
                setEditingCampaignId(created.id)
              }
            }}
          />
        )
        break
      case 'subscribers':
        body = (
          <Subscribers
            controller={controller}
            subscribers={state.subscribers}
            tags={state.tags}
          />
        )
        break
      case 'templates':
        body = (
          <Templates
            controller={controller}
            templates={state.templates}
            onEditTemplate={(tpl) => setEditingTemplateId(tpl.id)}
            onStartCampaign={startCampaignFromTemplate}
          />
        )
        break
      case 'campaigns':
        body = (
          <Campaigns
            controller={controller}
            campaigns={state.campaigns}
            onEdit={(id) => setEditingCampaignId(id)}
          />
        )
        break
      case 'schedule':
        body = (
          <Schedule
            controller={controller}
            campaigns={state.campaigns}
            onEdit={(id) => {
              controller.setActiveSection('campaigns')
              setEditingCampaignId(id)
            }}
          />
        )
        break
      case 'settings':
        body = (
          <SettingsSection
            controller={controller}
            senderIdentity={state.senderIdentity}
            integrations={state.integrations}
          />
        )
        break
      default:
        body = null
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        minHeight: '100vh',
        background: 'var(--bg-primary)',
      }}
    >
      <Sidebar
        active={state.activeSection}
        onChange={(s) => {
          setEditingCampaignId(null)
          setEditingTemplateId(null)
          controller.setActiveSection(s)
        }}
        isMobile={isMobile}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        llmConnected={llmConnected}
        gmailConnected={gmailConnected}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: viewport.size === 'mobile' ? 'var(--space-3) var(--space-3) 80px' : 'var(--space-5)',
        }}
      >
        {state.loading ? (
          <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
        ) : state.error ? (
          <div style={{ color: 'var(--color-error)' }}>{state.error}</div>
        ) : (
          body
        )}
      </main>
    </div>
  )
}
