import { useEffect, useState, useCallback } from 'react'
import { Button } from './ui'
import type { AppController } from '../AppController'
import type { MarketNews } from '../types'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

interface NewsPanelProps {
  controller: AppController
  symbol?: string
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function NewsPanel({ controller: _controller, symbol }: NewsPanelProps) {
  const [news, setNews] = useState<MarketNews[]>([])
  const [loading, setLoading] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState(-1)

  const fetchNews = useCallback(async () => {
    setLoading(true)
    try {
      let newsUrl = `${BACKEND_URL}/api/news`
      if (symbol) {
        newsUrl = `${BACKEND_URL}/api/news?symbol=${encodeURIComponent(symbol)}`
      }
      const res = await fetch(newsUrl)
      if (res.ok) {
        const data = await res.json()
        setNews(data)
      }
    } catch (err) {
      console.error('[NewsPanel] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderBottom: '1px solid var(--border-primary)',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
          {symbol ? `News - ${symbol}` : 'Market News'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={fetchNews}
          loading={loading}
          style={{ height: 24, fontSize: 11, color: 'var(--text-secondary)' }}
        >
          Refresh
        </Button>
      </div>

      {/* News list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && news.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Loading news...
          </div>
        )}
        {!loading && news.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            No news available
          </div>
        )}
        {news.map((item, idx) => (
          <div
            key={item.id}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(-1)}
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--bg-secondary)',
              cursor: item.url ? 'pointer' : 'default',
              backgroundColor: hoveredIdx === idx ? 'var(--bg-secondary)' : 'transparent',
              transition: 'background 100ms',
            }}
            onClick={() => {
              if (item.url) window.open(item.url, '_blank', 'noopener')
            }}
          >
            <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
              lineHeight: 1.4,
              marginBottom: 4,
            }}>
              {item.headline}
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              color: 'var(--text-secondary)',
            }}>
              <span>{item.source}</span>
              <span style={{ color: 'var(--border-primary)' }}>|</span>
              <span>{timeAgo(item.publishedAt)}</span>
              {item.stockSymbol && (
                <>
                  <span style={{ color: 'var(--border-primary)' }}>|</span>
                  <span style={{
                    backgroundColor: 'var(--bg-secondary)',
                    padding: '1px 5px',
                    borderRadius: 2,
                    fontSize: 10,
                    fontWeight: 600,
                  }}>
                    {item.stockSymbol}
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
