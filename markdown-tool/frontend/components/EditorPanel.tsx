import { useRef, useEffect } from 'react'

interface EditorPanelProps {
  content: string
  onChange: (value: string) => void
  onSave: () => void
  filePath: string | null
}

export function EditorPanel({ content, onChange, onSave, filePath }: EditorPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus()
  }, [filePath])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      onSave()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const newValue = content.substring(0, start) + '  ' + content.substring(end)
      onChange(newValue)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
  }

  if (!filePath) {
    return (
      <div className="editor-empty">
        <p>Select a file from the folder panel to open it</p>
        <style>{`
          .editor-empty {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            font-size: var(--font-size-base);
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="editor-panel">
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={content}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />
      <style>{`
        .editor-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
        }
        .editor-textarea {
          flex: 1;
          width: 100%;
          height: 100%;
          resize: none;
          border: none;
          outline: none;
          background: transparent;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 14px;
          line-height: 1.6;
          padding: var(--space-5) var(--space-6);
          tab-size: 2;
          white-space: pre;
          overflow-x: auto;
          overflow-y: auto;
        }
        .editor-textarea::placeholder { color: var(--text-muted); }
      `}</style>
    </div>
  )
}
