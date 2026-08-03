import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Input, Checkbox } from './ui'
import { parseRef } from '../utils/grid'
import type { Sheet } from '../types'

interface FindReplaceProps {
  sheet: Sheet
  onSelect: (ref: string) => void
  onReplaceOne: (ref: string, raw: string) => void
  onReplaceAll: (replacements: { ref: string; raw: string }[]) => void
  onClose: () => void
}

function replaceOccurrences(text: string, search: string, replacement: string, matchCase: boolean): string {
  if (!search) return text
  if (matchCase) return text.split(search).join(replacement)
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(escaped, 'gi'), replacement)
}

/** Modal for searching and replacing cell content across the active sheet. */
export function FindReplace({ sheet, onSelect, onReplaceOne, onReplaceAll, onClose }: FindReplaceProps) {
  const [query, setQuery] = useState('')
  const [replaceWith, setReplaceWith] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const matches = useMemo(() => {
    if (!query) return []
    const q = matchCase ? query : query.toLowerCase()
    const refs = Object.entries(sheet.cells)
      .filter(([, cell]) => (matchCase ? cell.raw : cell.raw.toLowerCase()).includes(q))
      .map(([ref]) => ref)
    return refs.sort((a, b) => {
      const pa = parseRef(a)
      const pb = parseRef(b)
      if (!pa || !pb) return 0
      return pa.row - pb.row || pa.col - pb.col
    })
  }, [sheet.cells, query, matchCase])

  // A new search invalidates the current position.
  useEffect(() => {
    setCurrentIndex(0)
  }, [query, matchCase])

  const jumpTo = (index: number) => {
    if (matches.length === 0) return
    const idx = ((index % matches.length) + matches.length) % matches.length
    setCurrentIndex(idx)
    const ref = matches[idx]
    onSelect(ref)
    requestAnimationFrame(() => {
      document.querySelector(`[data-ref="${ref}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }

  const handleFindNext = () => jumpTo(currentIndex + 1)

  const handleReplace = () => {
    if (matches.length === 0) return
    const ref = matches[currentIndex]
    const raw = sheet.cells[ref]?.raw ?? ''
    onReplaceOne(ref, replaceOccurrences(raw, query, replaceWith, matchCase))
    handleFindNext()
  }

  const handleReplaceAll = () => {
    if (matches.length === 0) return
    const replacements = matches.map((ref) => ({
      ref,
      raw: replaceOccurrences(sheet.cells[ref]?.raw ?? '', query, replaceWith, matchCase),
    }))
    onReplaceAll(replacements)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Find & Replace"
      size="sm"
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', width: '100%' }}>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <Button variant="secondary" size="sm" disabled={matches.length === 0} onClick={handleReplace}>
            Replace
          </Button>
          <Button variant="primary" size="sm" disabled={matches.length === 0} onClick={handleReplaceAll}>
            Replace All
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Find"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleFindNext() }}
          placeholder="Search cell content…"
        />
        <Input
          label="Replace with"
          value={replaceWith}
          onChange={(e) => setReplaceWith(e.target.value)}
          placeholder="Replacement text"
        />
        <Checkbox
          label="Match case"
          checked={matchCase}
          onChange={(e) => setMatchCase(e.target.checked)}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            {matches.length === 0 ? 'No matches' : `${currentIndex + 1} of ${matches.length}`}
          </span>
          <Button variant="secondary" size="sm" disabled={matches.length === 0} onClick={handleFindNext}>
            Find Next
          </Button>
        </div>
      </div>
    </Modal>
  )
}
