import { useEffect, useState, useCallback } from 'react'
import type { AppController } from '../AppController'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

interface MarketOverviewPanelProps {
  controller: AppController
}

const INDEX_ETFS = ['SPY', 'QQQ', 'DIA']

interface PriceInfo {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  sector: string
}

export function MarketOverviewPanel({ controller: _controller }: MarketOverviewPanelProps) {
  const [, setStocks] = useState<PriceInfo[]>([])
  const [indices, setIndices] = useState<PriceInfo[]>([])
  const [sectorMap, setSectorMap] = useState<Map<string, { totalChangePct: number; count: number }>>(new Map())

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/stocks`)
      if (!res.ok) return
      const data = await res.json()

      const all: PriceInfo[] = data
        .filter((s: any) => s.price)
        .map((s: any) => ({
          symbol: s.symbol,
          name: s.name,
          price: s.price.price,
          change: s.price.change,
          changePct: s.price.changePct,
          sector: s.sector,
        }))

      setStocks(all)
      setIndices(all.filter((s) => INDEX_ETFS.includes(s.symbol)))

      // Sector breakdown
      const sectors = new Map<string, { totalChangePct: number; count: number }>()
      for (const s of all) {
        if (!s.sector || s.sector === 'ETF') continue
        const existing = sectors.get(s.sector) || { totalChangePct: 0, count: 0 }
        existing.totalChangePct += s.changePct
        existing.count += 1
        sectors.set(s.sector, existing)
      }
      setSectorMap(sectors)
    } catch (err) {
      console.error('[MarketOverview] fetch error:', err)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const sectorEntries = Array.from(sectorMap.entries()).map(([sector, data]) => ({
    sector,
    avgChangePct: data.totalChangePct / data.count,
  }))
  sectorEntries.sort((a, b) => b.avgChangePct - a.avgChangePct)

  return (
    <div style={{ padding: 12, height: '100%', overflowY: 'auto' }}>
      {/* Index ETFs */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Market Indices
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          {indices.map((idx) => {
            const isPositive = idx.changePct >= 0
            return (
              <div
                key={idx.symbol}
                style={{
                  padding: '10px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 4,
                  border: '1px solid var(--border-primary)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {idx.symbol}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  ${idx.price.toFixed(2)}
                </div>
                <div style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: isPositive ? 'var(--color-success)' : 'var(--color-error)',
                  marginTop: 2,
                }}>
                  {isPositive ? '+' : ''}{idx.changePct.toFixed(2)}%
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sector Breakdown */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Sector Performance
        </div>
        {sectorEntries.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>No sector data available</div>
        )}
        {sectorEntries.map(({ sector, avgChangePct }) => {
          const isPositive = avgChangePct >= 0
          const barWidth = Math.min(Math.abs(avgChangePct) * 20, 100)
          return (
            <div
              key={sector}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid var(--bg-secondary)',
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>{sector}</span>
              <div style={{
                width: 80,
                height: 4,
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: 2,
                marginRight: 8,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${barWidth}%`,
                  height: '100%',
                  backgroundColor: isPositive ? 'var(--color-success)' : 'var(--color-error)',
                  borderRadius: 2,
                }} />
              </div>
              <span style={{
                width: 55,
                textAlign: 'right',
                fontSize: 12,
                fontWeight: 500,
                color: isPositive ? 'var(--color-success)' : 'var(--color-error)',
              }}>
                {isPositive ? '+' : ''}{avgChangePct.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
