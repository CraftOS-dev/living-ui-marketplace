import { useEffect, useState, useCallback } from 'react'
import { Button } from './ui'
import type { AppController } from '../AppController'
import type { WatchlistEntry } from '../types'

const BACKEND_URL = 'http://localhost:3107'

interface WatchlistPanelProps {
  controller: AppController
  onSelectStock: (symbol: string) => void
}

export function WatchlistPanel({ controller: _controller, onSelectStock }: WatchlistPanelProps) {
  const [entries, setEntries] = useState<WatchlistEntry[]>([])
  const [addSymbol, setAddSymbol] = useState('')
  const [adding, setAdding] = useState(false)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/watchlist`)
      if (res.ok) {
        const data = await res.json()
        setEntries(data)
      }
    } catch (err) {
      console.error('[WatchlistPanel] fetch error:', err)
    }
  }, [])

  // Fetch prices to update watchlist items
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/stocks/prices`)
      if (res.ok) {
        // Refresh watchlist to get updated prices
        await fetchWatchlist()
      }
    } catch (err) {
      // silent
    }
  }, [fetchWatchlist])

  useEffect(() => {
    fetchWatchlist()
    const interval = setInterval(fetchPrices, 3000)
    return () => clearInterval(interval)
  }, [fetchWatchlist, fetchPrices])

  const handleAdd = async () => {
    if (!addSymbol.trim()) return
    setAdding(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: addSymbol.toUpperCase() }),
      })
      if (res.ok) {
        setAddSymbol('')
        await fetchWatchlist()
      }
    } catch (err) {
      console.error('[WatchlistPanel] add error:', err)
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await fetch(`${BACKEND_URL}/api/watchlist/${id}`, { method: 'DELETE' })
      await fetchWatchlist()
    } catch (err) {
      console.error('[WatchlistPanel] delete error:', err)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Add bar */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '8px 8px 4px',
        borderBottom: '1px solid var(--border-primary)',
      }}>
        <input
          placeholder="Add symbol..."
          value={addSymbol}
          onChange={(e) => setAddSymbol(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          style={{
            flex: 1,
            height: 28,
            padding: '0 8px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 3,
            color: 'var(--text-primary)',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <Button size="sm" onClick={handleAdd} loading={adding} style={{ height: 28, fontSize: 11 }}>
          +
        </Button>
      </div>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 10px',
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--bg-secondary)',
      }}>
        <span style={{ flex: 1 }}>Symbol</span>
        <span style={{ width: 70, textAlign: 'right' }}>Price</span>
        <span style={{ width: 65, textAlign: 'right' }}>Change %</span>
        <span style={{ width: 24 }} />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {entries.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
            Watchlist empty. Add a symbol above.
          </div>
        )}
        {entries.map((entry) => {
          const stock = (entry as any).stock
          const price = (entry as any).price
          const changePct = price?.changePct ?? 0
          const isPositive = changePct >= 0
          const isHovered = hoveredId === entry.id

          return (
            <div
              key={entry.id}
              onClick={() => stock && onSelectStock(stock.symbol)}
              onMouseEnter={() => setHoveredId(entry.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '7px 10px',
                cursor: 'pointer',
                backgroundColor: isHovered ? 'var(--bg-secondary)' : 'transparent',
                transition: 'background 100ms',
                borderBottom: '1px solid var(--bg-secondary)',
              }}
            >
              {/* Color indicator */}
              <span style={{
                width: 3,
                height: 20,
                borderRadius: 2,
                backgroundColor: isPositive ? 'var(--color-success)' : 'var(--color-error)',
                marginRight: 8,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {stock?.symbol ?? '...'}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {stock?.name ?? ''}
                </div>
              </div>
              <span style={{ width: 70, textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                {price ? `$${price.price.toFixed(2)}` : '--'}
              </span>
              <span style={{
                width: 65,
                textAlign: 'right',
                fontSize: 12,
                fontWeight: 500,
                color: isPositive ? 'var(--color-success)' : 'var(--color-error)',
              }}>
                {price ? `${isPositive ? '+' : ''}${changePct.toFixed(2)}%` : '--'}
              </span>
              <div style={{ width: 24, display: 'flex', justifyContent: 'center' }}>
                {isHovered && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(entry.id) }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: 0,
                      lineHeight: 1,
                    }}
                    title="Remove"
                  >
                    &#215;
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
