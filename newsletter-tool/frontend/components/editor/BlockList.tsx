import { useState } from 'react'
import {
  FiArrowDown,
  FiArrowUp,
  FiMove,
  FiTrash2,
} from 'react-icons/fi'
import { Input, Select, Textarea } from '../ui'
import type {
  ButtonBlock,
  EmailBlock,
  HeadingBlock,
  ImageBlock,
  SpacerBlock,
  TextBlock,
} from '../../types'

interface BlockListProps {
  blocks: EmailBlock[]
  onChange: (blocks: EmailBlock[]) => void
}

export function BlockList({ blocks, onChange }: BlockListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  function moveBlock(from: number, to: number) {
    if (from === to) return
    const next = blocks.slice()
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  function updateBlock(index: number, patch: Partial<EmailBlock>) {
    const next = blocks.slice()
    next[index] = { ...next[index], ...patch } as EmailBlock
    onChange(next)
  }

  function removeBlock(index: number) {
    const next = blocks.slice()
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {blocks.map((block, i) => (
        <div
          key={i}
          onDragOver={(e) => {
            if (dragIndex === null) return
            e.preventDefault()
            setDropTarget(i)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragIndex === null) return
            moveBlock(dragIndex, i)
            setDragIndex(null)
            setDropTarget(null)
          }}
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 12,
            alignItems: 'flex-start',
            padding: '12px',
            border: '1px solid transparent',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            boxShadow:
              dropTarget === i
                ? 'inset 0 0 0 2px var(--color-primary)'
                : 'none',
            transition: 'var(--transition-fast)',
          }}
          onMouseEnter={(e) => {
            if (dropTarget === i) return
            e.currentTarget.style.background = 'var(--bg-secondary)'
            e.currentTarget.style.borderColor = 'var(--border-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = 'transparent'
          }}
        >
          <span
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => {
              setDragIndex(null)
              setDropTarget(null)
            }}
            title={`${block.type} — drag to reorder`}
            style={{
              cursor: 'grab',
              color: 'var(--text-muted)',
              userSelect: 'none',
              padding: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 'var(--font-size-xs)',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              fontWeight: 600,
              marginTop: 4,
              minWidth: 64,
            }}
          >
            <FiMove size={12} />
            <span>{block.type}</span>
          </span>
          <div style={{ minWidth: 0 }}>
            <BlockEditor block={block} onChange={(patch) => updateBlock(i, patch)} />
          </div>
          <div style={{ display: 'inline-flex', gap: 2, marginTop: 2 }}>
            <button
              type="button"
              disabled={i === 0}
              onClick={() => moveBlock(i, i - 1)}
              aria-label="Move up"
              style={iconBtnStyle}
            >
              <FiArrowUp size={12} />
            </button>
            <button
              type="button"
              disabled={i === blocks.length - 1}
              onClick={() => moveBlock(i, i + 1)}
              aria-label="Move down"
              style={iconBtnStyle}
            >
              <FiArrowDown size={12} />
            </button>
            <button
              type="button"
              onClick={() => removeBlock(i)}
              aria-label="Remove block"
              style={{ ...iconBtnStyle, color: 'var(--color-error)' }}
            >
              <FiTrash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  borderRadius: 4,
  padding: 4,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

function BlockEditor({
  block,
  onChange,
}: {
  block: EmailBlock
  onChange: (patch: Partial<EmailBlock>) => void
}) {
  switch (block.type) {
    case 'heading': {
      const h = block as HeadingBlock
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Input
            value={h.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Your headline"
          />
          <Select
            value={String(h.level || 1)}
            onChange={(e) => onChange({ level: Number(e.target.value) as 1 | 2 | 3 })}
            options={[
              { value: '1', label: 'Heading 1 (largest)' },
              { value: '2', label: 'Heading 2' },
              { value: '3', label: 'Heading 3 (smallest)' },
            ]}
          />
        </div>
      )
    }
    case 'text': {
      const t = block as TextBlock
      return (
        <Textarea
          value={t.text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={4}
          hint="Use {firstName}, {lastName}, {email}, {unsubscribeUrl} for per-recipient values."
        />
      )
    }
    case 'button': {
      const b = block as ButtonBlock
      return (
        <div style={{ display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: '1fr 1fr' }}>
          <Input
            label="Label"
            value={b.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Read more"
          />
          <Input
            label="URL"
            type="url"
            value={b.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://example.com"
          />
        </div>
      )
    }
    case 'image': {
      const img = block as ImageBlock
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Input
            label="Image URL"
            type="url"
            value={img.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://…/image.jpg"
          />
          <Input
            label="Alt text"
            value={img.alt || ''}
            onChange={(e) => onChange({ alt: e.target.value })}
            placeholder="Short description for screen readers"
          />
          {img.url && (
            <img
              src={img.url}
              alt={img.alt || ''}
              style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 4, marginTop: 4 }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          )}
        </div>
      )
    }
    case 'divider':
      return (
        <div style={{ borderTop: '1px solid var(--border-primary)', padding: '8px 0', color: 'var(--text-muted)', textAlign: 'center', fontSize: 'var(--font-size-xs)' }}>
          Renders as a horizontal divider in the email.
        </div>
      )
    case 'spacer': {
      const s = block as SpacerBlock
      return (
        <Input
          label="Height (px)"
          type="number"
          min={4}
          max={128}
          value={s.height ?? 24}
          onChange={(e) => onChange({ height: Number(e.target.value) || 24 })}
        />
      )
    }
    default:
      return <div style={{ color: 'var(--text-muted)' }}>Unknown block type</div>
  }
}
