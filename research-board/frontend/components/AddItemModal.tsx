import { useState, useRef } from 'react'
import { Modal, Button, Input, Textarea } from './ui'
import type { ItemType, CreateBoardItemRequest } from '../types'
import type { AppController } from '../AppController'

interface AddItemModalProps {
  open: boolean
  onClose: () => void
  onAdd: (item: CreateBoardItemRequest) => Promise<void>
  controller: AppController
  defaultType?: ItemType
}

const ITEM_TYPES: { type: ItemType; label: string; icon: string; description: string }[] = [
  { type: 'image', label: 'Image', icon: '🖼️', description: 'Upload or link an image' },
  { type: 'video', label: 'Video', icon: '🎬', description: 'Upload or link a video' },
  { type: 'youtube', label: 'YouTube', icon: '📺', description: 'Embed a YouTube video' },
  { type: 'doc', label: 'Document', icon: '📄', description: 'Upload or link a document' },
  { type: 'note', label: 'Note', icon: '📝', description: 'Write a text note' },
]

export function AddItemModal({ open, onClose, onAdd, controller, defaultType }: AddItemModalProps) {
  const [selectedType, setSelectedType] = useState<ItemType | null>(defaultType || null)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setSelectedType(defaultType || null)
    setTitle('')
    setUrl('')
    setContent('')
    setFile(null)
    setErrors({})
    setUploading(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!title.trim()) newErrors.title = 'Title is required'
    if (selectedType === 'note' && !content.trim()) newErrors.content = 'Note content is required'
    if (selectedType === 'youtube' && !url.trim()) newErrors.url = 'YouTube URL is required'
    if (selectedType === 'youtube' && url && !url.includes('youtube.com') && !url.includes('youtu.be')) {
      newErrors.url = 'Please enter a valid YouTube URL'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!selectedType || !validate()) return

    let uploadedFilePath: string | undefined

    if (file && (selectedType === 'image' || selectedType === 'video' || selectedType === 'doc')) {
      setUploading(true)
      try {
        const result = await controller.uploadFile(file)
        uploadedFilePath = result.filePath
      } catch (err) {
        setErrors({ file: 'File upload failed. Please try again.' })
        setUploading(false)
        return
      }
      setUploading(false)
    }

    const request: CreateBoardItemRequest = {
      type: selectedType,
      title: title.trim(),
      x: Math.random() * 400 + 50,
      y: Math.random() * 300 + 50,
    }

    if (url.trim()) request.url = url.trim()
    if (content.trim()) request.content = content.trim()
    if (uploadedFilePath) request.url = uploadedFilePath

    await onAdd(request)
    reset()
    onClose()
  }

  const needsUrl = selectedType && ['image', 'video', 'youtube', 'doc'].includes(selectedType)
  const needsFile = selectedType && ['image', 'video', 'doc'].includes(selectedType)
  const needsContent = selectedType === 'note'

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={selectedType ? `Add ${ITEM_TYPES.find(t => t.type === selectedType)?.label}` : 'Add Item'}
    >
      {!selectedType ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
            Choose the type of item to add to your board:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {ITEM_TYPES.map(({ type, label, icon, description }) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '16px 12px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#6366f1')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              >
                <span style={{ fontSize: '28px' }}>{icon}</span>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{label}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center' }}>{description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <button
            onClick={() => setSelectedType(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              textAlign: 'left',
              padding: 0,
            }}
          >
            ← Change type
          </button>

          <Input
            label="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={`Enter ${ITEM_TYPES.find(t => t.type === selectedType)?.label.toLowerCase()} title`}
            error={errors.title}
          />

          {needsContent && (
            <Textarea
              label="Note Content"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Write your note here..."
              rows={5}
              error={errors.content}
            />
          )}

          {needsUrl && (
            <Input
              label={selectedType === 'youtube' ? 'YouTube URL *' : 'URL (optional if uploading file)'}
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={
                selectedType === 'youtube'
                  ? 'https://www.youtube.com/watch?v=...'
                  : 'https://example.com/...'
              }
              error={errors.url}
            />
          )}

          {needsFile && (
            <div>
              <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                Upload File (optional)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept={
                  selectedType === 'image' ? 'image/*' :
                  selectedType === 'video' ? 'video/*' :
                  '.pdf,.doc,.docx,.txt,.md'
                }
                onChange={e => setFile(e.target.files?.[0] || null)}
                style={{ fontSize: '13px', color: 'var(--text-primary)' }}
              />
              {file && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Selected: {file.name}</p>}
              {errors.file && <p style={{ fontSize: '12px', color: 'var(--color-danger, #ef4444)', marginTop: '4px' }}>{errors.file}</p>}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Add to Board'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
