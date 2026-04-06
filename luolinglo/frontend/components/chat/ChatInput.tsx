import React, { useState, useRef, useCallback } from 'react'
import { Button } from '../ui'

interface QuickAction {
  label: string
  prompt: string
}

interface ChatInputProps {
  onSend: (content: string) => void
  disabled?: boolean
  quickActions?: QuickAction[]
}

export function ChatInput({ onSend, disabled = false, quickActions }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lineHeight = 22
    const maxHeight = lineHeight * 4 + 16
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleQuickAction = useCallback(
    (prompt: string) => {
      setValue(prompt)
      setTimeout(() => {
        textareaRef.current?.focus()
        adjustHeight()
      }, 0)
    },
    [adjustHeight]
  )

  return (
    <>
      <style>{`
        .chat-input-container {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-3);
          border-top: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
        }
        .chat-quick-actions {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-1);
        }
        .chat-quick-btn {
          padding: var(--space-1) var(--space-2);
          font-size: var(--font-size-xs);
          background-color: var(--bg-tertiary);
          color: var(--text-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          cursor: pointer;
          white-space: nowrap;
          transition: background-color 0.15s;
        }
        .chat-quick-btn:hover {
          background-color: var(--color-primary);
          color: var(--color-white, #fff);
          border-color: var(--color-primary);
        }
        .chat-input-row {
          display: flex;
          gap: var(--space-2);
          align-items: flex-end;
        }
        .chat-textarea {
          flex: 1;
          resize: none;
          padding: var(--space-2) var(--space-3);
          font-family: inherit;
          font-size: var(--font-size-sm);
          line-height: 1.5;
          background-color: var(--bg-primary);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          outline: none;
          overflow-y: auto;
        }
        .chat-textarea:focus {
          border-color: var(--color-primary);
        }
        .chat-textarea::placeholder {
          color: var(--text-muted);
        }
      `}</style>
      <div className="chat-input-container">
        {quickActions && quickActions.length > 0 && (
          <div className="chat-quick-actions">
            {quickActions.map((action) => (
              <button
                key={action.label}
                className="chat-quick-btn"
                type="button"
                onClick={() => handleQuickAction(action.prompt)}
                disabled={disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              adjustHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            disabled={disabled}
          />
          <Button
            size="md"
            onClick={handleSend}
            disabled={disabled || !value.trim()}
          >
            Send
          </Button>
        </div>
      </div>
    </>
  )
}
