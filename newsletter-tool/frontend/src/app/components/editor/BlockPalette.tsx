import {
  FiAlignLeft,
  FiImage,
  FiMinus,
  FiMousePointer,
  FiPlus,
  FiSquare,
  FiType,
} from 'react-icons/fi'
import type { IconType } from 'react-icons'
import type { BlockType, EmailBlock } from '../../types'

interface BlockOption {
  type: BlockType
  label: string
  description: string
  icon: IconType
  make: () => EmailBlock
}

export const BLOCK_OPTIONS: BlockOption[] = [
  {
    type: 'heading',
    label: 'Heading',
    description: 'A bold title to anchor a section.',
    icon: FiType,
    make: () => ({ type: 'heading', text: 'Your headline here', level: 2 }),
  },
  {
    type: 'text',
    label: 'Text',
    description: 'A paragraph of body text. Supports {firstName}.',
    icon: FiAlignLeft,
    make: () => ({ type: 'text', text: 'Your paragraph text here.' }),
  },
  {
    type: 'button',
    label: 'Button',
    description: 'A clear call-to-action button.',
    icon: FiMousePointer,
    make: () => ({ type: 'button', label: 'Click here', url: 'https://example.com' }),
  },
  {
    type: 'image',
    label: 'Image',
    description: 'Inline image with a public URL.',
    icon: FiImage,
    make: () => ({ type: 'image', url: '', alt: '' }),
  },
  {
    type: 'divider',
    label: 'Divider',
    description: 'A thin horizontal line between sections.',
    icon: FiMinus,
    make: () => ({ type: 'divider' }),
  },
  {
    type: 'spacer',
    label: 'Spacer',
    description: 'Vertical whitespace.',
    icon: FiSquare,
    make: () => ({ type: 'spacer', height: 24 }),
  },
]

interface BlockPaletteProps {
  onAdd: (block: EmailBlock) => void
}

export function BlockPalette({ onAdd }: BlockPaletteProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      {BLOCK_OPTIONS.map((opt) => {
        const Icon = opt.icon
        return (
          <button
            key={opt.type}
            type="button"
            onClick={() => onAdd(opt.make())}
            title={opt.description}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: 'transparent',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              transition: 'var(--transition-fast)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-tertiary)'
              e.currentTarget.style.borderColor = 'var(--border-secondary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.borderColor = 'var(--border-primary)'
            }}
          >
            <Icon size={14} style={{ color: 'var(--text-secondary)' }} />
            <span>{opt.label}</span>
            <FiPlus size={10} style={{ opacity: 0.5, marginLeft: 'auto' }} />
          </button>
        )
      })}
    </div>
  )
}
