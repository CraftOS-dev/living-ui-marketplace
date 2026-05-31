/**
 * WYSIWYG email canvas — Notion-style sortable blocks via @dnd-kit.
 *
 * Behavior:
 *  - Each block has a hover-only six-dot drag handle on its LEFT edge.
 *  - Drag overlay is a faded clone of the block (no shadow, no tilt). The
 *    source slot stays in place but goes mostly transparent so the
 *    displacement of neighbors is what you see.
 *  - Orange drop-indicator line shows the insertion point.
 *  - Click on a block: edits text in place (no chrome around the block).
 *  - **Right-click on a block: opens a context menu** with move up / down /
 *    delete + design controls (align, color, size, etc.). Click outside or
 *    press Escape to close.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  FiAlignCenter,
  FiAlignLeft,
  FiAlignRight,
  FiArrowDown,
  FiArrowUp,
  FiCheck,
  FiMaximize2,
  FiMinimize2,
  FiTrash2,
  FiUpload,
} from 'react-icons/fi'
import { RxDragHandleDots2 } from 'react-icons/rx'
import type {
  BlockAlign,
  ButtonBlock,
  CampaignDesign,
  DividerBlock,
  EmailBlock,
  HeadingBlock,
  ImageBlock,
  ImageWidth,
  SpacerBlock,
  TextBlock,
  TextSize,
} from '../../types'

interface CampaignCanvasProps {
  blocks: EmailBlock[]
  design: CampaignDesign
  onChange: (blocks: EmailBlock[]) => void
  readonly?: boolean
}

const CARD_WIDTH = 600

const TEXT_PALETTE = ['#171717', '#525252', '#A3A3A3', '#FF4F18', '#22C55E', '#3B82F6']
const BUTTON_BG_PALETTE = ['#FF4F18', '#171717', '#525252', '#22C55E', '#3B82F6', '#FFFFFF']
const BUTTON_FG_PALETTE = ['#FFFFFF', '#171717']
const DIVIDER_PALETTE = ['#EAEAEA', '#A3A3A3', '#525252', '#FF4F18']

const TEXT_SIZE_PX: Record<TextSize, number> = { small: 14, normal: 16, large: 18 }
const IMAGE_WIDTH_CSS: Record<ImageWidth, string> = {
  small: '240px',
  medium: '400px',
  full: '100%',
}

const FONT_FAMILY_MAP = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
} as const

interface ContextMenuState {
  blockIdx: number
  x: number
  y: number
}

// ===========================================================================

export function CampaignCanvas({ blocks, design, onChange, readonly }: CampaignCanvasProps) {
  const idPrefix = useId()
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const items = blocks.map((_, i) => `${idPrefix}-${i}`)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Close the menu on outside click + Escape
  useEffect(() => {
    if (!menu) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [menu])

  const emailBg = design.emailBg || '#F5F5F5'
  const cardBg = design.cardBg || '#FFFFFF'
  const fontFamily = FONT_FAMILY_MAP[design.fontFamily || 'system']
  const defaultTextColor = design.textColor || '#262626'

  function handleUpdate(i: number, patch: Partial<EmailBlock>) {
    const next = blocks.slice()
    next[i] = { ...next[i], ...patch } as EmailBlock
    onChange(next)
  }

  function handleRemove(i: number) {
    const next = blocks.slice()
    next.splice(i, 1)
    onChange(next)
    setMenu(null)
  }

  function handleMove(from: number, to: number) {
    if (from === to || to < 0 || to >= blocks.length) return
    const next = arrayMove(blocks, from, to)
    onChange(next)
  }

  function openMenu(idx: number, e: React.MouseEvent) {
    // Don't suppress text editing — textareas stopPropagation already, so this
    // only fires when the click is on the block surround / image / divider /
    // spacer / button background.
    e.preventDefault()
    e.stopPropagation()
    setMenu({ blockIdx: idx, x: e.clientX, y: e.clientY })
  }

  function onDragStart(e: DragStartEvent) {
    const idx = items.indexOf(String(e.active.id))
    if (idx >= 0) setActiveIdx(idx)
    setMenu(null)
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveIdx(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = items.indexOf(String(active.id))
    const to = items.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    handleMove(from, to)
  }

  const activeBlock = activeIdx !== null ? blocks[activeIdx] : null
  const menuBlock = menu !== null ? blocks[menu.blockIdx] : null

  return (
    <div
      ref={canvasRef}
      style={{
        background: emailBg,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5) var(--space-3)',
        minHeight: 400,
        transition: 'background 200ms ease',
      }}
    >
      <div
        style={{
          maxWidth: CARD_WIDTH,
          margin: '0 auto',
          background: cardBg,
          borderRadius: 12,
          padding: '32px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          color: defaultTextColor,
          fontFamily,
          transition: 'background 200ms ease, color 200ms ease',
        }}
      >
        {blocks.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: '#A3A3A3',
              padding: '32px 16px',
              border: '1px dashed #EAEAEA',
              borderRadius: 8,
            }}
          >
            Empty email. Pick a block from the left sidebar to start.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveIdx(null)}
          >
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {blocks.map((block, i) => (
                  <SortableBlock
                    key={items[i]}
                    id={items[i]}
                    block={block}
                    design={design}
                    readonly={readonly}
                    highlighted={menu?.blockIdx === i}
                    onUpdate={(patch) => handleUpdate(i, patch)}
                    onOpenMenu={(e) => openMenu(i, e)}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }}>
              {activeBlock ? (
                <div
                  style={{
                    background: cardBg,
                    padding: '4px',
                    color: defaultTextColor,
                    fontFamily,
                    width: '100%',
                    maxWidth: CARD_WIDTH - 32,
                    opacity: 0.6,
                    cursor: 'grabbing',
                  }}
                >
                  <BlockRender block={activeBlock} design={design} readonly />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {menu && menuBlock && !readonly && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          block={menuBlock}
          canMoveUp={menu.blockIdx > 0}
          canMoveDown={menu.blockIdx < blocks.length - 1}
          onMoveUp={() => {
            handleMove(menu.blockIdx, menu.blockIdx - 1)
            setMenu(null)
          }}
          onMoveDown={() => {
            handleMove(menu.blockIdx, menu.blockIdx + 1)
            setMenu(null)
          }}
          onRemove={() => handleRemove(menu.blockIdx)}
          onUpdate={(patch) => handleUpdate(menu.blockIdx, patch)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// ===========================================================================
// SortableBlock — one block, with hover drag handle, no selection chrome.
// ===========================================================================

function SortableBlock({
  id,
  block,
  design,
  readonly,
  highlighted,
  onUpdate,
  onOpenMenu,
}: {
  id: string
  block: EmailBlock
  design: CampaignDesign
  readonly?: boolean
  highlighted: boolean
  onUpdate: (patch: Partial<EmailBlock>) => void
  onOpenMenu: (e: React.MouseEvent) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    activeIndex,
    overIndex,
  } = useSortable({ id })
  const [hovering, setHovering] = useState(false)

  const showDropIndicator = isOver && !isDragging
  const dropAbove = showDropIndicator && activeIndex > overIndex
  const dropBelow = showDropIndicator && activeIndex < overIndex

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.15 : 1,
    position: 'relative',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={onOpenMenu}
      onContextMenu={onOpenMenu}
    >
      {dropAbove && <DropIndicator position="top" />}

      {!readonly && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          onClick={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            left: -28,
            top: 8,
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 4,
            color: '#A3A3A3',
            cursor: isDragging ? 'grabbing' : 'grab',
            opacity: hovering || isDragging ? 1 : 0,
            transition: 'opacity 100ms ease, background 100ms ease',
            padding: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#F5F5F5')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <RxDragHandleDots2 size={16} />
        </button>
      )}

      <div
        style={{
          padding: '4px',
          margin: '2px 0',
          borderRadius: 6,
          // box-shadow ring sits outside the element box, so it never affects
          // layout / sizing — meets the "no position or size change" rule.
          boxShadow: highlighted ? '0 0 0 2px #FF4F18' : 'none',
          transition: 'box-shadow 120ms ease',
        }}
      >
        <BlockRender block={block} design={design} onUpdate={onUpdate} readonly={readonly} />
      </div>

      {dropBelow && <DropIndicator position="bottom" />}
    </div>
  )
}

function DropIndicator({ position }: { position: 'top' | 'bottom' }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: position === 'top' ? -2 : 'auto',
        bottom: position === 'bottom' ? -2 : 'auto',
        height: 3,
        background: '#FF4F18',
        borderRadius: 2,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    />
  )
}

// ===========================================================================
// ContextMenu — right-click panel with actions + design controls
// ===========================================================================

function ContextMenu({
  x,
  y,
  block,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUpdate,
  onClose,
}: {
  x: number
  y: number
  block: EmailBlock
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onUpdate: (patch: Partial<EmailBlock>) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  // Keep the menu inside the viewport
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + rect.width + 8 > vw) left = Math.max(8, vw - rect.width - 8)
    if (top + rect.height + 8 > vh) top = Math.max(8, vh - rect.height - 8)
    setPos({ left, top })
  }, [x, y])

  const labelMap: Record<string, string> = {
    heading: 'Heading',
    text: 'Text',
    button: 'Button',
    image: 'Image',
    divider: 'Divider',
    spacer: 'Spacer',
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      // Allow the browser's native menu (paste/copy/etc.) over inputs and
      // textareas inside the menu, but suppress it on the menu chrome.
      onContextMenu={(e) => {
        const target = e.target as HTMLElement
        if (!target.closest('input, textarea')) e.preventDefault()
      }}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        minWidth: 240,
        maxWidth: 280,
        background: '#FFFFFF',
        border: '1px solid #E5E5E5',
        borderRadius: 8,
        boxShadow: '0 10px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
        padding: 6,
        zIndex: 1000,
        color: '#171717',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 13,
      }}
    >
      <div
        style={{
          padding: '4px 8px 8px',
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          fontWeight: 600,
          color: '#A3A3A3',
        }}
      >
        {labelMap[block.type] || block.type}
      </div>

      <MenuItem
        icon={<FiArrowUp size={13} />}
        label="Move up"
        disabled={!canMoveUp}
        onClick={onMoveUp}
      />
      <MenuItem
        icon={<FiArrowDown size={13} />}
        label="Move down"
        disabled={!canMoveDown}
        onClick={onMoveDown}
      />
      <MenuItem
        icon={<FiTrash2 size={13} />}
        label="Delete"
        onClick={onRemove}
        variant="danger"
      />

      <MenuDivider />

      <div
        style={{
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <BlockControls block={block} onUpdate={onUpdate} />
      </div>
    </div>,
    document.body,
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  variant,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'danger'
}) {
  const [hover, setHover] = useState(false)
  const color = disabled ? '#A3A3A3' : variant === 'danger' ? '#DC2626' : '#171717'
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '6px 8px',
        background: hover && !disabled ? '#F5F5F5' : 'transparent',
        border: 'none',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        color,
        fontFamily: 'inherit',
        fontSize: 13,
      }}
    >
      <span style={{ color, display: 'inline-flex' }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function MenuDivider() {
  return (
    <div
      style={{
        height: 1,
        background: '#EAEAEA',
        margin: '6px 0',
      }}
    />
  )
}

// ===========================================================================
// BlockRender — visual rendering of one block.
// ===========================================================================

function BlockRender({
  block,
  design,
  onUpdate,
  readonly,
}: {
  block: EmailBlock
  design: CampaignDesign
  onUpdate?: (patch: Partial<EmailBlock>) => void
  readonly?: boolean
}) {
  const update = onUpdate || (() => undefined)
  switch (block.type) {
    case 'heading':
      return (
        <HeadingRender
          block={block as HeadingBlock}
          design={design}
          onUpdate={update}
          readonly={readonly}
        />
      )
    case 'text':
      return (
        <TextRender
          block={block as TextBlock}
          design={design}
          onUpdate={update}
          readonly={readonly}
        />
      )
    case 'button':
      return (
        <ButtonRender
          block={block as ButtonBlock}
          design={design}
          onUpdate={update}
          readonly={readonly}
        />
      )
    case 'image':
      return <ImageRender block={block as ImageBlock} />
    case 'divider':
      return <DividerRender block={block as DividerBlock} />
    case 'spacer':
      return <SpacerRender block={block as SpacerBlock} />
    default:
      return null
  }
}

function HeadingRender({
  block,
  design,
  onUpdate,
  readonly,
}: {
  block: HeadingBlock
  design: CampaignDesign
  onUpdate: (patch: Partial<HeadingBlock>) => void
  readonly?: boolean
}) {
  const level = block.level || 1
  const fontSize = ({ 1: 28, 2: 22, 3: 18 } as Record<number, number>)[level]
  return (
    <EditableText
      value={block.text || ''}
      onChange={(text) => onUpdate({ text })}
      readonly={readonly}
      placeholder="Your headline"
      style={{
        fontSize,
        fontWeight: 700,
        lineHeight: 1.3,
        textAlign: block.align || 'left',
        color: block.color || design.headingColor || '#171717',
        margin: '0 0 16px 0',
      }}
    />
  )
}

function TextRender({
  block,
  design,
  onUpdate,
  readonly,
}: {
  block: TextBlock
  design: CampaignDesign
  onUpdate: (patch: Partial<TextBlock>) => void
  readonly?: boolean
}) {
  const sizePx = TEXT_SIZE_PX[block.size || 'normal']
  return (
    <EditableText
      value={block.text || ''}
      onChange={(text) => onUpdate({ text })}
      readonly={readonly}
      placeholder="Write your paragraph here. Use {firstName} for personalization."
      style={{
        fontSize: sizePx,
        lineHeight: 1.6,
        textAlign: block.align || 'left',
        color: block.color || design.textColor || '#262626',
        margin: '0 0 16px 0',
      }}
    />
  )
}

function ButtonRender({
  block,
  design,
  onUpdate,
  readonly,
}: {
  block: ButtonBlock
  design: CampaignDesign
  onUpdate: (patch: Partial<ButtonBlock>) => void
  readonly?: boolean
}) {
  const align = block.align || 'center'
  const bg = block.backgroundColor || design.buttonBg || '#FF4F18'
  const fg = block.textColor || design.buttonTextColor || '#FFFFFF'
  return (
    <div style={{ textAlign: align, margin: '24px 0' }}>
      <span
        style={{
          display: 'inline-block',
          background: bg,
          color: fg,
          padding: '12px 28px',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 16,
          minWidth: 80,
          maxWidth: '100%',
        }}
      >
        <EditableText
          value={block.label || ''}
          onChange={(label) => onUpdate({ label })}
          readonly={readonly}
          placeholder="Click here"
          style={{
            color: fg,
            fontWeight: 600,
            textAlign: 'center',
          }}
        />
      </span>
    </div>
  )
}

function ImageRender({
  block,
}: {
  block: ImageBlock
}) {
  const align = block.align || 'center'
  const width = IMAGE_WIDTH_CSS[block.width || 'full']
  const src = block.url || ''
  const hasImage = src.startsWith('http') || src.startsWith('data:image')
  return (
    <div style={{ textAlign: align, margin: '0 0 16px 0' }}>
      {hasImage ? (
        <img
          src={src}
          alt={block.alt || ''}
          style={{
            display: 'inline-block',
            maxWidth: '100%',
            width,
            height: 'auto',
            borderRadius: 8,
          }}
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: width === '100%' ? '100%' : width,
            height: 120,
            background: '#F5F5F5',
            border: '1px dashed #D4D4D4',
            borderRadius: 8,
            color: '#A3A3A3',
            fontSize: 13,
            padding: '0 12px',
            textAlign: 'center',
          }}
        >
          Click this block to set a URL or upload an image.
        </div>
      )}
    </div>
  )
}

function DividerRender({ block }: { block: DividerBlock }) {
  return (
    <hr
      style={{
        border: 'none',
        borderTop: `1px solid ${block.color || '#EAEAEA'}`,
        margin: '24px 0',
      }}
    />
  )
}

function SpacerRender({ block }: { block: SpacerBlock }) {
  return (
    <div
      style={{
        height: Math.max(4, Math.min(block.height || 16, 128)),
        background:
          'repeating-linear-gradient(45deg, transparent, transparent 4px, #F5F5F5 4px, #F5F5F5 8px)',
        borderRadius: 4,
      }}
    />
  )
}

// ===========================================================================
// EditableText
// ===========================================================================

function EditableText({
  value,
  onChange,
  placeholder,
  readonly,
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  readonly?: boolean
  style: React.CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.style.height = '0px'
    ref.current.style.height = ref.current.scrollHeight + 'px'
  }, [value])

  if (readonly) {
    return (
      <div style={{ ...style, whiteSpace: 'pre-wrap' }}>
        {value || <span style={{ color: '#A3A3A3' }}>{placeholder}</span>}
      </div>
    )
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      rows={1}
      spellCheck
      style={{
        width: '100%',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        padding: 0,
        margin: 0,
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        ...style,
      }}
    />
  )
}

// ===========================================================================
// BlockControls — rendered inside the context menu
// ===========================================================================

function BlockControls({
  block,
  onUpdate,
}: {
  block: EmailBlock
  onUpdate: (patch: Partial<EmailBlock>) => void
}) {
  switch (block.type) {
    case 'heading': {
      const h = block as HeadingBlock
      return (
        <>
          <ControlGroup label="Size">
            {[1, 2, 3].map((lvl) => (
              <SegBtn
                key={lvl}
                active={(h.level || 1) === lvl}
                onClick={() => onUpdate({ level: lvl as 1 | 2 | 3 })}
              >
                H{lvl}
              </SegBtn>
            ))}
          </ControlGroup>
          <AlignControl value={h.align || 'left'} onChange={(align) => onUpdate({ align })} />
          <ColorControl
            label="Color"
            value={h.color || ''}
            palette={TEXT_PALETTE}
            onChange={(color) => onUpdate({ color })}
          />
        </>
      )
    }
    case 'text': {
      const t = block as TextBlock
      return (
        <>
          <ControlGroup label="Size">
            {(['small', 'normal', 'large'] as TextSize[]).map((s) => (
              <SegBtn
                key={s}
                active={(t.size || 'normal') === s}
                onClick={() => onUpdate({ size: s })}
              >
                {s === 'small' ? 'S' : s === 'normal' ? 'M' : 'L'}
              </SegBtn>
            ))}
          </ControlGroup>
          <AlignControl value={t.align || 'left'} onChange={(align) => onUpdate({ align })} />
          <ColorControl
            label="Color"
            value={t.color || ''}
            palette={TEXT_PALETTE}
            onChange={(color) => onUpdate({ color })}
          />
        </>
      )
    }
    case 'button': {
      const b = block as ButtonBlock
      return (
        <>
          <AlignControl value={b.align || 'center'} onChange={(align) => onUpdate({ align })} />
          <ColorControl
            label="Background"
            value={b.backgroundColor || ''}
            palette={BUTTON_BG_PALETTE}
            onChange={(c) => onUpdate({ backgroundColor: c })}
          />
          <ColorControl
            label="Text"
            value={b.textColor || ''}
            palette={BUTTON_FG_PALETTE}
            onChange={(c) => onUpdate({ textColor: c })}
          />
          <UrlControl
            label="Link"
            value={b.url || ''}
            onChange={(url) => onUpdate({ url })}
            placeholder="https://"
          />
        </>
      )
    }
    case 'image': {
      const im = block as ImageBlock
      return (
        <>
          <ControlGroup label="Source">
            <input
              type="url"
              value={im.url || ''}
              onChange={(e) => onUpdate({ url: e.target.value })}
              placeholder="https://… or upload →"
              style={{ ...inputStyleLight, minWidth: 130, flex: 1 }}
            />
            <UploadButton onSelect={(dataUrl) => onUpdate({ url: dataUrl })} />
          </ControlGroup>
          <ControlGroup label="Alt">
            <input
              type="text"
              value={im.alt || ''}
              onChange={(e) => onUpdate({ alt: e.target.value })}
              placeholder="Description for screen readers"
              style={{ ...inputStyleLight, minWidth: 160, flex: 1 }}
            />
          </ControlGroup>
          <ControlGroup label="Width">
            {(['small', 'medium', 'full'] as ImageWidth[]).map((w) => (
              <SegBtn
                key={w}
                active={(im.width || 'full') === w}
                onClick={() => onUpdate({ width: w })}
              >
                {w === 'small' ? <FiMinimize2 size={11} /> : w === 'medium' ? 'M' : <FiMaximize2 size={11} />}
              </SegBtn>
            ))}
          </ControlGroup>
          <AlignControl value={im.align || 'center'} onChange={(align) => onUpdate({ align })} />
        </>
      )
    }
    case 'divider': {
      const d = block as DividerBlock
      return (
        <ColorControl
          label="Color"
          value={d.color || '#EAEAEA'}
          palette={DIVIDER_PALETTE}
          onChange={(color) => onUpdate({ color })}
        />
      )
    }
    case 'spacer': {
      const s = block as SpacerBlock
      return (
        <ControlGroup label="Height">
          <input
            type="range"
            min={4}
            max={96}
            step={4}
            value={s.height || 16}
            onChange={(e) => onUpdate({ height: Number(e.target.value) })}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 140 }}
          />
          <span style={{ minWidth: 32, fontSize: 11, color: '#525252' }}>{s.height || 16}px</span>
        </ControlGroup>
      )
    }
    default:
      return null
  }
}

// ----- Small primitives ----------------------------------------------------

function ControlGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: '#737373',
          minWidth: 64,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'inline-flex', gap: 2, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 26,
        height: 24,
        padding: '0 6px',
        background: active ? '#171717' : '#FFFFFF',
        color: active ? '#FFFFFF' : '#171717',
        border: '1px solid ' + (active ? '#171717' : '#D4D4D4'),
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  )
}

function AlignControl({
  value,
  onChange,
}: {
  value: BlockAlign
  onChange: (v: BlockAlign) => void
}) {
  return (
    <ControlGroup label="Align">
      <SegBtn active={value === 'left'} onClick={() => onChange('left')}>
        <FiAlignLeft size={11} />
      </SegBtn>
      <SegBtn active={value === 'center'} onClick={() => onChange('center')}>
        <FiAlignCenter size={11} />
      </SegBtn>
      <SegBtn active={value === 'right'} onClick={() => onChange('right')}>
        <FiAlignRight size={11} />
      </SegBtn>
    </ControlGroup>
  )
}

function ColorControl({
  label,
  value,
  palette,
  onChange,
}: {
  label: string
  value: string
  palette: string[]
  onChange: (c: string) => void
}) {
  return (
    <ControlGroup label={label}>
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          aria-label={`Set ${label} to ${c}`}
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            border:
              value.toLowerCase() === c.toLowerCase()
                ? '2px solid #171717'
                : '1px solid #D4D4D4',
            background: c,
            cursor: 'pointer',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {value.toLowerCase() === c.toLowerCase() && (
            <FiCheck size={10} color={pickReadable(c)} />
          )}
        </button>
      ))}
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        title="Custom"
        style={{
          width: 22,
          height: 22,
          border: 'none',
          padding: 0,
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
    </ControlGroup>
  )
}

function UrlControl({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <ControlGroup label={label}>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onClick={(e) => e.stopPropagation()}
        style={{ ...inputStyleLight, minWidth: 160 }}
      />
    </ControlGroup>
  )
}

function UploadButton({ onSelect }: { onSelect: (dataUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          inputRef.current?.click()
        }}
        title="Upload from your computer"
        style={{
          padding: '4px 10px',
          border: '1px solid #D4D4D4',
          background: '#FFFFFF',
          color: '#171717',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
          fontFamily: 'inherit',
        }}
      >
        <FiUpload size={12} />
        Upload
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset so picking the same file twice re-fires onChange
          e.target.value = ''
          if (!file) return
          if (file.size > 5_000_000) {
            // 5 MB cap — base64 embedding inflates email size considerably.
            alert(
              'Image is over 5 MB. Use a smaller file or paste a hosted URL.',
            )
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') onSelect(reader.result)
          }
          reader.readAsDataURL(file)
        }}
      />
    </>
  )
}

const inputStyleLight: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #D4D4D4',
  borderRadius: 4,
  fontSize: 12,
  background: '#FFFFFF',
  color: '#171717',
  fontFamily: 'inherit',
  outline: 'none',
}

function pickReadable(bg: string): string {
  if (!bg.startsWith('#') || bg.length !== 7) return '#FFFFFF'
  const r = parseInt(bg.slice(1, 3), 16)
  const g = parseInt(bg.slice(3, 5), 16)
  const b = parseInt(bg.slice(5, 7), 16)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return lum > 140 ? '#171717' : '#FFFFFF'
}
