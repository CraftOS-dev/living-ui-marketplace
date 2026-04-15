import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, Input } from './ui'
import type { AppController } from '../AppController'
import type { StockWithPrice } from '../types'

interface SearchModalProps {
  controller: AppController
  isOpen: boolean
  onClose: () => void
  onSelectStock: (symbol: string) => void
}

const BACKEND_URL = 'http://localhost:{{BACKEND_PORT}}'

export function SearchModal({ controller: _controller, isOpen, onClose, onSelectStock }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockWithPrice[]>([])
  const [loading, setLoading] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const searchUrl = `${BACKEND_URL}/api/stocks/search` + `?q=${encodeURIComponent(q)}`
      const res = await fetch(searchUrl)
      if (res.ok) {
        const data = await res.json()
        setResults(data)
      }
    } catch (err) {
      console.error('[SearchModal] search error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => search(query), 200)
    return () => clearTimeout(timer)
  }, [query, search])

  const handleSelect = (symbol: string) => {
    onSelectStock(symbol)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHoveredIdx((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHoveredIdx((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && hoveredIdx >= 0 && hoveredIdx < results.length) {
      handleSelect(results[hoveredIdx].symbol)
    }
  }

  return (
    <Modal open={isOpen} onClose={onClose} title="Search Stocks" size="md">
      <div onKeyDown={handleKeyDown}>
        <Input
          ref={inputRef}
          placeholder="Search by symbol or name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-primary)',
            marginBottom: 12,
          }}
        />
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              Searching...
            </div>
          )}
          {!loading && query && results.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              No results found
            </div>
          )}
          {results.map((stock, idx) => (
            <div
              key={stock.symbol}
              onClick={() => handleSelect(stock.symbol)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(-1)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                cursor: 'pointer',
                backgroundColor: hoveredIdx === idx ? 'var(--bg-secondary)' : 'transparent',
                borderRadius: 4,
                transition: 'background 100ms',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {stock.symbol}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {stock.name}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {stock.sector}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
