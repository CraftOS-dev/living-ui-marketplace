import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView } from '../types'

interface QRCodeWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

export function QRCodeWidget({ navigate }: QRCodeWidgetProps) {
  const [text, setText] = useState('')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
        <div style={{
          width: 96, height: 96,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#fff',
          borderRadius: 'var(--radius-md)',
          padding: text ? 8 : 0,
        }}>
          {text ? (
            <QRCodeSVG value={text} size={80} />
          ) : (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-2)' }}>
              No content
            </span>
          )}
        </div>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Enter text or URL"
          aria-label="QR code content"
          style={{
            width: '100%',
            height: 'var(--input-height-sm)',
            fontSize: 'var(--font-size-xs)',
            padding: '0 var(--space-2)',
            textAlign: 'center',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
          }}
        />
      </div>

      <button
        onClick={() => navigate('qrcode')}
        style={{
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-primary)',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
          padding: 0,
        }}
      >
        Open QR code →
      </button>
    </div>
  )
}
