import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { DailyBriefing } from '../types'
import { Card, Button, EmptyState } from './ui'
import { Sparkles, RefreshCw } from 'lucide-react'
import { toast } from 'react-toastify'
import { formatBriefingContent } from '../lib/formatBriefing'

interface BriefingFullProps {
  controller: AppController
}

export function BriefingFull({ controller }: BriefingFullProps) {
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
      toast.success('Briefing generated')
    } catch {
      toast.error('Failed to generate briefing')
    } finally {
      setGenerating(false)
    }
  }

  const formatGenerated = (ts: string | null) => {
    if (!ts) return null
    return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Sparkles size={20} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Daily Briefing</h2>
        </div>
        <Button
          variant="primary"
          size="md"
          icon={<RefreshCw size={14} style={{ animation: generating ? 'spin 0.8s linear infinite' : 'none' }} />}
          loading={generating}
          onClick={generate}
        >
          {briefing?.content ? 'Regenerate' : 'Generate'}
        </Button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : !briefing?.content ? (
        <EmptyState
          icon={<Sparkles size={48} />}
          title="No briefing yet"
          message="Generate your daily briefing to get an AI-powered summary of your tasks, reminders, and weather."
          action={
            <Button variant="primary" icon={<Sparkles size={14} />} loading={generating} onClick={generate}>
              Generate Briefing
            </Button>
          }
        />
      ) : (
        <>
          {briefing.generatedAt && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              Generated {formatGenerated(briefing.generatedAt)}
            </div>
          )}
          <Card padding="lg">
            <div style={{
              fontSize: 'var(--font-size-base)',
              lineHeight: 'var(--line-height-relaxed)',
              color: 'var(--text-primary)',
            }}>
              {formatBriefingContent(briefing.content)}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
