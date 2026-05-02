import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import { useController, useSystemTheme, useViewport } from '../lib/hooks'
import { TopBar } from './TopBar'
import { HabitList } from './HabitList'
import { DashboardSidebar } from './DashboardSidebar'
import { HabitFormModal } from './HabitFormModal'
import { CategoryManagerModal } from './CategoryManagerModal'
import { HabitDetailPanel } from './HabitDetailPanel'
import { ResizablePanel } from './ResizablePanel'
import { Alert } from './ui'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  useSystemTheme()
  const snap = useController(controller)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const { isMobile } = useViewport()

  // Build a stable heatmap loader so MiniHeatmaps don't refetch on every render.
  const loadHeatmap = useCallback(
    async (habitId: number, days: number) => {
      const data = await controller.getHeatmap(habitId, days)
      return data.cells
    },
    [controller]
  )

  const visibleHabits = useMemo(() => {
    const q = snap.search.trim().toLowerCase()
    return snap.habits.filter((h) => {
      if (snap.categoryFilter !== null && (h.categoryId ?? h.category_id ?? null) !== snap.categoryFilter) {
        return false
      }
      if (!q) return true
      return h.name.toLowerCase().includes(q)
    })
  }, [snap.habits, snap.search, snap.categoryFilter])

  const selectedHabit = useMemo(
    () => snap.habits.find((h) => h.id === snap.selectedHabitId) || null,
    [snap.habits, snap.selectedHabitId]
  )

  const editingHabit = useMemo(() => {
    if (!snap.editingHabitId) return null
    return snap.habits.find((h) => h.id === snap.editingHabitId) || null
  }, [snap.habits, snap.editingHabitId])

  // Agent observation surface — habits + dashboard.
  useAgentAware('MainView', {
    todayCompleted: snap.dashboard.todayCompleted,
    todayTotal: snap.dashboard.todayTotal,
    weeklyRate: snap.dashboard.weeklyRate,
    activeStreaks: snap.dashboard.activeStreaks,
    selectedHabitId: snap.selectedHabitId,
    visibleHabitCount: visibleHabits.length,
    habits: snap.habits.map((h) => ({
      id: h.id,
      name: h.name,
      type: h.type,
      currentStreak: h.currentStreak ?? 0,
      todayCompleted: !!h.todayEntry?.completed,
      todayValue: h.todayEntry?.value ?? 0,
      target: h.target,
    })),
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
      const inField =
        tag === 'input' || tag === 'textarea' || (e.target as HTMLElement | null)?.isContentEditable

      // Esc closes overlays even from a field.
      if (e.key === 'Escape') {
        if (snap.showHabitForm) {
          controller.closeHabitForm()
          return
        }
        if (snap.showCategoryManager) {
          controller.closeCategoryManager()
          return
        }
        if (snap.selectedHabitId !== null) {
          controller.selectHabit(null)
          return
        }
      }

      if (inField) return
      if (snap.showHabitForm || snap.showCategoryManager) return

      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        controller.openCreateHabit()
        return
      }
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        const habit = visibleHabits[idx]
        if (habit) {
          // Just focus the habit (open the detail panel). Never modify the
          // value — the user toggles/edits via the row controls or panel.
          controller.selectHabit(habit.id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    controller,
    visibleHabits,
    snap.showHabitForm,
    snap.showCategoryManager,
    snap.selectedHabitId,
  ])

  if (!snap.initialized) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        Loading habits…
      </div>
    )
  }

  return (
    <div
      className="habit-tracker"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-primary)',
      }}
    >
      <TopBar
        search={snap.search}
        onSearch={(v) => controller.setSearch(v)}
        categories={snap.categories}
        categoryFilter={snap.categoryFilter}
        onCategoryFilter={(v) => controller.setCategoryFilter(v)}
        onAddHabit={() => controller.openCreateHabit()}
        onManageCategories={() => controller.openCategoryManager()}
        searchInputRef={searchRef}
      />

      {snap.error && (
        <div style={{ padding: '12px 20px' }}>
          <Alert variant="error">{snap.error}</Alert>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Habit list */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            padding: isMobile ? '8px 10px' : '12px 16px',
            overflowY: 'auto',
            background: 'var(--bg-primary)',
          }}
        >
          {/* Compact dashboard summary above the list on mobile */}
          {isMobile && snap.habits.length > 0 && (
            <MobileDashboardStrip
              summary={snap.dashboard}
            />
          )}

          <HabitList
            habits={visibleHabits}
            selectedId={snap.selectedHabitId}
            controller={controller}
            loadHeatmap={loadHeatmap}
            onSelect={(id) => controller.selectHabit(id)}
            onCreate={() => controller.openCreateHabit()}
          />
          {visibleHabits.length > 0 && visibleHabits.length < snap.habits.length && (
            <div
              style={{
                marginTop: 12,
                fontSize: 11,
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}
            >
              Showing {visibleHabits.length} of {snap.habits.length} habits
            </div>
          )}
        </main>

        {/* Desktop / tablet: persistent right panel. The dashboard sidebar
             shows when no habit is selected; the detail panel takes over
             when one is. Resizable via the left edge. */}
        {!isMobile && (
          <ResizablePanel
            defaultWidth={selectedHabit ? 520 : 320}
            minWidth={460}
            maxWidth={900}
            storageKey="habit-tracker.panelWidth"
          >
            {selectedHabit ? (
              <HabitDetailPanel
                habit={selectedHabit}
                controller={controller}
                onClose={() => controller.selectHabit(null)}
                onEdit={(h) => controller.openEditHabit(h.id)}
              />
            ) : (
              <DashboardSidebar summary={snap.dashboard} habits={snap.habits} />
            )}
          </ResizablePanel>
        )}
      </div>

      {/* Mobile: detail panel slides in over the entire viewport */}
      {isMobile && selectedHabit && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'var(--bg-primary)',
            display: 'flex',
          }}
        >
          <HabitDetailPanel
            habit={selectedHabit}
            controller={controller}
            onClose={() => controller.selectHabit(null)}
            onEdit={(h) => controller.openEditHabit(h.id)}
          />
        </div>
      )}

      <HabitFormModal
        open={snap.showHabitForm}
        habit={editingHabit}
        categories={snap.categories}
        controller={controller}
        onClose={() => controller.closeHabitForm()}
      />

      <CategoryManagerModal
        open={snap.showCategoryManager}
        onClose={() => controller.closeCategoryManager()}
        categories={snap.categories}
        controller={controller}
      />
    </div>
  )
}

// --------------------------------------------------------- mobile dashboard strip

interface MobileDashboardStripProps {
  summary: { todayCompleted: number; todayTotal: number; weeklyRate: number; activeStreaks: number }
}

function MobileDashboardStrip({ summary }: MobileDashboardStripProps) {
  const ratio = summary.todayTotal > 0 ? summary.todayCompleted / summary.todayTotal : 0
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--bg-secondary)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            fontWeight: 600,
          }}
        >
          Today
        </span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {summary.todayCompleted}
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
            {' '}/ {summary.todayTotal}
          </span>
        </span>
      </div>
      <Stat label="week" value={`${Math.round(summary.weeklyRate * 100)}%`} />
      <Stat label="streaks ≥7d" value={String(summary.activeStreaks)} />
      <ProgressBar ratio={ratio} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function ProgressBar({ ratio }: { ratio: number }) {
  return (
    <div
      style={{
        width: 48,
        height: 6,
        borderRadius: 4,
        background: 'var(--bg-tertiary)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`,
          height: '100%',
          background: 'var(--color-primary)',
          transition: 'width 200ms ease',
        }}
      />
    </div>
  )
}
