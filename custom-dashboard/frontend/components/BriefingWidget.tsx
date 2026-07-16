import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, DailyBriefing } from '../types'
import { Sparkles, RefreshCw } from 'lucide-react'
import { EmptyState, Button } from './ui'
import { toast } from 'react-toastify'

interface BriefingWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

export function BriefingWidget({ controller, navigate }: BriefingWidgetProps) {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    controller.getBriefing().then(setBriefing).catch(() => {}).finally(() => setLoading(false))
  }, [controller])

  const generate = async () => {
    setGenerating(true)
    try {
      const b = await controller.generateBriefing()
      setBriefing(b)
    } catch {
      toast.error('Failed to generate briefing')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  if (!briefing?.content) {
    return (
      <EmptyState
        message="No briefing generated yet"
        action={
          <Button size="sm" icon={<Sparkles size={14} />} loading={generating} onClick={generate}>
            Generate
          </Button>
        }
      />
    )
  }

  const preview = briefing.content.slice(0, 150) + (briefing.content.length > 150 ? '…' : '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{
        flex: 1,
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-secondary)',
        lineHeight: 'var(--line-height-relaxed)',
        whiteSpace: 'pre-line',
        display: '-webkit-box',
        WebkitLineClamp: 4,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      } as any}>
        {preview}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 'var(--space-2)' }}>
        <button
          onClick={() => navigate('briefing')}
          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Read more →
        </button>
        <button
          onClick={generate}
          disabled={generating}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', display: 'flex', padding: 'var(--space-1)' }}
          title="Regenerate"
        >
          <RefreshCw size={12} style={{ animation: generating ? 'spin 0.8s linear infinite' : 'none' }} />
        </button>
      </div>
    </div>
  )
}
