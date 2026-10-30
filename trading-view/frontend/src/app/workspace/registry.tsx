/** Every widget type: name, icon, what it is for, default size and component. */
import { Activity, Bell, CandlestickChart, GalleryHorizontal, Grid2x2, Info, LayoutGrid, ListChecks, Newspaper, ScanLine, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WidgetType, Widget } from '../lib/types.ts';
import { ActivityWidget } from '../widgets/Activity.tsx';
import { AlertsWidget } from '../widgets/Alerts.tsx';
import { AnalystWidget } from '../widgets/Analyst.tsx';
import { ChartGridWidget } from '../widgets/ChartGrid.tsx';
import { ChartWidget } from '../widgets/chart/ChartWidget.tsx';
import { DetailsWidget } from '../widgets/Details.tsx';
import { HeatmapWidget } from '../widgets/Heatmap.tsx';
import { NewsWidget } from '../widgets/News.tsx';
import { ScreenerWidget } from '../widgets/Screener.tsx';
import { TickerWidget } from '../widgets/Ticker.tsx';
import { WatchlistWidget } from '../widgets/Watchlist.tsx';

export interface WidgetDef {
  type: WidgetType;
  label: string;
  icon: LucideIcon;
  description: string;
  minW: number;
  minH: number;
  component: (p: { w: Widget }) => React.JSX.Element;
}

export const WIDGET_DEFS: WidgetDef[] = [
  { type: 'chart', label: 'Chart', icon: CandlestickChart, description: 'Candles, indicators, drawings, alerts, comparisons', minW: 6, minH: 8, component: ChartWidget },
  { type: 'chartgrid', label: 'Multi-timeframe', icon: Grid2x2, description: 'One symbol on 2 to 6 intervals', minW: 8, minH: 10, component: ChartGridWidget },
  { type: 'watchlist', label: 'Watchlist', icon: ListChecks, description: 'Live quotes, sections, flags and notes', minW: 4, minH: 6, component: WatchlistWidget },
  { type: 'details', label: 'Details', icon: Info, description: 'Price, ranges, statistics, performance, hours', minW: 4, minH: 8, component: DetailsWidget },
  { type: 'analyst', label: 'AI analyst', icon: Sparkles, description: 'Ask your AI agent; its analyses and levels', minW: 5, minH: 8, component: AnalystWidget },
  { type: 'news', label: 'News', icon: Newspaper, description: 'Headlines for the symbol or the market', minW: 4, minH: 5, component: NewsWidget },
  { type: 'alerts', label: 'Alerts', icon: Bell, description: 'Your alerts and what fired', minW: 5, minH: 5, component: AlertsWidget },
  { type: 'screener', label: 'Screener', icon: ScanLine, description: 'Filter universes on quote and technical fields', minW: 8, minH: 6, component: ScreenerWidget },
  { type: 'heatmap', label: 'Heatmap', icon: LayoutGrid, description: "Today's moves by sector or category", minW: 5, minH: 6, component: HeatmapWidget },
  { type: 'ticker', label: 'Ticker strip', icon: GalleryHorizontal, description: 'A row of quotes across the top', minW: 6, minH: 2, component: TickerWidget },
  { type: 'activity', label: 'Activity', icon: Activity, description: 'Every change by you and your AI agent, with undo', minW: 5, minH: 5, component: ActivityWidget },
];

export const DEF: Record<WidgetType, WidgetDef> = Object.fromEntries(WIDGET_DEFS.map((d) => [d.type, d])) as Record<WidgetType, WidgetDef>;
