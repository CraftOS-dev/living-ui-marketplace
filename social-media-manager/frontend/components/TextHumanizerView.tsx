import { useState, useEffect } from 'react'
import { Wand2, Copy, ArrowRight } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button, Card } from './ui'
import type { AppController } from '../AppController'
import type { AppState, Platform } from '../types'

interface Props {
  controller: AppController
  state: AppState
}

const PLATFORM_OPTIONS: { value: Platform; label: string; limit: number }[] = [
  { value: 'twitter', label: 'Twitter/X', limit: 280 },
  { value: 'linkedin', label: 'LinkedIn', limit: 3000 },
  { value: 'google_youtube', label: 'YouTube', limit: 10000 },
]

const TONES = ['professional', 'casual', 'playful', 'persuasive', 'informative']

export default function TextHumanizerView({ controller, state }: Props) {
  const prefilled = state.prefilledTool?.tool === 'humanizer' ? state.prefilledTool : null

  const [original, setOriginal] = useState(prefilled?.text || '')
  const [platform, setPlatform] = useState<Platform>(prefilled?.platform || 'linkedin')
  const [tone, setTone] = useState('casual')
  const [result, setResult] = useState('')
  const [originalLen, setOriginalLen] = useState(0)
  const [resultLen, setResultLen] = useState(0)
  const [loading, setLoading] = useState(false)

  const platformMeta = PLATFORM_OPTIONS.find(p => p.value === platform)!

  useEffect(() => {
    if (prefilled) {
      setOriginal(prefilled.text)
      setPlatform(prefilled.platform)
    }
  }, [state.prefilledTool])

  async function humanize() {
    if (!original.trim()) { toast.error('Enter some text first'); return }
    setLoading(true)
    setResult('')
    try {
      const res = await controller.humanizeText(original, platform, tone)
      if (!res || res.status === 'unavailable') {
        toast.warning('AI unavailable — check CraftBot bridge connection')
        return
      }
      if (res.status === 'error') {
        toast.error('Humanization failed — try again')
        return
      }
      setResult(res.result)
      setOriginalLen(res.originalLength)
      setResultLen(res.resultLength)
    } finally {
      setLoading(false)
    }
  }

  function copyResult() {
    navigator.clipboard.writeText(result)
    toast.success('Copied!')
  }

  function useInPost() {
    navigator.clipboard.writeText(result)
    toast.success('Copied! Switch to Compose and paste.')
    controller.setActiveSection('composer')
  }

  const overLimit = result.length > platformMeta.limit

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <Wand2 size={22} color="var(--color-primary)" />
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Text Humanizer</h1>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px' }}>
        Rewrite AI-generated text to sound authentic — varied sentence length, no AI vocabulary, clear stance.
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Platform</label>
          <select value={platform} onChange={e => setPlatform(e.target.value as Platform)}
            style={{ padding: '6px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '13px' }}>
            {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} ({o.limit} chars)</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Tone</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {TONES.map(t => (
              <button key={t} onClick={() => setTone(t)}
                style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: tone === t ? 'var(--color-primary)' : 'var(--border-color)', background: tone === t ? 'var(--color-primary)' : 'transparent', color: tone === t ? '#fff' : 'var(--text-secondary)' }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', alignItems: 'start' }}>
        <Card style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Original</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{original.length} chars</span>
          </div>
          <textarea
            value={original}
            onChange={e => setOriginal(e.target.value)}
            placeholder="Paste your AI-generated text here..."
            style={{
              width: '100%', minHeight: '280px', padding: '10px', background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)', fontSize: '14px', lineHeight: 1.6,
              resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '48px', gap: '8px' }}>
          <Button onClick={humanize} disabled={loading || !original.trim()}>
            {loading ? '...' : <><Wand2 size={15} /><ArrowRight size={15} /></>}
          </Button>
          {loading && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Humanizing...</span>}
        </div>

        <Card style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Humanized</span>
            {result && (
              <span style={{ fontSize: '11px', color: overLimit ? 'var(--color-danger, #dc2626)' : 'var(--text-muted)' }}>
                {result.length}/{platformMeta.limit}
              </span>
            )}
          </div>

          {!result && !loading && (
            <div style={{ minHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '8px' }}>
              <Wand2 size={32} style={{ opacity: 0.25 }} />
              <span style={{ fontSize: '13px' }}>Paste text and click Humanize</span>
            </div>
          )}

          {loading && (
            <div style={{ minHeight: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <span style={{ fontSize: '14px' }}>Rewriting...</span>
            </div>
          )}

          {result && !loading && (
            <>
              <div style={{
                minHeight: '280px', padding: '10px', background: 'var(--bg-primary)',
                border: `1px solid ${overLimit ? 'var(--color-danger, #dc2626)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-md)', fontSize: '14px', lineHeight: 1.6,
                color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {result}
              </div>
              {originalLen > 0 && (
                <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                  {originalLen} → {resultLen} chars
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <Button variant="ghost" size="sm" onClick={copyResult} style={{ flex: 1 }}>
                  <Copy size={13} /> Copy
                </Button>
                <Button variant="secondary" size="sm" onClick={useInPost} style={{ flex: 1 }}>
                  Use in Post
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
