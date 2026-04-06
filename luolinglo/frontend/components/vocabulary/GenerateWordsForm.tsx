import React, { useState } from 'react'
import { Button, Select, Input, Card } from '../ui'
import { ApiService } from '../../services/ApiService'
import { toast } from 'react-toastify'
import { VOCABULARY_CATEGORIES } from '../../types'

interface GenerateWordsFormProps {
  onGenerated: () => void
}

export function GenerateWordsForm({ onGenerated }: GenerateWordsFormProps) {
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [difficulty, setDifficulty] = useState('beginner')
  const [count, setCount] = useState(10)
  const [loading, setLoading] = useState(false)

  const categoryOptions = [
    { value: '', label: 'Select a category' },
    ...VOCABULARY_CATEGORIES.map((cat) => ({ value: cat, label: cat })),
    { value: '__custom__', label: 'Custom...' },
  ]

  const difficultyOptions = [
    { value: 'beginner', label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'advanced', label: 'Advanced' },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const resolvedCategory = category === '__custom__' ? customCategory : category
    if (!resolvedCategory) {
      toast.error('Please select or enter a category')
      return
    }

    setLoading(true)
    try {
      await ApiService.generateVocabulary(resolvedCategory, difficulty, count)
      toast.success(`Generated ${count} words for "${resolvedCategory}"`)
      onGenerated()
    } catch {
      toast.error('Failed to generate vocabulary')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card padding="lg">
      <h3 style={{
        margin: '0 0 var(--space-4)',
        fontSize: 'var(--font-size-lg)',
        color: 'var(--text-primary)',
      }}>
        Generate Vocabulary
      </h3>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Select
          label="Category"
          options={categoryOptions}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Select a category"
        />

        {category === '__custom__' && (
          <Input
            label="Custom Category"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="Enter a custom category"
          />
        )}

        <Select
          label="Difficulty"
          options={difficultyOptions}
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
        />

        <Input
          label="Number of Words"
          type="number"
          min={5}
          max={20}
          value={String(count)}
          onChange={(e) => setCount(Math.min(20, Math.max(5, Number(e.target.value))))}
          hint="Between 5 and 20 words"
        />

        <Button type="submit" loading={loading} fullWidth>
          Generate
        </Button>
      </form>
    </Card>
  )
}
