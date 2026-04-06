import { useEffect, useState, useCallback } from 'react'
import type { AppController } from '../AppController'
import type { StockPrice, Stock } from '../types'

const BACKEND_URL = 'http://localhost:3107'

interface StockDetailsPanelProps {
  controller: AppController
  symbol: string
}

export function StockDetailsPanel({ controller: _controller, symbol }: StockDetailsPanelProps) {
  const [stock, setStock] = useState<Stock | null>(null)
  const [price, setPrice] = useState<StockPrice | null>(null)

  const fetchDetails = useCallback(async () => {
    if (!symbol) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/stocks/${symbol}/price`)
      if (res.ok) {
        const data = await res.json()
        setStock({
          id: data.id,
          symbol: data.symbol,
          name: data.name,
          sector: data.sector,
          marketCap: data.marketCap,
          exchange: data.exchange,
          createdAt: data.createdAt,
        })
        setPrice(data.price ?? null)
      }
    } catch (err) {
      console.error('[StockDetailsPanel] fetch error:', err)
    }
  }, [symbol])

  useEffect(() => {
    fetchDetails()
    const interval = setInterval(fetchDetails, 3000)
    return () => clearInterval(interval)
  }, [fetchDetails])

  if (!symbol) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
        Select a stock to view details
      </div>
    )
  }

  const changePct = price?.changePct ?? 0
  const isPositive = changePct >= 0

  const statRow = (label: string, value: string) => (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '5px 0',
      borderBottom: '1px solid var(--bg-secondary)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )

  return (
    <div style={{ padding: 12, height: '100%', overflowY: 'auto' }}>
      {/* Symbol + Name */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
          {stock?.symbol ?? symbol}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          {stock?.name ?? ''} {stock?.exchange ? `- ${stock.exchange}` : ''}
        </div>
        {stock?.sector && (
          <div style={{
            display: 'inline-block',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            marginTop: 4,
          }}>
            {stock.sector}
          </div>
        )}
      </div>

      {/* Price */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
          {price ? `$${price.price.toFixed(2)}` : '--'}
        </span>
        <span style={{
          fontSize: 14,
          fontWeight: 600,
          color: isPositive ? 'var(--color-success)' : 'var(--color-error)',
          marginLeft: 10,
        }}>
          {price ? `${isPositive ? '+' : ''}${price.change.toFixed(2)} (${isPositive ? '+' : ''}${changePct.toFixed(2)}%)` : ''}
        </span>
      </div>

      {/* Key Stats */}
      <div>
        {statRow('Open', price ? `$${price.openPrice.toFixed(2)}` : '--')}
        {statRow('High', price ? `$${price.high.toFixed(2)}` : '--')}
        {statRow('Low', price ? `$${price.low.toFixed(2)}` : '--')}
        {statRow('Prev Close', price ? `$${price.prevClose.toFixed(2)}` : '--')}
        {statRow('Volume', price ? price.volume.toLocaleString() : '--')}
        {stock?.marketCap != null && statRow('Market Cap', formatMarketCap(stock.marketCap))}
      </div>
    </div>
  )
}

function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString()}`
}
