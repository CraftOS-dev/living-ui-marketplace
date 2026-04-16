import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts'
import type { AppController } from '../AppController'
import type { ChartConfig, ChartType, Timeframe, Candle } from '../types'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

interface ChartWidgetProps {
  controller: AppController
  config: ChartConfig
  widgetId: string
  onConfigChange?: (config: ChartConfig) => void
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D', '1W', '1M']
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'candlestick', label: 'Candles' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'heikinAshi', label: 'Heikin-Ashi' },
  { value: 'bars', label: 'Bars' },
  { value: 'baseline', label: 'Baseline' },
]

const toolbarStyles = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    backgroundColor: 'var(--bg-primary)',
    borderBottom: '1px solid var(--border-primary)',
    height: 36,
    minHeight: 36,
    flexWrap: 'wrap' as const,
  },
  tfBtn: {
    height: 24,
    padding: '0 8px',
    border: 'none',
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 100ms',
  },
  separator: {
    width: 1,
    height: 18,
    backgroundColor: 'var(--border-primary)',
    margin: '0 4px',
  },
  select: {
    height: 24,
    padding: '0 6px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 3,
    color: 'var(--text-primary)',
    fontSize: 11,
    cursor: 'pointer',
    outline: 'none',
  },
}

function computeHeikinAshi(candles: Candle[]): Candle[] {
  const result: Candle[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const haClose = (c.openPrice + c.high + c.low + c.closePrice) / 4
    let haOpen: number
    if (i === 0) {
      haOpen = (c.openPrice + c.closePrice) / 2
    } else {
      const prev = result[i - 1]
      haOpen = (prev.openPrice + prev.closePrice) / 2
    }
    const haHigh = Math.max(c.high, haOpen, haClose)
    const haLow = Math.min(c.low, haOpen, haClose)
    result.push({ ...c, openPrice: haOpen, closePrice: haClose, high: haHigh, low: haLow })
  }
  return result
}

const toTime = (ts: string): Time => (new Date(ts).getTime() / 1000) as Time

export function ChartWidget({ config, onConfigChange }: ChartWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<any> | null>(null)
  // Store all loaded candles, keyed by timestamp to deduplicate
  const candleMapRef = useRef<Map<string, Candle>>(new Map())
  const isFetchingRef = useRef(false)
  const isInitialLoadRef = useRef(true)

  const [chartType, setChartType] = useState<ChartType>(config.chartType || 'candlestick')
  const [timeframe, setTimeframe] = useState<Timeframe>(config.timeframe || '1D')
  const [symbol, setSymbol] = useState(config.symbol || 'AAPL')

  // Helper to get sorted candles from the map
  const getSortedCandles = useCallback((): Candle[] => {
    return Array.from(candleMapRef.current.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }, [])

  // Fetch candles and merge into existing data
  const fetchCandles = useCallback(async (opts?: { before?: string; limit?: number }) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    try {
      const limit = opts?.limit ?? 500
      let url = `${BACKEND_URL}/api/stocks/${symbol}/candles?timeframe=${timeframe}&limit=${limit}`
      if (opts?.before) {
        url += `&since=${encodeURIComponent('1970-01-01T00:00:00')}&before=${encodeURIComponent(opts.before)}`
      }
      const res = await fetch(url)
      if (res.ok) {
        const data: Candle[] = await res.json()
        let addedNew = false
        for (const candle of data) {
          if (!candleMapRef.current.has(candle.timestamp)) {
            addedNew = true
          }
          candleMapRef.current.set(candle.timestamp, candle)
        }
        return addedNew
      }
    } catch (err) {
      console.error('[ChartWidget] fetch candles error:', err)
    } finally {
      isFetchingRef.current = false
    }
    return false
  }, [symbol, timeframe])

  // Apply candle data to chart series without resetting viewport
  const updateSeriesData = useCallback((fitContent: boolean) => {
    const series = mainSeriesRef.current
    const volSeries = volumeSeriesRef.current
    if (!series || !volSeries) return

    let candles = getSortedCandles()
    if (candles.length === 0) return

    const displayCandles = chartType === 'heikinAshi' ? computeHeikinAshi(candles) : candles

    // Build series data based on chart type
    if (chartType === 'line' || chartType === 'area' || chartType === 'baseline') {
      series.setData(
        displayCandles.map((c) => ({
          time: toTime(c.timestamp),
          value: c.closePrice,
        }))
      )
    } else {
      series.setData(
        displayCandles.map((c) => ({
          time: toTime(c.timestamp),
          open: c.openPrice,
          high: c.high,
          low: c.low,
          close: c.closePrice,
        }))
      )
    }

    volSeries.setData(
      displayCandles.map((c) => ({
        time: toTime(c.timestamp),
        value: c.volume,
        color: c.closePrice >= c.openPrice ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
      }))
    )

    if (fitContent) {
      chartRef.current?.timeScale().fitContent()
    }
  }, [chartType, getSortedCandles])

  // Create chart (once)
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: '#0A0A0A' },
        textColor: '#FFFFFF',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#171717' },
        horzLines: { color: '#171717' },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: '#404040', timeVisible: true },
      rightPriceScale: { borderColor: '#404040' },
    })

    chartRef.current = chart

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      mainSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [])

  // Create series when chart type changes — this is the only time we recreate series
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove old series
    if (mainSeriesRef.current) {
      try { chart.removeSeries(mainSeriesRef.current) } catch { /* ignore */ }
      mainSeriesRef.current = null
    }
    if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current) } catch { /* ignore */ }
      volumeSeriesRef.current = null
    }

    // Create main series based on type
    if (chartType === 'line') {
      mainSeriesRef.current = chart.addLineSeries({ color: '#FF4F18', lineWidth: 2 })
    } else if (chartType === 'area') {
      mainSeriesRef.current = chart.addAreaSeries({
        topColor: 'rgba(255, 79, 24, 0.4)',
        bottomColor: 'transparent',
        lineColor: '#FF4F18',
        lineWidth: 2,
      })
    } else if (chartType === 'baseline') {
      const candles = getSortedCandles()
      const avgPrice = candles.length > 0
        ? candles.reduce((s, c) => s + c.closePrice, 0) / candles.length
        : 100
      mainSeriesRef.current = chart.addBaselineSeries({
        baseValue: { type: 'price', price: avgPrice },
        topLineColor: '#22C55E',
        topFillColor1: 'rgba(34, 197, 94, 0.28)',
        topFillColor2: 'rgba(34, 197, 94, 0.05)',
        bottomLineColor: '#EF4444',
        bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
        bottomFillColor2: 'rgba(239, 68, 68, 0.28)',
      })
    } else if (chartType === 'bars') {
      mainSeriesRef.current = chart.addBarSeries({ upColor: '#22C55E', downColor: '#EF4444' })
    } else {
      // candlestick or heikinAshi
      mainSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#22C55E',
        downColor: '#EF4444',
        borderUpColor: '#22C55E',
        borderDownColor: '#EF4444',
        wickUpColor: '#22C55E',
        wickDownColor: '#EF4444',
      })
    }

    // Volume series
    volumeSeriesRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    // Populate with existing data
    updateSeriesData(true)
  }, [chartType]) // Only recreate series when chart type changes

  // When symbol or timeframe changes, clear data and fetch fresh
  useEffect(() => {
    candleMapRef.current.clear()
    isInitialLoadRef.current = true
    const load = async () => {
      await fetchCandles({ limit: 500 })
      updateSeriesData(true)
    }
    load()
  }, [symbol, timeframe])

  // Polling: update only the latest candle(s) without resetting viewport
  useEffect(() => {
    const poll = async () => {
      const candles = getSortedCandles()
      if (candles.length === 0) return

      // Fetch only recent candles (last 5) to update the latest bar
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/stocks/${symbol}/candles?timeframe=${timeframe}&limit=5`
        )
        if (res.ok) {
          const data: Candle[] = await res.json()
          for (const candle of data) {
            candleMapRef.current.set(candle.timestamp, candle)
          }
          // Update series data WITHOUT fitting content — preserves user's scroll position
          updateSeriesData(false)
        }
      } catch {
        // Ignore polling errors
      }
    }

    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [symbol, timeframe, updateSeriesData, getSortedCandles])

  // Lazy load: fetch older data when user scrolls to the left edge
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handler = () => {
      const logicalRange = chart.timeScale().getVisibleLogicalRange()
      if (!logicalRange) return

      // If user scrolled so the left edge is near the beginning of loaded data
      if (logicalRange.from < 10) {
        const candles = getSortedCandles()
        if (candles.length === 0) return

        const oldestTimestamp = candles[0].timestamp
        // Fetch older candles before the oldest we have
        fetchCandles({ before: oldestTimestamp, limit: 500 }).then((addedNew) => {
          if (addedNew) {
            updateSeriesData(false) // Don't reset viewport
          }
        })
      }
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler)
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
    }
  }, [fetchCandles, updateSeriesData, getSortedCandles])

  // Sync config changes from parent
  useEffect(() => {
    if (config.symbol && config.symbol !== symbol) setSymbol(config.symbol)
  }, [config.symbol])

  // Notify parent of config changes
  useEffect(() => {
    onConfigChange?.({ ...config, symbol, timeframe, chartType })
  }, [symbol, timeframe, chartType])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={toolbarStyles.toolbar}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginRight: 8 }}>
          {symbol}
        </span>
        <div style={toolbarStyles.separator} />
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            style={{
              ...toolbarStyles.tfBtn,
              backgroundColor: timeframe === tf ? 'var(--color-primary)' : 'transparent',
              color: timeframe === tf ? '#fff' : 'var(--text-secondary)',
            }}
            onClick={() => setTimeframe(tf)}
          >
            {tf}
          </button>
        ))}
        <div style={toolbarStyles.separator} />
        <select
          style={toolbarStyles.select}
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartType)}
        >
          {CHART_TYPES.map((ct) => (
            <option key={ct.value} value={ct.value}>
              {ct.label}
            </option>
          ))}
        </select>
      </div>
      <div ref={containerRef} style={{ flex: 1, position: 'relative', minHeight: 0 }} />
    </div>
  )
}
