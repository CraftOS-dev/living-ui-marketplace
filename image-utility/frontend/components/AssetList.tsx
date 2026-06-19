import { Trash2, ImageIcon } from 'lucide-react'
import type { ImageAsset } from '../types'
import { formatBytes } from '../types'

interface AssetListProps {
  assets: ImageAsset[]
  activeId: number | null
  onSelect: (id: number) => void
  onDelete: (id: number) => void
}

export function AssetList({ assets, activeId, onSelect, onDelete }: AssetListProps) {
  if (assets.length === 0) {
    return (
      <p style={{ margin: 0, padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        No images yet
      </p>
    )
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--space-2)' }}>
      {assets.map((asset) => {
        const active = asset.id === activeId
        return (
          <li key={asset.id}>
            <button
              type="button"
              onClick={() => onSelect(asset.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                marginBottom: 'var(--space-1)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                textAlign: 'left',
                backgroundColor: active ? 'var(--color-primary-light)' : 'transparent',
                color: 'var(--text-primary)',
                minHeight: 44,
              }}
            >
              <ImageIcon size={16} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: active ? ('var(--font-weight-medium)' as any) : undefined,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {asset.filename}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                  {asset.width}×{asset.height} · {formatBytes(asset.file_size)}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(asset.id)
                }}
                aria-label="Delete"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 'var(--space-1)',
                  display: 'flex',
                  minWidth: 36,
                  minHeight: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Trash2 size={14} />
              </button>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
