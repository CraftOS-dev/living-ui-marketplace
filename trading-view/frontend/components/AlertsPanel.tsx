import React, { useEffect, useState, useCallback } from 'react'
import { Button, Badge } from './ui'
import type { AppController } from '../AppController'
import type { PriceAlert } from '../types'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3105'

interface AlertsPanelProps {
  controller: AppController
}

export function AlertsPanel({ controller: _controller }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<(PriceAlert & { symbol?: string })[]>([])
  const [triggeredAlerts, setTriggeredAlerts] = useState<(PriceAlert & { symbol?: string })[]>([])
  const [symbol, setSymbol] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [condition, setCondition] = useState<'above' | 'below'>('above')
  const [creating, setCreating] = useState(false)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/alerts`)
      if (res.ok) {
        const data = await res.json()
        setAlerts(data.filter((a: any) => a.active && !a.triggered))
      }
    } catch (err) {
      console.error('[AlertsPanel] fetch error:', err)
    }
  }, [])

  const fetchTriggered = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/alerts/triggered`)
      if (res.ok) {
        const data = await res.json()
        setTriggeredAlerts(data)
      }
    } catch (err) {
      // silent
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
    fetchTriggered()
    const interval = setInterval(() => {
      fetchAlerts()
      fetchTriggered()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchAlerts, fetchTriggered])

  const handleCreate = async () => {
    if (!symbol.trim() || !targetPrice) return
    setCreating(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          targetPrice: parseFloat(targetPrice),
          condition,
        }),
      })
      if (res.ok) {
        setSymbol('')
        setTargetPrice('')
        await fetchAlerts()
      }
    } catch (err) {
      console.error('[AlertsPanel] create error:', err)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await fetch(`${BACKEND_URL}/api/alerts/${id}`, { method: 'DELETE' })
      await fetchAlerts()
    } catch (err) {
      console.error('[AlertsPanel] delete error:', err)
    }
  }

  const inputStyle: React.CSSProperties = {
    height: 28,
    padding: '0 8px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 3,
    color: 'var(--text-primary)',
    fontSize: 12,
    outline: 'none',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Create alert form */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--border-primary)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        alignItems: 'center',
      }}>
        <input
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          style={{ ...inputStyle, width: 65 }}
        />
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as 'above' | 'below')}
          style={{ ...inputStyle, width: 70, cursor: 'pointer' }}
        >
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
        <input
          placeholder="Price"
          value={targetPrice}
          onChange={(e) => setTargetPrice(e.target.value)}
          style={{ ...inputStyle, width: 70 }}
          type="number"
          step="0.01"
        />
        <Button size="sm" onClick={handleCreate} loading={creating} style={{ height: 28, fontSize: 11 }}>
          Add
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Active alerts */}
        <div style={{
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-primary)',
        }}>
          Active Alerts ({alerts.length})
        </div>
        {alerts.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
            No active alerts
          </div>
        )}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            onMouseEnter={() => setHoveredId(alert.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              borderBottom: '1px solid var(--bg-secondary)',
              backgroundColor: hoveredId === alert.id ? 'var(--bg-secondary)' : 'transparent',
              transition: 'background 100ms',
            }}
          >
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginRight: 6 }}>
                {alert.symbol ?? `#${alert.stockId}`}
              </span>
              <Badge variant={alert.condition === 'above' ? 'success' : 'error'} size="sm">
                {alert.condition} ${alert.targetPrice.toFixed(2)}
              </Badge>
            </div>
            {hoveredId === alert.id && (
              <button
                onClick={() => handleDelete(alert.id)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-error)',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '0 4px',
                  lineHeight: 1,
                }}
                title="Delete alert"
              >
                &#215;
              </button>
            )}
          </div>
        ))}

        {/* Triggered alerts */}
        {triggeredAlerts.length > 0 && (
          <>
            <div style={{
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              backgroundColor: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border-primary)',
              marginTop: 4,
            }}>
              Recently Triggered ({triggeredAlerts.length})
            </div>
            {triggeredAlerts.map((alert) => (
              <div
                key={alert.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--bg-secondary)',
                  opacity: 0.7,
                }}
              >
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginRight: 6 }}>
                    {alert.symbol ?? `#${alert.stockId}`}
                  </span>
                  <Badge variant="warning" size="sm">
                    triggered {alert.condition} ${alert.targetPrice.toFixed(2)}
                  </Badge>
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                  {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleTimeString() : ''}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
