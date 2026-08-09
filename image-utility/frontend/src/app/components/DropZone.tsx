import React, { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { Button } from './ui'

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.tif,image/*'

interface DropZoneProps {
  onFileSelect: (file: File) => void
  uploading: boolean
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif'].includes(ext || '')
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
      const file = e.dataTransfer.files[0]
      if (file && isImageFile(file)) {
        onFileSelect(file)
      }
    },
    [onFileSelect]
  )

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onFileSelect(file)
      e.target.value = ''
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !uploading && fileInputRef.current?.click()}
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
        minHeight: 180,
        pointerEvents: uploading ? 'none' : 'auto',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {uploading ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          Uploading...
        </p>
      ) : (
        <>
          <Upload
            size={36}
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
              Drop an image here or click to browse
            </p>
            <p
              style={{
                margin: 0,
                marginTop: 'var(--space-1)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-muted)',
              }}
            >
              PNG, JPEG, WEBP, GIF
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
