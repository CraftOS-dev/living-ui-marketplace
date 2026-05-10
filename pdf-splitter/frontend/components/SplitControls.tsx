import { useState, useCallback, useMemo } from 'react'
import { Scissors, Download, Archive, X, FileText } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button, Input, Spinner } from './ui'
import { AppController } from '../AppController'
import type { AppControllerState } from '../AppController'
import type { SplitJob, SplitType } from '../types'
import { ApiService } from '../services/ApiService'

interface SplitControlsProps {
  controller: AppController
  state: AppControllerState
  documentId: number
  pageCount: number
  selectedPages: Set<number>
  onClearSelection: () => void
}

type SplitMode = 'selected' | 'ranges' | 'every_n'

export function SplitControls({
  controller,
  state,
  documentId,
  pageCount,
  selectedPages,
  onClearSelection,
}: SplitControlsProps) {
  const [splitMode, setSplitMode] = useState<SplitMode>('selected')
  const [rangeInput, setRangeInput] = useState('')
  const [everyN, setEveryN] = useState('2')
  const [showResults, setShowResults] = useState(false)

  const { splitting, lastSplitJob } = state

  // Parse range input like "1-5, 8, 11-15"
  const parsedRanges = useMemo(() => {
    if (!rangeInput.trim()) return null
    try {
      const ranges: [number, number][] = []
      const parts = rangeInput.split(',')
      for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed) continue
        if (trimmed.includes('-')) {
          const [startStr, endStr] = trimmed.split('-').map((s) => s.trim())
          const start = parseInt(startStr, 10)
          const end = parseInt(endStr, 10)
          if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > pageCount) {
            return 'invalid'
          }
          ranges.push([start, end])
        } else {
          const page = parseInt(trimmed, 10)
          if (isNaN(page) || page < 1 || page > pageCount) {
            return 'invalid'
          }
          ranges.push([page, page])
        }
      }
      return ranges.length > 0 ? ranges : null
    } catch {
      return 'invalid'
    }
  }, [rangeInput, pageCount])

  const canSplit = useMemo(() => {
    if (splitting) return false
    switch (splitMode) {
      case 'selected':
        return selectedPages.size > 0
      case 'ranges':
        return parsedRanges !== null && parsedRanges !== 'invalid'
      case 'every_n': {
        const n = parseInt(everyN, 10)
        return !isNaN(n) && n >= 1 && n <= pageCount
      }
      default:
        return false
    }
  }, [splitMode, selectedPages, parsedRanges, everyN, pageCount, splitting])

  const handleSplit = useCallback(async () => {
    let splitType: SplitType
    let config: Record<string, any>

    switch (splitMode) {
      case 'selected': {
        const pages = Array.from(selectedPages).sort((a, b) => a - b)
        splitType = 'pages'
        config = { config: { pages } }
        break
      }
      case 'ranges': {
        if (!parsedRanges || parsedRanges === 'invalid') return
        splitType = 'ranges'
        config = { config: { ranges: parsedRanges } }
        break
      }
      case 'every_n': {
        const n = parseInt(everyN, 10)
        if (isNaN(n) || n < 1) return
        splitType = 'every_n'
        config = { config: { n } }
        break
      }
      default:
        return
    }

    const job = await controller.splitPdf(documentId, splitType, config)
    if (job) {
      toast.success(`Split complete! ${job.file_count} file${job.file_count !== 1 ? 's' : ''} created.`)
      setShowResults(true)
    } else {
      toast.error(controller.getState().error || 'Split failed')
      controller.clearError()
    }
  }, [splitMode, selectedPages, parsedRanges, everyN, documentId, controller])

  const handleDownloadFile = useCallback(
    (splitId: number, fileIndex: number) => {
      const url = ApiService.getDownloadUrl(splitId, fileIndex)
      window.open(url, '_blank')
    },
    []
  )

  const handleDownloadZip = useCallback((splitId: number) => {
    const url = ApiService.getZipDownloadUrl(splitId)
    window.open(url, '_blank')
  }, [])

  const handleDismissResults = useCallback(() => {
    setShowResults(false)
    controller.clearLastSplitJob()
  }, [controller])

  // Show download results panel
  if (showResults && lastSplitJob) {
    return (
      <SplitResults
        job={lastSplitJob}
        onDownloadFile={handleDownloadFile}
        onDownloadZip={handleDownloadZip}
        onDismiss={handleDismissResults}
      />
    )
  }

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        marginTop: 'var(--space-4)',
        padding: 'var(--space-4)',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-primary)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {/* Mode tabs */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          marginBottom: 'var(--space-4)',
          borderBottom: '1px solid var(--border-primary)',
          paddingBottom: 'var(--space-2)',
        }}
      >
        {[
          { key: 'selected' as SplitMode, label: `Selected Pages (${selectedPages.size})` },
          { key: 'ranges' as SplitMode, label: 'Custom Ranges' },
          { key: 'every_n' as SplitMode, label: 'Every N Pages' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSplitMode(tab.key)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: 'none',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              fontWeight: splitMode === tab.key ? 'var(--font-weight-semibold)' as any : 'var(--font-weight-normal)' as any,
              color: splitMode === tab.key ? 'var(--color-primary)' : 'var(--text-secondary)',
              backgroundColor: splitMode === tab.key ? 'var(--color-primary-light)' : 'transparent',
              borderBottom: splitMode === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              transition: 'var(--transition-fast)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mode content */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {splitMode === 'selected' && (
          <>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
              {selectedPages.size} page{selectedPages.size !== 1 ? 's' : ''} selected
              {selectedPages.size > 0 && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--space-2)' }}>
                  ({Array.from(selectedPages)
                    .sort((a, b) => a - b)
                    .join(', ')})
                </span>
              )}
            </span>
            {selectedPages.size > 0 && (
              <button
                onClick={onClearSelection}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--font-size-xs)',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Clear
              </button>
            )}
          </>
        )}

        {splitMode === 'ranges' && (
          <div style={{ flex: 1, maxWidth: 400 }}>
            <Input
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              placeholder={`e.g. 1-5, 8, 11-${pageCount}`}
              style={{ width: '100%' }}
            />
            {parsedRanges === 'invalid' && (
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-error)',
                  marginTop: 'var(--space-1)',
                  display: 'block',
                }}
              >
                Invalid range. Use format: 1-5, 8, 11-15 (pages 1-{pageCount})
              </span>
            )}
            {parsedRanges && parsedRanges !== 'invalid' && (
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-muted)',
                  marginTop: 'var(--space-1)',
                  display: 'block',
                }}
              >
                {parsedRanges.length} range{parsedRanges.length !== 1 ? 's' : ''} &rarr; {parsedRanges.length} file{parsedRanges.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {splitMode === 'every_n' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>Split every</span>
            <Input
              type="number"
              value={everyN}
              onChange={(e) => setEveryN(e.target.value)}
              min={1}
              max={pageCount}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>pages</span>
            {(() => {
              const n = parseInt(everyN, 10)
              if (!isNaN(n) && n >= 1 && n <= pageCount) {
                const chunks = Math.ceil(pageCount / n)
                return (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    &rarr; {chunks} file{chunks !== 1 ? 's' : ''}
                  </span>
                )
              }
              return null
            })()}
          </div>
        )}

        {/* Split button */}
        <div style={{ marginLeft: 'auto' }}>
          <Button
            variant="primary"
            onClick={handleSplit}
            disabled={!canSplit}
          >
            {splitting ? (
              <>
                <Spinner size="sm" />
                Splitting...
              </>
            ) : (
              <>
                <Scissors size={16} />
                Split PDF
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Split Results Panel
// =============================================================================

interface SplitResultsProps {
  job: SplitJob
  onDownloadFile: (splitId: number, fileIndex: number) => void
  onDownloadZip: (splitId: number) => void
  onDismiss: () => void
}

function SplitResults({ job, onDownloadFile, onDownloadZip, onDismiss }: SplitResultsProps) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        marginTop: 'var(--space-4)',
        padding: 'var(--space-4)',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-primary)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Scissors size={18} style={{ color: 'var(--color-primary)' }} />
          <span
            style={{
              fontSize: 'var(--font-size-base)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              color: 'var(--text-primary)',
            }}
          >
            Split Complete &mdash; {job.file_count} file{job.file_count !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Button variant="primary" size="sm" onClick={() => onDownloadZip(job.id)}>
            <Archive size={14} />
            Download All (ZIP)
          </Button>
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 'var(--space-1)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* File list */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          maxHeight: 200,
          overflowY: 'auto',
        }}
      >
        {job.files?.map((file, index) => (
          <button
            key={index}
            onClick={() => onDownloadFile(job.id, index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              transition: 'var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-primary)'
              e.currentTarget.style.backgroundColor = 'var(--color-primary-light)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-primary)'
              e.currentTarget.style.backgroundColor = 'var(--bg-primary)'
            }}
          >
            <FileText size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
            <span>{file.filename}</span>
            <Download size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>
        )) || (
          Array.from({ length: job.file_count }, (_, i) => (
            <button
              key={i}
              onClick={() => onDownloadFile(job.id, i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-primary)',
                transition: 'var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary)'
                e.currentTarget.style.backgroundColor = 'var(--color-primary-light)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-primary)'
                e.currentTarget.style.backgroundColor = 'var(--bg-primary)'
              }}
            >
              <FileText size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
              <span>Part {i + 1}</span>
              <Download size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
