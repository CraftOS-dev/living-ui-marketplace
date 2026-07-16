import { useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import type { AppController } from '../AppController'
import { Card, Button } from './ui'
import { QrCode, Download } from 'lucide-react'
import { toast } from 'react-toastify'

interface QRCodeFullProps {
  controller: AppController
}

export function QRCodeFull({}: QRCodeFullProps) {
  const [text, setText] = useState('')
  const canvasWrapperRef = useRef<HTMLDivElement>(null)

  function download() {
    const canvas = canvasWrapperRef.current?.querySelector('canvas')
    if (!canvas) {
      toast.error('Nothing to download yet')
      return
    }
    const url = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = url
    link.download = 'qrcode.png'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <QrCode size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>QR Code</h2>
      </div>

      <Card padding="lg" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
        <div
          ref={canvasWrapperRef}
          style={{
            width: 240, height: 240,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#fff',
            borderRadius: 'var(--radius-md)',
            padding: text ? 16 : 0,
          }}
        >
          {text ? (
            <QRCodeCanvas value={text} size={208} />
          ) : (
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-4)' }}>
              Enter text below to generate a QR code
            </span>
          )}
        </div>

        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Enter text or a URL"
          autoFocus
          style={{
            width: '100%',
            height: 'var(--input-height-lg)',
            padding: '0 var(--space-3)',
            fontSize: 'var(--font-size-base)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
          }}
        />

        <Button variant="secondary" icon={<Download size={14} />} onClick={download} disabled={!text}>
          Download PNG
        </Button>
      </Card>
    </div>
  )
}
