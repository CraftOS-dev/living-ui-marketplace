import { useState, useEffect, useCallback } from 'react'
import { History, Download, Archive, FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Spinner } from './ui'
import { ApiService } from '../services/ApiService'
import type { SplitJob } from '../types'

interface SplitHistoryProps {
  documentId: number
  /** Bumped externally after a new split so the list refreshes */
  refreshKey: number
}

export function SplitHistory({ documentId, refreshKey }: SplitHistoryProps) {
  const [splits, setSplits] = useState<SplitJob[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  const fetchSplits = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ApiService.listDocumentSplits(documentId)
      setSplits(data)
    } catch {
      setSplits([])
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    fetchSplits()
  }, [fetchSplits, refreshKey])

  const handleDownloadFile = useCallback((splitId: number, fileIndex: number) => {
    const url = ApiService.getDownloadUrl(splitId, fileIndex)
    window.open(url, '_blank')
  }, [])

  const handleDownloadZip = useCallback((splitId: number) => {
    const url = ApiService.getZipDownloadUrl(splitId)
    window.open(url, '_blank')
  }, [])

  if (loading && splits.length === 0) {
    return null
  }

  if (splits.length === 0) {
    return null
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const splitTypeLabel = (type: string) => {
    switch (type) {
      case 'pages': return 'By Pages'
      case 'ranges': return 'By Ranges'
      case 'every_n': return 'Every N'
      default: return type
    }
  }

  const splitConfigSummary = (job: SplitJob) => {
    const cfg = job.split_config
    switch (job.split_type) {
      case 'pages':
        return cfg.pages ? `Pages: ${(cfg.pages as number[]).join(', ')}` : ''
      case 'ranges':
        return cfg.ranges
          ? (cfg.ranges as [number, number][]).map(([s, e]) => s === e ? `${s}` : `${s}-${e}`).join(', ')
          : ''
      case 'every_n':
        return cfg.n ? `Every ${cfg.n} pages` : ''
      default:
        return ''
    }
  }

  return (
    <div
      style={{
        marginTop: 'var(--space-6)',
        borderTop: '1px solid var(--border-primary)',
        paddingTop: 'var(--space-4)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: expanded ? 'var(--space-3)' : 0,
          width: '100%',
        }}
      >
        <History size={18} style={{ color: 'var(--color-primary)' }} />
        <span
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 'var(--font-weight-semibold)' as any,
            color: 'var(--text-primary)',
          }}
        >
          Split History ({splits.length})
        </span>
        {loading && <Spinner size="sm" />}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {splits.map((job) => (
            <div
              key={job.id}
              style={{
                padding: 'var(--space-3)',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--space-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      fontWeight: 'var(--font-weight-medium)' as any,
                      color: 'var(--color-primary)',
                      backgroundColor: 'var(--color-primary-light)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {splitTypeLabel(job.split_type)}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {splitConfigSummary(job)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {formatDate(job.created_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadZip(job.id)}
                    title="Download all as ZIP"
                  >
                    <Archive size={14} />
                  </Button>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-1)',
                }}
              >
                {Array.from({ length: job.file_count }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => handleDownloadFile(job.id, i)}
                    title={`Download part ${i + 1}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-secondary)',
                      transition: 'var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--color-primary)'
                      e.currentTarget.style.color = 'var(--color-primary)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-primary)'
                      e.currentTarget.style.color = 'var(--text-secondary)'
                    }}
                  >
                    <FileText size={11} />
                    Part {i + 1}
                    <Download size={10} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
