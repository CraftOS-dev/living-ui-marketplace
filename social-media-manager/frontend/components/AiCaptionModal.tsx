import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Modal, Button, Input, Select, Textarea } from './ui'
import type { AppController } from '../AppController'
import type { Platform, CaptionTone } from '../types'

interface AiCaptionModalProps {
  open: boolean
  onClose: () => void
  platform: Platform
  controller: AppController
  onInsert: (text: string) => void
}

const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'professional', label: 'Professional' },
  { value: 'playful', label: 'Playful' },
  { value: 'persuasive', label: 'Persuasive' },
  { value: 'informative', label: 'Informative' },
]

export function AiCaptionModal({ open, onClose, platform, controller, onInsert }: AiCaptionModalProps) {
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState<CaptionTone>('casual')
  const [keywords, setKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!topic.trim()) return
    setLoading(true)
    setResult('')
    setError('')
    try {
      const kw = keywords.trim() ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : undefined
      const caption = await controller.generateCaption(platform, topic, tone, kw)
      if (caption) {
        setResult(caption)
        setError('')
      } else {
        setError('Bridge unavailable — connect CraftBot to generate captions')
        setResult('')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleInsert = () => {
    onInsert(result)
    onClose()
  }

  const handleClose = () => {
    setTopic('')
    setKeywords('')
    setResult('')
    setError('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="AI Caption Generator"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          {result && <Button variant="primary" onClick={handleInsert}>Insert</Button>}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Input
          label="Topic"
          placeholder="e.g. product launch, tips for remote work..."
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <Select
          label="Tone"
          options={TONE_OPTIONS}
          value={tone}
          onChange={(e) => setTone(e.target.value as CaptionTone)}
        />
        <Input
          label="Keywords (optional, comma-separated)"
          placeholder="e.g. innovation, growth, AI"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <Button
          variant="primary"
          fullWidth
          loading={loading}
          disabled={!topic.trim()}
          onClick={handleGenerate}
          icon={<Sparkles size={14} />}
        >
          Generate Caption
        </Button>
        {error && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{error}</div>
        )}
        {result && (
          <div>
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-muted)',
                marginBottom: 'var(--space-2)',
                fontWeight: 'var(--font-weight-medium)' as any,
              }}
            >
              Generated caption:
            </div>
            <Textarea
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={6}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
