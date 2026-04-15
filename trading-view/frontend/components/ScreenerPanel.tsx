import { useEffect, useState, useCallback } from 'react'
import { Table } from './ui'
import type { TableColumn } from './ui'
import type { AppController } from '../AppController'

const BACKEND_URL = 'http://localhost:{{BACKEND_PORT}}'

interface ScreenerPanelProps {
  controller: AppController
  onSelectStock?: (symbol: string) => void
}

const SECTORS = [
  { value: '', label: 'All Sectors' },
  { value: 'Technology', label: 'Technology' },
  { value: 'Healthcare', label: 'Healthcare' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Consumer', label: 'Consumer' },
  { value: 'Energy', label: 'Energy' },
  { value: 'Industrial', label: 'Industrial' },
  { value: 'Communications', label: 'Communications' },
  { value: 'ETF', label: 'ETF' },
]

const SORT_OPTIONS = [
  { value: 'symbol', label: 'Symbol' },
  { value: 'price', label: 'Price' },
  { value: 'changePct', label: 'Change %' },
  { value: 'volume', label: 'Volume' },
]

export function ScreenerPanel({ controller: _controller, onSelectStock }: ScreenerPanelProps) {
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sector, setSector] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minChangePct, setMinChangePct] = useState('')
  const [maxChangePct, setMaxChangePct] = useState('')
  const [sort, setSort] = useState('symbol')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const fetchScreener = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (sector) params.set('sector', sector)
      if (minPrice) params.set('min_price', minPrice)
      if (maxPrice) params.set('max_price', maxPrice)
      if (minChangePct) params.set('min_change_pct', minChangePct)
      if (maxChangePct) params.set('max_change_pct', maxChangePct)
      if (sort) params.set('sort', sort)
      params.set('sort_dir', sortDir)

      const queryStr = params.toString()
      const res = await fetch(`${BACKEND_URL}/api/screener` + (queryStr ? `?${queryStr}` : ''))
      if (res.ok) {
        const data = await res.json()
        setResults(data)
      }
    } catch (err) {
      console.error('[ScreenerPanel] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [sector, minPrice, maxPrice, minChangePct, maxChangePct, sort, sortDir])

  useEffect(() => {
    fetchScreener()
  }, [fetchScreener])

  const columns: TableColumn<any>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      width: '80px',
      render: (item) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.symbol}</span>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      render: (item) => (
        <span style={{
          color: 'var(--text-secondary)',
          fontSize: 12,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'block',
          maxWidth: 140,
        }}>
          {item.name}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      width: '80px',
      render: (item) => (
        <span style={{ color: 'var(--text-primary)' }}>
          {item.price ? `$${item.price.price.toFixed(2)}` : '--'}
        </span>
      ),
    },
    {
      key: 'changePct',
      header: 'Change %',
      align: 'right',
      width: '80px',
      render: (item) => {
        const pct = item.price?.changePct ?? 0
        const isPos = pct >= 0
        return (
          <span style={{ color: isPos ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 500 }}>
            {isPos ? '+' : ''}{pct.toFixed(2)}%
          </span>
        )
      },
    },
    {
      key: 'volume',
      header: 'Volume',
      align: 'right',
      width: '90px',
      render: (item) => (
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          {item.price ? item.price.volume.toLocaleString() : '--'}
        </span>
      ),
    },
    {
      key: 'sector',
      header: 'Sector',
      width: '80px',
      render: (item) => (
        <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{item.sector}</span>
      ),
    },
  ]

  const filterInputStyle: React.CSSProperties = {
    height: 26,
    padding: '0 6px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 3,
    color: 'var(--text-primary)',
    fontSize: 11,
    outline: 'none',
    width: 70,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filters */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '8px 8px',
        borderBottom: '1px solid var(--border-primary)',
        alignItems: 'center',
      }}>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          style={{
            ...filterInputStyle,
            width: 100,
            cursor: 'pointer',
          }}
        >
          {SECTORS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <input
          placeholder="Min $"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          style={filterInputStyle}
          type="number"
        />
        <input
          placeholder="Max $"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          style={filterInputStyle}
          type="number"
        />

        <input
          placeholder="Min %"
          value={minChangePct}
          onChange={(e) => setMinChangePct(e.target.value)}
          style={filterInputStyle}
          type="number"
        />
        <input
          placeholder="Max %"
          value={maxChangePct}
          onChange={(e) => setMaxChangePct(e.target.value)}
          style={filterInputStyle}
          type="number"
        />

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          style={{ ...filterInputStyle, width: 80, cursor: 'pointer' }}
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          style={{
            ...filterInputStyle,
            width: 28,
            textAlign: 'center',
            cursor: 'pointer',
            background: 'var(--bg-secondary)',
          }}
          title={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
        >
          {sortDir === 'asc' ? '\u2191' : '\u2193'}
        </button>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Loading...
          </div>
        ) : (
          <Table
            columns={columns}
            data={results}
            emptyMessage="No stocks match the filters"
            onRowClick={(item) => onSelectStock?.(item.symbol)}
            rowKey={(item) => item.symbol}
          />
        )}
      </div>
    </div>
  )
}
