import { useState, useEffect } from 'react'
import { Modal, Button, Input, Textarea } from './ui'
import { toast } from 'react-toastify'
import type { BoardItem, UpdateBoardItemRequest } from '../types'
import type { AppController } from '../AppController'

const BACKEND_URL = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}')

interface ItemDetailModalProps {
  item: BoardItem | null
  open: boolean
  onClose: () => void
  onUpdate: (id: number, data: UpdateBoardItemRequest) => Promise<void>
  onDelete: (id: number) => Promise<void>
  controller: AppController
}

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|youtu\.be\/)([\w-]+)/)
  return match ? match[1] : null
}

function getFileUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return `${BACKEND_URL}${path}`
}

const TYPE_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  youtube: 'YouTube',
  doc: 'Document',
  note: 'Note',
}

export function ItemDetailModal({ item, open, onClose, onUpdate, onDelete }: ItemDetailModalProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setTitle(item.title)
      setContent(item.content || '')
      setUrl(item.url || '')
      setEditing(false)
      setConfirmDelete(false)
    }
  }, [item])

  if (!item) return null

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Title cannot be empty')
      return
    }
    setSaving(true)
    try {
      await onUpdate(item.id, {
        title: title.trim(),
        content: content || undefined,
        url: url || undefined,
      })
      setEditing(false)
      toast.success('Item updated')
    } catch (err) {
      toast.error('Failed to update item')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await onDelete(item.id)
      toast.success('Item deleted')
      onClose()
    } catch (err) {
      toast.error('Failed to delete item')
    }
  }

  const typeLabel = TYPE_LABELS[item.type] || item.type

  const renderPreview = () => {
    if (item.type === 'image') {
      const src = item.filePath ? getFileUrl(item.filePath) : item.url || ''
      if (src) {
        return (
          <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '16px' }}>
            <img src={src} alt={item.title} style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', background: '#000' }} />
          </div>
        )
      }
    }

    if (item.type === 'video') {
      const src = item.filePath ? getFileUrl(item.filePath) : item.url || ''
      if (src) {
        return (
          <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '16px' }}>
            <video src={src} controls style={{ width: '100%', maxHeight: '300px' }} />
          </div>
        )
      }
    }

    if (item.type === 'youtube' && item.url) {
      const videoId = getYouTubeId(item.url)
      if (videoId) {
        return (
          <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '16px', aspectRatio: '16/9' }}>
            <iframe
              src={`https://www.youtube.com/embed/${videoId}`}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allowFullScreen
              title={item.title}
            />
          </div>
        )
      }
    }

    if (item.type === 'doc') {
      const src = item.filePath ? getFileUrl(item.filePath) : item.url || ''
      if (src) {
        return (
          <div style={{ marginBottom: '16px' }}>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: '#06b6d4',
                textDecoration: 'none',
                fontSize: '14px',
              }}
            >
              📄 Open Document
            </a>
          </div>
        )
      }
    }

    return null
  }

  return (
    <Modal
      open={open}
      onClose={() => { setEditing(false); setConfirmDelete(false); onClose() }}
      title={`[${typeLabel}] ${item.title}`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {renderPreview()}

        {editing ? (
          <>
            <Input
              label="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            {item.type === 'note' && (
              <Textarea
                label="Content"
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={6}
              />
            )}
            {['image', 'video', 'youtube', 'doc'].includes(item.type) && (
              <Input
                label="URL"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://..."
              />
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {item.type === 'note' && item.content && (
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                fontSize: '14px',
                lineHeight: '1.6',
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
              }}>
                {item.content}
              </div>
            )}

            {item.url && item.type !== 'youtube' && (
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                <span style={{ fontWeight: 500 }}>URL: </span>
                <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: '#06b6d4' }}>
                  {item.url}
                </a>
              </div>
            )}

            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Added {new Date(item.createdAt).toLocaleDateString()}
            </div>

            {confirmDelete ? (
              <div style={{
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
              }}>
                <p style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-primary)' }}>
                  Are you sure you want to delete "{item.title}"?
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
