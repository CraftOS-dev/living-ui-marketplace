import { FileText, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { PDFDocument } from '../types'

interface SidebarProps {
  documents: PDFDocument[]
  activeDocumentId: number | null
  collapsed: boolean
  onSelectDocument: (id: number) => void
  onDeleteDocument: (id: number) => void
  onToggleCollapse: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Sidebar({
  documents,
  activeDocumentId,
  collapsed,
  onSelectDocument,
  onDeleteDocument,
  onToggleCollapse,
}: SidebarProps) {
  return (
    <div
      style={{
        width: collapsed ? 48 : 280,
        minWidth: collapsed ? 48 : 280,
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: 'var(--space-3)',
          borderBottom: '1px solid var(--border-primary)',
          minHeight: 48,
        }}
      >
        {!collapsed && (
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase' as any,
              letterSpacing: '0.05em',
              whiteSpace: 'nowrap',
            }}
          >
            Documents ({documents.length})
          </span>
        )}
        <button
          onClick={onToggleCollapse}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            padding: 'var(--space-1)',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 'var(--radius-sm)',
          }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Document list */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-2)',
          }}
        >
          {documents.length === 0 ? (
            <div
              style={{
                padding: 'var(--space-4)',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              No documents yet.
              <br />
              Upload a PDF to get started.
            </div>
          ) : (
            documents.map((doc) => {
              const isActive = doc.id === activeDocumentId
              return (
                <div
                  key={doc.id}
                  onClick={() => onSelectDocument(doc.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    backgroundColor: isActive
                      ? 'var(--color-primary-light)'
                      : 'transparent',
                    marginBottom: 'var(--space-1)',
                    transition: 'var(--transition-fast)',
                  }}
                >
                  <FileText
                    size={18}
                    style={{
                      color: isActive ? 'var(--color-primary)' : 'var(--text-muted)',
                      marginTop: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--font-weight-medium)' as any,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={doc.filename}
                    >
                      {doc.filename}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        marginTop: 2,
                      }}
                    >
                      {doc.page_count} pages · {formatFileSize(doc.file_size)}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {formatDate(doc.uploaded_at)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteDocument(doc.id)
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: 'var(--space-1)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      opacity: 0.6,
                      transition: 'var(--transition-fast)',
                    }}
                    title="Delete document"
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLElement).style.opacity = '1'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--color-error)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.opacity = '0.6'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
