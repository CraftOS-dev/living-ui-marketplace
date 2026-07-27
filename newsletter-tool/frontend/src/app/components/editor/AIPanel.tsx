import { useState } from 'react'
import { FiZap } from 'react-icons/fi'
import { Alert, Button, Select, Textarea, Input } from '../ui'
import type { AppController } from '../../AppController'
import type { AIGenerationResult, EmailTone } from '../../types'

interface AIPanelProps {
  controller: AppController
  llmConnected: boolean
  onApply: (result: AIGenerationResult) => void
}

const TONE_OPTIONS: { value: EmailTone; label: string }[] = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'playful', label: 'Playful' },
  { value: 'concise', label: 'Concise' },
  { value: 'warm', label: 'Warm' },
  { value: 'persuasive', label: 'Persuasive' },
]

export function AIPanel({ controller, llmConnected, onApply }: AIPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [tone, setTone] = useState<EmailTone>('friendly')
  const [audience, setAudience] = useState('')
  const [loading, setLoading] = useState(false)

  async function generate() {
    if (!prompt.trim()) return
    setLoading(true)
    try {
      const result = await controller.generateCopy(prompt.trim(), tone, audience.trim() || undefined)
      onApply(result)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {!llmConnected && (
        <Alert variant="info" title="LLM not connected">
          Set an API key in CraftBot to get real AI generation. You'll still get a
          well-formed starter draft so you can keep working.
        </Alert>
      )}
      <Textarea
        label="What's this email about?"
        rows={4}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. We're announcing 25% off premium plans for the next 48 hours"
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
        <Select
          label="Tone"
          value={tone}
          onChange={(e) => setTone(e.target.value as EmailTone)}
          options={TONE_OPTIONS}
        />
        <Input
          label="Audience (optional)"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. early customers, free-tier users"
        />
      </div>
      <Button
        variant="primary"
        icon={<FiZap size={14} />}
        loading={loading}
        disabled={!prompt.trim()}
        onClick={generate}
        fullWidth
      >
        {llmConnected ? 'Generate with AI' : 'Generate starter draft'}
      </Button>
      <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
        Applying replaces the current subject, preheader, and body blocks.
      </p>
    </div>
  )
}
