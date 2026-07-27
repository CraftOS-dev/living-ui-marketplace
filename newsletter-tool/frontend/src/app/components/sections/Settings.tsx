import { useEffect, useMemo, useState } from 'react'
import {
  FiCheckCircle,
  FiCopy,
  FiMail,
  FiRefreshCw,
  FiSave,
  FiXCircle,
  FiZap,
} from 'react-icons/fi'
import type { IconType } from 'react-icons'
import { toast } from 'react-toastify'
import { Alert, Button, Card, Input } from '../ui'
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
  const [trackingUrl, setTrackingUrl] = useState('')

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
    setTrackingUrl(senderIdentity.trackingBaseUrl)
  }, [senderIdentity])

  useAgentAware('Settings', {
    hasFromEmail: !!fromEmail,
    gmailConnected: integrations?.gmail.connected || false,
    llmConnected: integrations?.llm.connected || false,
  })

  async function save() {
    await controller.saveSenderIdentity({
      fromName,
      fromEmail,
      replyTo,
      organizationName: orgName,
      organizationAddress: orgAddress,
      trackingBaseUrl: trackingUrl,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Settings</h1>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          How your emails are sent, and what your subscribers see in their inbox.
        </p>
      </div>

      <Card padding="lg">
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          Integrations
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <IntegrationRow
            icon={FiMail}
            name="Gmail send"
            connected={integrations?.gmail.connected || false}
            help={
              integrations?.gmail.connected
                ? 'Connected via CraftBot. Real campaign sends go through your Gmail account.'
                : 'Connect Gmail in CraftBot settings to enable real sending. Campaigns will fail until this is connected.'
            }
          />
          <IntegrationRow
            icon={FiZap}
            name="AI writer"
            connected={integrations?.llm.connected || false}
            help={
              integrations?.llm.connected
                ? 'Connected. AI generation uses your configured LLM provider.'
                : 'Add an LLM API key in CraftBot settings for real AI generation. A deterministic starter draft is provided when offline.'
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

      <Card padding="lg">
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          Tracking
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Public backend URL"
            type="url"
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            placeholder="https://your-domain.com"
            hint="Open/click tracking, unsubscribe links, and the signup-form embed all use this URL. Must be reachable from your subscribers' email clients and from any website that embeds the form."
          />
          {!trackingUrl && (
            <Alert variant="info" title="Tracking is off">
              Set a public URL above to record opens, clicks, and one-click unsubscribes.
              When this is empty, emails still send but stats stay at zero — and the signup form embed below won't work.
            </Alert>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" icon={<FiSave size={14} />} onClick={save}>
          Save settings
        </Button>
      </div>

      <SignupEmbedCard
        controller={controller}
        trackingUrl={senderIdentity?.trackingBaseUrl || ''}
        subscribeKey={senderIdentity?.subscribeKey || ''}
      />
    </div>
  )
}

function SignupEmbedCard({
  controller,
  trackingUrl,
  subscribeKey,
}: {
  controller: AppController
  trackingUrl: string
  subscribeKey: string
}) {
  const cleanUrl = trackingUrl.replace(/\/+$/, '')
  const endpoint = cleanUrl ? `${cleanUrl}/api/subscribe` : '(set Public backend URL above)'

  const htmlSnippet = useMemo(() => {
    const url = cleanUrl ? `${cleanUrl}/api/subscribe` : 'https://YOUR-PUBLIC-URL/api/subscribe'
    return `<form id="newsletter-form" style="display:flex;gap:8px;max-width:480px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <input type="email" name="email" placeholder="you@example.com" required
    style="flex:1;padding:10px 14px;border:1px solid #d4d4d4;border-radius:6px;font-size:14px;">
  <button type="submit"
    style="padding:10px 18px;background:#FF4F18;color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer;font-size:14px;">
    Subscribe
  </button>
</form>
<div id="newsletter-message" style="margin-top:8px;font-size:13px;"></div>
<script>
(function(){
  var form = document.getElementById('newsletter-form');
  var msg = document.getElementById('newsletter-message');
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var email = form.email.value;
    fetch(${JSON.stringify(url)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        key: ${JSON.stringify(subscribeKey)},
        source: 'website'
      })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.status === 'subscribed' || d.status === 'resubscribed') {
        msg.textContent = "Thanks — you're on the list.";
        msg.style.color = '#22C55E';
        form.reset();
      } else if (d.status === 'already_subscribed') {
        msg.textContent = "You're already subscribed 👋";
        msg.style.color = '#737373';
      } else {
        msg.textContent = d.message || 'Could not subscribe.';
        msg.style.color = '#EF4444';
      }
    })
    .catch(function(){
      msg.textContent = 'Network error. Try again.';
      msg.style.color = '#EF4444';
    });
  });
})();
</script>`
  }, [cleanUrl, subscribeKey])

  const curlSnippet = useMemo(() => {
    const url = cleanUrl ? `${cleanUrl}/api/subscribe` : 'https://YOUR-PUBLIC-URL/api/subscribe'
    return `curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -d '{"email":"alice@example.com","first_name":"Alice","key":"${subscribeKey || 'YOUR_KEY'}"}'`
  }, [cleanUrl, subscribeKey])

  function copy(value: string, label: string) {
    if (!navigator.clipboard) {
      toast.info('Clipboard not available — copy manually.')
      return
    }
    navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error('Copy failed'),
    )
  }

  return (
    <Card padding="lg">
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 8 }}>
        Signup form embed
      </h2>
      <p
        style={{
          margin: 0,
          marginBottom: 'var(--space-3)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-secondary)',
        }}
      >
        Drop this form on your website. When someone submits their email, they're added straight to your subscribers list.
      </p>

      {!cleanUrl && (
        <Alert variant="warning" title="Set a public URL first">
          The embed only works once you've set <strong>Public backend URL</strong> in the Tracking section above and saved.
        </Alert>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: cleanUrl ? 0 : 'var(--space-3)' }}>
        <FieldWithCopy
          label="Endpoint"
          value={endpoint}
          copyValue={cleanUrl ? `${cleanUrl}/api/subscribe` : ''}
          onCopy={() => copy(`${cleanUrl}/api/subscribe`, 'Endpoint URL')}
          disabled={!cleanUrl}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            Subscribe key
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <code
              style={{
                flex: 1,
                padding: '8px 10px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 12,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-primary)',
              }}
            >
              {subscribeKey || '—'}
            </code>
            <Button
              size="sm"
              variant="secondary"
              icon={<FiCopy size={12} />}
              onClick={() => copy(subscribeKey, 'Subscribe key')}
              disabled={!subscribeKey}
            >
              Copy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<FiRefreshCw size={12} />}
              onClick={async () => {
                if (
                  window.confirm(
                    'Rotate the key? Any existing signup form on your site will stop working until you re-copy the snippet.',
                  )
                ) {
                  await controller.rotateSubscribeKey()
                }
              }}
            >
              Rotate
            </Button>
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            Stops random POSTs from showing up in your list. Re-copy the embed after rotating.
          </div>
        </div>

        <CodeBlock
          label="HTML embed"
          code={htmlSnippet}
          onCopy={() => copy(htmlSnippet, 'Embed snippet')}
        />

        <CodeBlock
          label="From a script / backend"
          code={curlSnippet}
          onCopy={() => copy(curlSnippet, 'curl example')}
        />
      </div>
    </Card>
  )
}

function FieldWithCopy({
  label,
  value,
  copyValue,
  onCopy,
  disabled,
}: {
  label: string
  value: string
  copyValue: string
  onCopy: () => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 500,
          color: 'var(--text-primary)',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <code
          style={{
            flex: 1,
            padding: '8px 10px',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
          }}
        >
          {value}
        </code>
        <Button
          size="sm"
          variant="secondary"
          icon={<FiCopy size={12} />}
          onClick={onCopy}
          disabled={disabled || !copyValue}
        >
          Copy
        </Button>
      </div>
    </div>
  )
}

function CodeBlock({
  label,
  code,
  onCopy,
}: {
  label: string
  code: string
  onCopy: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 500,
            color: 'var(--text-primary)',
          }}
        >
          {label}
        </span>
        <Button size="sm" variant="ghost" icon={<FiCopy size={12} />} onClick={onCopy}>
          Copy
        </Button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 'var(--space-3)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 12,
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 6,
          color: 'var(--text-primary)',
          overflowX: 'auto',
          maxHeight: 280,
          overflowY: 'auto',
          whiteSpace: 'pre',
          lineHeight: 1.5,
        }}
      >
        {code}
      </pre>
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
