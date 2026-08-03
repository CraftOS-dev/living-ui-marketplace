import { useState, useRef, useEffect } from 'react'
import { Image, Film, Youtube, FileText, StickyNote, ChevronLeft, Upload, type LucideIcon } from 'lucide-react'
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

const ITEM_TYPES: { type: ItemType; label: string; icon: LucideIcon; description: string }[] = [
  { type: 'image', label: 'Image', icon: Image, description: 'Upload or link an image' },
  { type: 'video', label: 'Video', icon: Film, description: 'Upload or link a video' },
  { type: 'youtube', label: 'YouTube', icon: Youtube, description: 'Embed a YouTube video' },
  { type: 'doc', label: 'Document', icon: FileText, description: 'Upload or link a document' },
  { type: 'note', label: 'Note', icon: StickyNote, description: 'Write a text note' },
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

  // The modal stays mounted between opens, so the useState initializer above only
  // runs once. Re-sync the selected type to the requested type each time the modal
  // opens (or the requested type changes) — otherwise it shows the previous type.
  useEffect(() => {
    if (open) setSelectedType(defaultType || null)
  }, [open, defaultType])

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
          <p className="add-item-intro">Choose the type of item to add to your board:</p>
          <div className="type-tile-grid">
            {ITEM_TYPES.map(({ type, label, icon: Icon, description }) => (
              <button
                key={type}
                className="type-tile"
                onClick={() => setSelectedType(type)}
              >
                <Icon size={28} />
                <span className="type-tile-label">{label}</span>
                <span className="type-tile-description">{description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="add-item-form">
          <button className="back-link" onClick={() => setSelectedType(null)}>
            <ChevronLeft size={14} /> Change type
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
            <div className="file-field">
              <label className="file-field-label">Upload File (optional)</label>
              <label className="file-dropzone">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={
                    selectedType === 'image' ? 'image/*' :
                    selectedType === 'video' ? 'video/*' :
                    '.pdf,.doc,.docx,.txt,.md'
                  }
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
                <Upload size={16} />
                <span>{file ? file.name : 'Choose a file…'}</span>
              </label>
              {errors.file && <p className="file-field-error">{errors.file}</p>}
            </div>
          )}

          <div className="form-actions">
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

      <style>{`
        .add-item-intro {
          color: var(--text-secondary);
          margin: 0 0 var(--space-4);
          font-size: var(--font-size-base);
        }
        .type-tile-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-2);
        }
        .type-tile {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-4) var(--space-3);
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
          color: var(--text-primary);
        }
        .type-tile:hover {
          border-color: #6366f1;
          background: var(--bg-tertiary, rgba(99,102,241,0.08));
        }
        .type-tile-label {
          font-weight: var(--font-weight-semibold);
          font-size: var(--font-size-base);
        }
        .type-tile-description {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          text-align: center;
        }
        .add-item-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
        .back-link {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          align-self: flex-start;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: var(--font-size-sm);
          padding: var(--space-1) 0;
          transition: color 0.15s;
        }
        .back-link:hover {
          color: var(--text-primary);
        }
        .file-field {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }
        .file-field-label {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
        }
        .file-dropzone {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3);
          background: var(--bg-primary);
          border: 1px dashed var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          font-size: var(--font-size-sm);
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .file-dropzone:hover {
          border-color: #6366f1;
          color: var(--text-primary);
        }
        .file-dropzone input[type="file"] {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        .file-field-error {
          font-size: var(--font-size-xs);
          color: var(--color-danger, #ef4444);
          margin: 0;
        }
        .form-actions {
          display: flex;
          gap: var(--space-2);
          justify-content: flex-end;
          margin-top: var(--space-1);
          padding-top: var(--space-3);
          border-top: 1px solid var(--border-color);
        }
      `}</style>
    </Modal>
  )
}
