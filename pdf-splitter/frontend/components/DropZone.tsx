import React, { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { Button, Spinner } from './ui'

interface DropZoneProps {
  onFileSelect: (file: File) => void
  uploading: boolean
}

export function DropZone({ onFileSelect, uploading }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        const file = files[0]
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          onFileSelect(file)
        }
      }
    },
    [onFileSelect]
  )

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onFileSelect(file)
      // Reset input so same file can be re-selected
      e.target.value = ''
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      style={{
        border: `2px dashed ${isDragging ? 'var(--color-primary)' : 'var(--border-secondary)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        cursor: uploading ? 'default' : 'pointer',
        backgroundColor: isDragging ? 'var(--color-primary-light)' : 'var(--bg-secondary)',
        transition: 'var(--transition-fast)',
        minHeight: 200,
        pointerEvents: uploading ? 'none' : 'auto',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {uploading ? (
        <>
          <Spinner size="lg" />
          <p
            style={{
              margin: 0,
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            Uploading...
          </p>
        </>
      ) : (
        <>
          <Upload
            size={40}
            style={{ color: isDragging ? 'var(--color-primary)' : 'var(--text-muted)' }}
          />
          <div style={{ textAlign: 'center' }}>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--font-size-base)',
                fontWeight: 'var(--font-weight-medium)' as any,
                color: 'var(--text-primary)',
              }}
            >
              Drop a PDF here or click to browse
            </p>
            <p
              style={{
                margin: 0,
                marginTop: 'var(--space-1)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-muted)',
              }}
            >
              Supports any PDF file
            </p>
          </div>
          <Button variant="primary" size="sm">
            Choose File
          </Button>
        </>
      )}
    </div>
  )
}
