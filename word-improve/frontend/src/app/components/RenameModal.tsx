import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from './ui'

interface RenameModalProps {
  open: boolean
  currentTitle: string
  onClose: () => void
  onSubmit: (title: string) => void | Promise<void>
}

export function RenameModal({ open, currentTitle, onClose, onSubmit }: RenameModalProps) {
  const [value, setValue] = useState(currentTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(currentTitle)
      // Defer focus until after the modal has mounted.
      const t = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
      return () => clearTimeout(t)
    }
  }, [open, currentTitle])

  const handleSubmit = async () => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === currentTitle) {
      onClose()
      return
    }
    await onSubmit(trimmed)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename session"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!value.trim()}
          >
            Save
          </Button>
        </>
      }
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
          }
        }}
        placeholder="Session name"
        aria-label="Session name"
      />
    </Modal>
  )
}
