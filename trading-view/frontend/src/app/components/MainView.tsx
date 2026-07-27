import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { LayoutData, ChartConfig } from '../types'
import { TopBar } from './TopBar'
import { DashboardLayout } from './DashboardLayout'
import { ChartWidget } from './ChartWidget'
import { WatchlistPanel } from './WatchlistPanel'
import { StockDetailsPanel } from './StockDetailsPanel'
import { NewsPanel } from './NewsPanel'
import { ScreenerPanel } from './ScreenerPanel'
import { AlertsPanel } from './AlertsPanel'
import { SearchModal } from './SearchModal'
import { MobileNavBar } from './MobileNavBar'
import type { MobileTab } from './MobileNavBar'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3105'

const DEFAULT_LAYOUT: LayoutData = {
  lg: [
    { i: 'chart-1', x: 0, y: 0, w: 8, h: 12, minW: 4, minH: 6 },
    { i: 'watchlist', x: 8, y: 0, w: 4, h: 8, minW: 3, minH: 4 },
    { i: 'details', x: 8, y: 8, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'news', x: 0, y: 12, w: 6, h: 6, minW: 3, minH: 3 },
    { i: 'screener', x: 6, y: 12, w: 6, h: 6, minW: 4, minH: 4 },
  ],
  md: [
    { i: 'chart-1', x: 0, y: 0, w: 6, h: 10, minW: 4, minH: 6 },
    { i: 'watchlist', x: 6, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
    { i: 'details', x: 6, y: 6, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'news', x: 0, y: 10, w: 5, h: 5, minW: 3, minH: 3 },
    { i: 'screener', x: 5, y: 10, w: 5, h: 5, minW: 4, minH: 4 },
  ],
  sm: [
    { i: 'chart-1', x: 0, y: 0, w: 4, h: 8, minW: 4, minH: 6 },
    { i: 'watchlist', x: 0, y: 8, w: 4, h: 6, minW: 3, minH: 4 },
    { i: 'details', x: 0, y: 14, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'news', x: 0, y: 18, w: 4, h: 5, minW: 3, minH: 3 },
    { i: 'screener', x: 0, y: 23, w: 4, h: 5, minW: 4, minH: 4 },
  ],
}

const DEFAULT_CHART_CONFIG: Record<string, ChartConfig> = {
  'chart-1': {
    symbol: 'AAPL',
    timeframe: '1D',
    chartType: 'candlestick',
    indicators: [],
  },
}

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [layout, setLayout] = useState<LayoutData>(DEFAULT_LAYOUT)
  const [chartConfig, setChartConfig] = useState<Record<string, ChartConfig>>(DEFAULT_CHART_CONFIG)
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL')
  const [searchOpen, setSearchOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart')
  const [, setInitialized] = useState(false)

  // Make component agent-aware
  useAgentAware('MainView', {
    currentSection: 'dashboard',
    selectedSymbol,
    mobileTab: isMobile ? mobileTab : null,
  })

  // Load saved layout on mount. Stock-universe seeding happens once in
  // AppController.initialize() — don't re-trigger it here on every nav.
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/layout`)
        if (res.ok) {
          const data = await res.json()
          if (data.layoutData) setLayout(data.layoutData)
          if (data.chartConfig) setChartConfig(data.chartConfig)
        }
      } catch (err) {
        console.warn('[MainView] load layout failed:', err)
      }
      setInitialized(true)
    }
    init()
  }, [])

  // Responsive check
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Select stock handler
  const handleSelectStock = useCallback((symbol: string) => {
    setSelectedSymbol(symbol)
    setChartConfig((prev) => ({
      ...prev,
      'chart-1': {
        ...(prev['chart-1'] || DEFAULT_CHART_CONFIG['chart-1']),
        symbol,
      },
    }))
  }, [])

  // Layout change handler
  const handleLayoutChange = useCallback((newLayout: LayoutData) => {
    setLayout(newLayout)
    // Debounced save happens inside DashboardLayout, but also persist here
    fetch(`${BACKEND_URL}/api/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layoutData: newLayout, chartConfig }),
    }).catch((err) => console.warn('[MainView] save layout error:', err))
  }, [chartConfig])

  // Save layout explicitly
  const handleSaveLayout = useCallback(async () => {
    try {
      await fetch(`${BACKEND_URL}/api/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutData: layout, chartConfig }),
      })
    } catch (err) {
      console.warn('[MainView] save layout error:', err)
    }
  }, [layout, chartConfig])

  // Reset layout
  const handleResetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT)
    setChartConfig(DEFAULT_CHART_CONFIG)
    fetch(`${BACKEND_URL}/api/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layoutData: DEFAULT_LAYOUT, chartConfig: DEFAULT_CHART_CONFIG }),
    }).catch(() => {})
  }, [])

  // Chart config change from ChartWidget
  const handleChartConfigChange = useCallback((cfg: ChartConfig) => {
    setChartConfig((prev) => ({ ...prev, 'chart-1': cfg }))
    setSelectedSymbol(cfg.symbol)
  }, [])

  // Build widget definitions
  const widgets = useMemo(() => [
    {
      id: 'chart-1',
      title: `Chart - ${chartConfig['chart-1']?.symbol || 'AAPL'}`,
      element: (
        <ChartWidget
          controller={controller}
          config={chartConfig['chart-1'] || DEFAULT_CHART_CONFIG['chart-1']}
          widgetId="chart-1"
          onConfigChange={handleChartConfigChange}
        />
      ),
    },
    {
      id: 'watchlist',
      title: 'Watchlist',
      element: (
        <WatchlistPanel
          controller={controller}
          onSelectStock={handleSelectStock}
        />
      ),
    },
    {
      id: 'details',
      title: 'Stock Details',
      element: (
        <StockDetailsPanel
          controller={controller}
          symbol={selectedSymbol}
        />
      ),
    },
    {
      id: 'news',
      title: 'News',
      element: (
        <NewsPanel
          controller={controller}
          symbol={selectedSymbol}
        />
      ),
    },
    {
      id: 'screener',
      title: 'Screener',
      element: (
        <ScreenerPanel
          controller={controller}
          onSelectStock={handleSelectStock}
        />
      ),
    },
  ], [controller, chartConfig, selectedSymbol, handleSelectStock, handleChartConfigChange])

  // Mobile view: show only the active tab's widget
  if (isMobile) {
    let activeWidget: React.ReactNode = null
    switch (mobileTab) {
      case 'chart':
        activeWidget = (
          <ChartWidget
            controller={controller}
            config={chartConfig['chart-1'] || DEFAULT_CHART_CONFIG['chart-1']}
            widgetId="chart-1"
            onConfigChange={handleChartConfigChange}
          />
        )
        break
      case 'watchlist':
        activeWidget = (
          <WatchlistPanel
            controller={controller}
            onSelectStock={handleSelectStock}
          />
        )
        break
      case 'screener':
        activeWidget = (
          <ScreenerPanel
            controller={controller}
            onSelectStock={handleSelectStock}
          />
        )
        break
      case 'alerts':
        activeWidget = (
          <AlertsPanel controller={controller} />
        )
        break
    }

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--bg-primary)',
      }}>
        <TopBar
          controller={controller}
          onSearchOpen={() => setSearchOpen(true)}
          onSaveLayout={handleSaveLayout}
          onResetLayout={handleResetLayout}
        />
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: 56 }}>
          {activeWidget}
        </div>
        <MobileNavBar activeTab={mobileTab} onTabChange={setMobileTab} />
        <SearchModal
          controller={controller}
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelectStock={handleSelectStock}
        />
      </div>
    )
  }

  // Desktop view
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      <TopBar
        controller={controller}
        onSearchOpen={() => setSearchOpen(true)}
        onSaveLayout={handleSaveLayout}
        onResetLayout={handleResetLayout}
      />
      <div style={{ flex: 1, overflow: 'auto' }}>
        <DashboardLayout
          controller={controller}
          layout={layout}
          chartConfig={chartConfig}
          onLayoutChange={handleLayoutChange}
          widgets={widgets}
        />
      </div>
      <SearchModal
        controller={controller}
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectStock={handleSelectStock}
      />
    </div>
  )
}
