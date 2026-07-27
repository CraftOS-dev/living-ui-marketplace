import { useCallback, useRef } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import type { AppController } from '../AppController'
import type { LayoutData, ChartConfig } from '../types'
import { WidgetWrapper } from './WidgetWrapper'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface WidgetDef {
  id: string
  title: string
  element: React.ReactNode
}

interface DashboardLayoutProps {
  controller: AppController
  layout: LayoutData
  chartConfig: Record<string, ChartConfig>
  onLayoutChange: (layout: LayoutData) => void
  widgets: WidgetDef[]
}

const EXTRA_CSS = `
.react-grid-item > .react-resizable-handle::after {
  border-right: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
}
.react-grid-placeholder {
  background: var(--color-primary-light) !important;
  border: 1px dashed var(--color-primary) !important;
  border-radius: 4px;
  opacity: 1;
}
.react-grid-item.react-draggable-dragging {
  z-index: 10;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
`

export function DashboardLayout({
  layout,
  onLayoutChange,
  widgets,
}: DashboardLayoutProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLayoutChange = useCallback(
    (_currentLayout: any, allLayouts: any) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        onLayoutChange(allLayouts as LayoutData)
      }, 500)
    },
    [onLayoutChange],
  )

  return (
    <>
      <style>{EXTRA_CSS}</style>
      <ResponsiveGridLayout
        layouts={layout as any}
        breakpoints={{ lg: 1280, md: 996, sm: 768 }}
        cols={{ lg: 12, md: 10, sm: 4 }}
        rowHeight={30}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".drag-handle"
        compactType="vertical"
        margin={[6, 6]}
        containerPadding={[6, 6]}
        isResizable={true}
        isDraggable={true}
      >
        {widgets.map((w) => (
          <div key={w.id} style={{ overflow: 'hidden' }}>
            <WidgetWrapper title={w.title} widgetId={w.id}>
              {w.element}
            </WidgetWrapper>
          </div>
        ))}
      </ResponsiveGridLayout>
    </>
  )
}
