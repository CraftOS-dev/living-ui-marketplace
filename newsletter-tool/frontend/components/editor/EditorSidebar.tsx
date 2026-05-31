/**
 * Left sidebar for the campaign editor.
 *
 * Two stacked sections:
 *   1. Add blocks — vertical palette, click to append a block.
 *   2. Design — global design controls (background, default text/heading/button
 *      colors, font family).
 *
 * Style note: this is the only place where light/dark themed inputs sit next
 * to the WYSIWYG canvas (which is always light). The sidebar follows the rest
 * of the app's tokens so it picks up dark/light theme automatically.
 */

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
import type { BlockType, CampaignDesign, EmailBlock } from '../../types'

interface PaletteEntry {
  type: BlockType
  label: string
  description: string
  icon: IconType
  make: () => EmailBlock
}

const PALETTE: PaletteEntry[] = [
  {
    type: 'heading',
    label: 'Heading',
    description: 'A bold title.',
    icon: FiType,
    make: () => ({ type: 'heading', text: 'Your headline here', level: 2 }),
  },
  {
    type: 'text',
    label: 'Text',
    description: 'Paragraph body text.',
    icon: FiAlignLeft,
    make: () => ({ type: 'text', text: 'Write your paragraph here.' }),
  },
  {
    type: 'button',
    label: 'Button',
    description: 'Call-to-action button.',
    icon: FiMousePointer,
    make: () => ({ type: 'button', label: 'Click here', url: 'https://example.com' }),
  },
  {
    type: 'image',
    label: 'Image',
    description: 'Inline image with a URL.',
    icon: FiImage,
    make: () => ({ type: 'image', url: '', alt: '' }),
  },
  {
    type: 'divider',
    label: 'Divider',
    description: 'Horizontal rule.',
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

const BG_PALETTE = ['#FFFFFF', '#F5F5F5', '#FAFAFA', '#171717', '#FF4F18', '#FFF7ED']
const TEXT_PALETTE = ['#171717', '#525252', '#A3A3A3', '#FFFFFF', '#FF4F18', '#3B82F6']
const BUTTON_BG_PALETTE = ['#FF4F18', '#171717', '#525252', '#22C55E', '#3B82F6', '#FFFFFF']
const FONT_OPTIONS: { value: 'system' | 'serif' | 'mono'; label: string; preview: string }[] = [
  { value: 'system', label: 'Sans', preview: 'Aa' },
  { value: 'serif', label: 'Serif', preview: 'Aa' },
  { value: 'mono', label: 'Mono', preview: 'Aa' },
]

interface EditorSidebarProps {
  design: CampaignDesign
  onChangeDesign: (next: CampaignDesign) => void
  onAddBlock: (block: EmailBlock) => void
  readonly?: boolean
}

export function EditorSidebar({
  design,
  onChangeDesign,
  onAddBlock,
  readonly,
}: EditorSidebarProps) {
  const setDesign = (patch: Partial<CampaignDesign>) =>
    onChangeDesign({ ...design, ...patch })

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
        padding: 'var(--space-4)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)',
        position: 'sticky',
        top: 'var(--space-3)',
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - var(--space-5) * 2)',
        overflowY: 'auto',
      }}
    >
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <SectionLabel>Add blocks</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {PALETTE.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.type}
                type="button"
                disabled={readonly}
                onClick={() => onAddBlock(entry.make())}
                title={entry.description}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr auto',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  background: 'transparent',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 6,
                  cursor: readonly ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  transition: 'var(--transition-fast)',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (readonly) return
                  e.currentTarget.style.background = 'var(--bg-tertiary)'
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Icon size={14} style={{ color: 'var(--text-secondary)' }} />
                <span style={{ fontWeight: 500 }}>{entry.label}</span>
                <FiPlus size={11} style={{ opacity: 0.5 }} />
              </button>
            )
          })}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionLabel>Design</SectionLabel>

        <DesignColor
          label="Background"
          value={design.emailBg || '#F5F5F5'}
          palette={BG_PALETTE}
          onChange={(emailBg) => setDesign({ emailBg })}
          disabled={readonly}
        />
        <DesignColor
          label="Card"
          value={design.cardBg || '#FFFFFF'}
          palette={BG_PALETTE}
          onChange={(cardBg) => setDesign({ cardBg })}
          disabled={readonly}
        />
        <DesignColor
          label="Text"
          value={design.textColor || '#262626'}
          palette={TEXT_PALETTE}
          onChange={(textColor) => setDesign({ textColor })}
          disabled={readonly}
        />
        <DesignColor
          label="Heading"
          value={design.headingColor || '#171717'}
          palette={TEXT_PALETTE}
          onChange={(headingColor) => setDesign({ headingColor })}
          disabled={readonly}
        />
        <DesignColor
          label="Button"
          value={design.buttonBg || '#FF4F18'}
          palette={BUTTON_BG_PALETTE}
          onChange={(buttonBg) => setDesign({ buttonBg })}
          disabled={readonly}
        />
        <DesignColor
          label="Button text"
          value={design.buttonTextColor || '#FFFFFF'}
          palette={['#FFFFFF', '#171717']}
          onChange={(buttonTextColor) => setDesign({ buttonTextColor })}
          disabled={readonly}
        />

        <FontFamilyControl
          value={design.fontFamily || 'system'}
          onChange={(fontFamily) => setDesign({ fontFamily })}
          disabled={readonly}
        />
      </section>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        fontWeight: 600,
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </span>
  )
}

function DesignColor({
  label,
  value,
  palette,
  onChange,
  disabled,
}: {
  label: string
  value: string
  palette: string[]
  onChange: (c: string) => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-secondary)',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {palette.map((c) => {
          const active = value.toLowerCase() === c.toLowerCase()
          return (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => onChange(c)}
              title={c}
              aria-label={`Set ${label} to ${c}`}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                border: active
                  ? '2px solid var(--text-primary)'
                  : '1px solid var(--border-primary)',
                background: c,
                cursor: disabled ? 'not-allowed' : 'pointer',
                padding: 0,
              }}
            />
          )
        })}
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          title="Custom color"
          style={{
            width: 24,
            height: 24,
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      </div>
    </div>
  )
}

function FontFamilyControl({
  value,
  onChange,
  disabled,
}: {
  value: 'system' | 'serif' | 'mono'
  onChange: (v: 'system' | 'serif' | 'mono') => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-secondary)',
        }}
      >
        Font family
      </span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 4,
        }}
      >
        {FONT_OPTIONS.map((opt) => {
          const active = value === opt.value
          const fontFamily =
            opt.value === 'serif'
              ? "Georgia,'Times New Roman',serif"
              : opt.value === 'mono'
              ? "'JetBrains Mono','Fira Code',monospace"
              : 'inherit'
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              title={opt.label}
              style={{
                padding: '6px 4px',
                background: active ? 'var(--text-primary)' : 'transparent',
                color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
                border: active
                  ? '1px solid var(--text-primary)'
                  : '1px solid var(--border-primary)',
                borderRadius: 6,
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontFamily, fontSize: 16, fontWeight: 700 }}>{opt.preview}</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
