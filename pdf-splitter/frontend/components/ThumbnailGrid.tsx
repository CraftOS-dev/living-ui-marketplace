import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Check } from 'lucide-react'
import { Spinner } from './ui'
import { ApiService } from '../services/ApiService'

interface ThumbnailGridProps {
  documentId: number
  pageCount: number
  selectedPages: Set<number>
  onSelectionChange: (pages: Set<number>) => void
}

export function ThumbnailGrid({
  documentId,
  pageCount,
  selectedPages,
  onSelectionChange,
}: ThumbnailGridProps) {
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set())
  const [errorPages, setErrorPages] = useState<Set<number>>(new Set())
  const lastClickedRef = useRef<number | null>(null)

  // Reset loaded state when document changes
  useEffect(() => {
    setLoadedPages(new Set())
    setErrorPages(new Set())
    lastClickedRef.current = null
  }, [documentId])

  const handlePageClick = useCallback(
    (pageNum: number, e: React.MouseEvent) => {
      const newSelection = new Set(selectedPages)

      if (e.shiftKey && lastClickedRef.current !== null) {
        // Shift+click: select range
        const start = Math.min(lastClickedRef.current, pageNum)
        const end = Math.max(lastClickedRef.current, pageNum)
        for (let i = start; i <= end; i++) {
          newSelection.add(i)
        }
      } else {
        // Regular click: toggle
        if (newSelection.has(pageNum)) {
          newSelection.delete(pageNum)
        } else {
          newSelection.add(pageNum)
        }
      }

      lastClickedRef.current = pageNum
      onSelectionChange(newSelection)
    },
    [selectedPages, onSelectionChange]
  )

  const handleSelectAll = useCallback(() => {
    const all = new Set<number>()
    for (let i = 1; i <= pageCount; i++) all.add(i)
    onSelectionChange(all)
  }, [pageCount, onSelectionChange])

  const handleDeselectAll = useCallback(() => {
    onSelectionChange(new Set())
  }, [onSelectionChange])

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1)

  return (
    <div>
      {/* Selection toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          {selectedPages.size} of {pageCount} pages selected
        </span>
        <button
          onClick={handleSelectAll}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-primary)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-medium)' as any,
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          Select all
        </button>
        {selectedPages.size > 0 && (
          <button
            onClick={handleDeselectAll}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Deselect all
          </button>
        )}
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
            marginLeft: 'auto',
          }}
        >
          Click to select · Shift+click for range
        </span>
      </div>

      {/* Thumbnail grid — auto-fill scales down to ~110 px on narrow viewports */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))',
          gap: 'var(--space-2)',
        }}
      >
        {pages.map((pageNum) => {
          const isSelected = selectedPages.has(pageNum)
          const isLoaded = loadedPages.has(pageNum)
          const hasError = errorPages.has(pageNum)
          const thumbUrl = ApiService.getThumbnailUrl(documentId, pageNum)

          return (
            <PageThumbnail
              key={`${documentId}-${pageNum}`}
              pageNum={pageNum}
              thumbUrl={thumbUrl}
              isSelected={isSelected}
              isLoaded={isLoaded}
              hasError={hasError}
              onClick={(e) => handlePageClick(pageNum, e)}
              onLoad={() =>
                setLoadedPages((prev) => new Set(prev).add(pageNum))
              }
              onError={() =>
                setErrorPages((prev) => new Set(prev).add(pageNum))
              }
            />
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Individual page thumbnail
// ---------------------------------------------------------------------------

interface PageThumbnailProps {
  pageNum: number
  thumbUrl: string
  isSelected: boolean
  isLoaded: boolean
  hasError: boolean
  onClick: (e: React.MouseEvent) => void
  onLoad: () => void
  onError: () => void
}

function PageThumbnail({
  pageNum,
  thumbUrl,
  isSelected,
  isLoaded,
  hasError,
  onClick,
  onLoad,
  onError,
}: PageThumbnailProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        cursor: 'pointer',
        borderRadius: 'var(--radius-md)',
        border: isSelected
          ? '2px solid var(--color-primary)'
          : '2px solid var(--border-primary)',
        backgroundColor: 'var(--bg-secondary)',
        overflow: 'hidden',
        transition: 'var(--transition-fast)',
        boxShadow: isHovered ? 'var(--shadow-md)' : 'none',
        transform: isHovered ? 'translateY(-2px)' : 'none',
      }}
    >
      {/* Thumbnail image */}
      <div
        style={{
          aspectRatio: '0.707',
          backgroundColor: 'var(--bg-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {!isLoaded && !hasError && <Spinner size="sm" />}
        {hasError && (
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
            }}
          >
            Failed
          </span>
        )}
        <img
          src={thumbUrl}
          alt={`Page ${pageNum}`}
          onLoad={onLoad}
          onError={onError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: isLoaded ? 'block' : 'none',
          }}
        />
      </div>

      {/* Selection overlay */}
      {isSelected && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(255, 79, 24, 0.1)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Checkbox indicator */}
      {(isSelected || isHovered) && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            borderRadius: 'var(--radius-sm)',
            backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-secondary)',
            border: isSelected ? 'none' : '2px solid var(--border-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {isSelected && <Check size={14} style={{ color: '#fff' }} />}
        </div>
      )}

      {/* Page number */}
      <div
        style={{
          padding: 'var(--space-1) var(--space-2)',
          textAlign: 'center',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--font-weight-medium)' as any,
          color: isSelected ? 'var(--color-primary)' : 'var(--text-secondary)',
          backgroundColor: isSelected ? 'var(--color-primary-light)' : 'transparent',
          borderTop: '1px solid var(--border-primary)',
        }}
      >
        Page {pageNum}
      </div>
    </div>
  )
}
