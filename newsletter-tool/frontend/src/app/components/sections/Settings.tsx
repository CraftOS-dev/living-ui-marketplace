import { useEffect, useState } from 'react'
import {
  FiCheckCircle,
  FiMail,
  FiSave,
  FiXCircle,
  FiZap,
} from 'react-icons/fi'
import type { IconType } from 'react-icons'
import { Button, Card, Input } from '../ui'
import { useAgentAware } from '../../agent/hooks'
import type { AppController } from '../../AppController'
import type { IntegrationsStatus, SenderIdentity } from '../../types'

interface SettingsProps {
  controller: AppController
  senderIdentity: SenderIdentity | null
  integrations: IntegrationsStatus | null
}

export function Settings({ controller, senderIdentity, integrations }: SettingsProps) {
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [orgName, setOrgName] = useState('')
  const [orgAddress, setOrgAddress] = useState('')

  useEffect(() => {
    controller.refreshSenderIdentity()
    controller.refreshIntegrations()
  }, [controller])

  useEffect(() => {
    if (!senderIdentity) return
    setFromName(senderIdentity.fromName)
    setFromEmail(senderIdentity.fromEmail)
    setReplyTo(senderIdentity.replyTo)
    setOrgName(senderIdentity.organizationName)
    setOrgAddress(senderIdentity.organizationAddress)
  }, [senderIdentity])

  useAgentAware('Settings', {
    hasFromEmail: !!fromEmail,
    llmConnected: integrations?.llm.connected || false,
  })

  async function save() {
    await controller.saveSenderIdentity({
      fromName,
      fromEmail,
      replyTo,
      organizationName: orgName,
      organizationAddress: orgAddress,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Settings</h1>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          Who your campaigns come from, the footer every email carries, and what's connected.
        </p>
      </div>

      <Card padding="lg">
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          Integrations
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <IntegrationRow
            icon={FiMail}
            name="Email delivery"
            connected={false}
            help="No email leaves this app. Send and scheduled sends record the campaign and its audience; mail it from your own email service, or ask your AI agent to send it."
          />
          <IntegrationRow
            icon={FiZap}
            name="AI writer"
            connected={integrations?.llm.connected || false}
            help={
              integrations?.llm.connected
                ? "Connected. AI drafts use the connected agent's language model."
                : "Connect an AI agent to this app (CraftBot, or any agent harness running the app's bridge) for AI drafts. Until then, the AI writer gives a starter draft."
            }
          />
        </div>
      </Card>

      <Card padding="lg">
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          Sender identity
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: '1fr 1fr' }}>
            <Input label="From name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your team name" />
            <Input label="From email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="you@your-domain.com" />
          </div>
          <Input
            label="Reply-to (optional)"
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="support@your-domain.com"
            hint="Where replies are routed."
          />
        </div>
      </Card>

      <Card padding="lg">
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          Footer (CAN-SPAM)
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            hint="Appears in the footer of every email."
          />
          <Input
            label="Mailing address"
            value={orgAddress}
            onChange={(e) => setOrgAddress(e.target.value)}
            hint="Required by anti-spam laws in most countries."
          />
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" icon={<FiSave size={14} />} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  )
}

function IntegrationRow({
  icon: Icon,
  name,
  connected,
  help,
}: {
  icon: IconType
  name: string
  connected: boolean
  help: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: connected ? 'var(--color-success-light)' : 'var(--bg-tertiary)',
          color: connected ? 'var(--color-success)' : 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={16} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {name}
          {connected ? (
            <FiCheckCircle size={14} color="var(--color-success)" />
          ) : (
            <FiXCircle size={14} color="var(--text-muted)" />
          )}
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
          {help}
        </div>
      </div>
    </div>
  )
}
