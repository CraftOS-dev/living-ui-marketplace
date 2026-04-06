/**
 * TradingView Living UI - TypeScript Types
 */

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
}

export interface Stock {
  id: number
  symbol: string
  name: string
  sector: string
  marketCap: number | null
  exchange: string
  createdAt: string
}

export interface StockPrice {
  id: number
  stockId: number
  price: number
  openPrice: number
  high: number
  low: number
  prevClose: number
  volume: number
  change: number
  changePct: number
  updatedAt: string
}

export interface StockWithPrice extends Stock {
  stockPrice?: StockPrice
}

export interface Candle {
  id: number
  stockId: number
  timeframe: string
  timestamp: string
  openPrice: number
  high: number
  low: number
  closePrice: number
  volume: number
}

export interface WatchlistEntry {
  id: number
  stockId: number
  sortOrder: number
  createdAt: string
  stock?: Stock
  stockPrice?: StockPrice
}

export interface PriceAlert {
  id: number
  stockId: number
  targetPrice: number
  condition: 'above' | 'below'
  triggered: boolean
  triggeredAt: string | null
  active: boolean
  createdAt: string
  stock?: Stock
}

export interface Drawing {
  id: number
  stockId: number
  timeframe: string
  toolType: DrawingToolType
  drawingData: Record<string, unknown>
  color: string
  createdAt: string
}

export type DrawingToolType = 'trendline' | 'horizontal' | 'fibonacci' | 'channel' | 'rectangle' | 'text' | 'arrow'

export interface WidgetLayout {
  id: number
  layoutName: string
  layoutData: LayoutData
  chartConfig: Record<string, ChartConfig>
  updatedAt: string
}

export interface LayoutData {
  lg: LayoutItem[]
  md: LayoutItem[]
  sm: LayoutItem[]
}

export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export interface ChartConfig {
  symbol: string
  timeframe: Timeframe
  chartType: ChartType
  indicators: IndicatorConfig[]
}

export interface MarketNews {
  id: number
  stockSymbol: string | null
  headline: string
  summary: string | null
  source: string
  url: string | null
  publishedAt: string
  createdAt: string
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W' | '1M'
export type ChartType = 'candlestick' | 'line' | 'area' | 'heikinAshi' | 'bars' | 'baseline'
export type IndicatorType = 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'VWAP'

export interface IndicatorConfig {
  type: IndicatorType
  period: number
  color?: string
}

export interface IndicatorDataPoint {
  timestamp: string
  value?: number
  macd?: number
  signal?: number
  histogram?: number
  upper?: number
  middle?: number
  lower?: number
}

export interface ScreenerFilters {
  minPrice?: number
  maxPrice?: number
  minVolume?: number
  maxVolume?: number
  minChangePct?: number
  maxChangePct?: number
  sector?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
}

export type WidgetType = 'chart' | 'watchlist' | 'details' | 'news' | 'screener' | 'overview' | 'alerts'

export interface PriceTick {
  [symbol: string]: {
    price: number
    change: number
    changePct: number
  }
}
