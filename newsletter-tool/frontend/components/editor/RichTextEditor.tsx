import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FiBold,
  FiDroplet,
  FiItalic,
  FiLink,
  FiUnderline,
} from 'react-icons/fi'

interface EditableRichTextProps {
  value: string
  onChange: (html: string) => void
  readonly?: boolean
  placeholder?: string
  style: React.CSSProperties
  singleLine?: boolean
}

// One-time stylesheet: contentEditable can't show a native placeholder, so we
// emulate one with ::before when the element is empty.
let _stylesInjected = false
function injectStyles() {
  if (_stylesInjected || typeof document === 'undefined') return
  _stylesInjected = true
  const s = document.createElement('style')
  s.textContent = `
    .nlrt-edit:empty:focus::before,
    .nlrt-edit:empty:not(:focus)::before {
      content: attr(data-placeholder);
      color: #A3A3A3;
      pointer-events: none;
    }
    .nlrt-edit b, .nlrt-edit strong { font-weight: 800; }
    .nlrt-edit a { color: inherit; text-decoration: underline; }
  `
  document.head.appendChild(s)
}

// Selection-aware rich-text editor designed to sit inside the WYSIWYG canvas.
// Heading/text blocks render directly through this — the editable region IS
// the rendered preview, so style props (font size, color, alignment) apply to
// the editor itself. A floating toolbar appears above any non-empty selection
// inside the editor and offers bold / italic / underline / color / link.
//
// HTML is stored verbatim in the block's `text` field; the backend sanitizes
// it against an inline-formatting whitelist on send/preview.
export function EditableRichText({
  value,
  onChange,
  readonly,
  placeholder,
  style,
  singleLine,
}: EditableRichTextProps) {
  const ref = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null)
  const [colorOpen, setColorOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('https://')
  const popoverInteracting = useRef(false)

  useEffect(injectStyles, [])

  // Hydrate the editor from value only when the DOM is out of sync. Re-setting
  // innerHTML on every prop change collapses the user's caret while typing.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || ''
    }
  }, [value])

  // Use tag-based formatting (<b>/<i>/<u>) instead of CSS spans. Email clients
  // render the tags universally, and the backend sanitizer's whitelist treats
  // them as first-class. styleWithCSS=true was producing <span style="font-
  // weight:bold"> which the sanitizer was stripping back to a plain span.
  useEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, 'false')
    } catch {
      /* not supported — sanitizer normalizes either form */
    }
  }, [])

  useEffect(() => {
    if (readonly) return
    function check() {
      if (popoverInteracting.current) return
      const sel = window.getSelection()
      const container = ref.current
      if (!sel || sel.rangeCount === 0 || !container) {
        setToolbar(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) {
        setToolbar(null)
        return
      }
      if (range.collapsed) {
        setToolbar(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setToolbar(null)
        return
      }
      savedRange.current = range.cloneRange()
      setToolbar({
        top: rect.top + window.scrollY - 8,
        left: rect.left + window.scrollX + rect.width / 2,
      })
    }
    document.addEventListener('selectionchange', check)
    return () => document.removeEventListener('selectionchange', check)
  }, [readonly])

  if (readonly) {
    return (
      <div
        className="nlrt-edit"
        style={{ ...style, whiteSpace: 'pre-wrap' }}
        data-placeholder={placeholder || ''}
        dangerouslySetInnerHTML={{ __html: value || '' }}
      />
    )
  }

  function emit() {
    if (!ref.current) return
    onChange(ref.current.innerHTML)
  }

  function restoreSelection() {
    const sel = window.getSelection()
    if (!sel || !savedRange.current) return
    sel.removeAllRanges()
    sel.addRange(savedRange.current)
  }

  function exec(cmd: string, val?: string) {
    restoreSelection()
    document.execCommand(cmd, false, val)
    emit()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (singleLine && e.key === 'Enter') {
      e.preventDefault()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'b') { e.preventDefault(); exec('bold') }
      else if (k === 'i') { e.preventDefault(); exec('italic') }
      else if (k === 'u') { e.preventDefault(); exec('underline') }
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Paste as plain text so styles from Word/Docs/web pages don't sneak in.
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    emit()
  }

  function startPopover() {
    popoverInteracting.current = true
  }
  function endPopover() {
    popoverInteracting.current = false
  }

  function applyColor(hex: string) {
    exec('foreColor', hex)
    setColorOpen(false)
    endPopover()
  }

  function applyLink() {
    if (!/^(https?:|mailto:)/i.test(linkUrl)) return
    exec('createLink', linkUrl)
    setLinkOpen(false)
    endPopover()
  }

  function removeLink() {
    exec('unlink')
    setLinkOpen(false)
    endPopover()
  }

  return (
    <>
      <div
        ref={ref}
        className="nlrt-edit"
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={(e) => e.stopPropagation()}
        spellCheck
        data-placeholder={placeholder || ''}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: 0,
          margin: 0,
          minHeight: '1em',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          fontFamily: 'inherit',
          ...style,
        }}
      />
      {toolbar && createPortal(
        <FloatingToolbar
          top={toolbar.top}
          left={toolbar.left}
          colorOpen={colorOpen}
          openColor={() => { startPopover(); setColorOpen((v) => !v); setLinkOpen(false) }}
          onColor={applyColor}
          linkOpen={linkOpen}
          openLink={() => {
            startPopover()
            setLinkUrl(currentSelectionLink() || 'https://')
            setLinkOpen((v) => !v)
            setColorOpen(false)
          }}
          linkUrl={linkUrl}
          onLinkUrlChange={setLinkUrl}
          onApplyLink={applyLink}
          onRemoveLink={removeLink}
          onBold={() => exec('bold')}
          onItalic={() => exec('italic')}
          onUnderline={() => exec('underline')}
          onClose={endPopover}
        />,
        document.body,
      )}
    </>
  )
}

function currentSelectionLink(): string | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  let node: Node | null = sel.getRangeAt(0).startContainer
  while (node) {
    if (node instanceof HTMLElement && node.tagName === 'A') {
      return (node as HTMLAnchorElement).getAttribute('href')
    }
    node = node.parentNode
  }
  return null
}

interface FloatingToolbarProps {
  top: number
  left: number
  colorOpen: boolean
  openColor: () => void
  onColor: (hex: string) => void
  linkOpen: boolean
  openLink: () => void
  linkUrl: string
  onLinkUrlChange: (v: string) => void
  onApplyLink: () => void
  onRemoveLink: () => void
  onBold: () => void
  onItalic: () => void
  onUnderline: () => void
  onClose: () => void
}

const PALETTE_COLORS = [
  '#000000', '#262626', '#737373', '#FFFFFF',
  '#EF4444', '#F97316', '#FF4F18', '#EAB308',
  '#22C55E', '#0EA5E9', '#3B82F6', '#A855F7',
]

function FloatingToolbar(props: FloatingToolbarProps) {
  // Mousedown anywhere inside the toolbar must not steal the editor's selection.
  const stopMouseDown = (e: React.MouseEvent) => e.preventDefault()
  return (
    <div
      onMouseDown={stopMouseDown}
      style={{
        position: 'absolute',
        top: props.top,
        left: props.left,
        transform: 'translate(-50%, -100%)',
        zIndex: 9999,
        background: '#1F1F1F',
        color: '#FFFFFF',
        borderRadius: 6,
        padding: 4,
        display: 'inline-flex',
        gap: 2,
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
      }}
    >
      <TbBtn onClick={props.onBold} title="Bold (Ctrl+B)"><FiBold size={13} /></TbBtn>
      <TbBtn onClick={props.onItalic} title="Italic (Ctrl+I)"><FiItalic size={13} /></TbBtn>
      <TbBtn onClick={props.onUnderline} title="Underline (Ctrl+U)"><FiUnderline size={13} /></TbBtn>
      <TbSep />
      <TbBtn onClick={props.openColor} title="Text color"><FiDroplet size={13} /></TbBtn>
      <TbBtn onClick={props.openLink} title="Insert / edit link"><FiLink size={13} /></TbBtn>
      {props.colorOpen && (
        <div style={popoverStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {PALETTE_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                onMouseDown={stopMouseDown}
                onClick={() => props.onColor(hex)}
                title={hex}
                style={{
                  width: 22,
                  height: 22,
                  background: hex,
                  border: '1px solid #3A3A3A',
                  borderRadius: 4,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      )}
      {props.linkOpen && (
        <div style={{ ...popoverStyle, minWidth: 280 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              type="url"
              value={props.linkUrl}
              onChange={(e) => props.onLinkUrlChange(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); props.onApplyLink() }
              }}
              placeholder="https://…"
              style={{
                flex: 1,
                padding: '4px 6px',
                background: '#2A2A2A',
                color: '#FFFFFF',
                border: '1px solid #3A3A3A',
                borderRadius: 4,
                fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onMouseDown={stopMouseDown}
              onClick={props.onApplyLink}
              style={{
                background: '#FF4F18',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Apply
            </button>
            <button
              type="button"
              onMouseDown={stopMouseDown}
              onClick={props.onRemoveLink}
              title="Remove link"
              style={{
                background: 'transparent',
                color: '#D4D4D4',
                border: '1px solid #3A3A3A',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Unlink
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#A3A3A3' }}>
            Only http(s) and mailto: are accepted.
          </div>
        </div>
      )}
    </div>
  )
}

function TbBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        color: '#FFFFFF',
        cursor: 'pointer',
        borderRadius: 4,
        padding: '4px 6px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  )
}

function TbSep() {
  return <div style={{ width: 1, background: '#3A3A3A', margin: '4px 2px' }} />
}

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  background: '#1F1F1F',
  border: '1px solid #3A3A3A',
  borderRadius: 6,
  padding: 8,
  boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
}
