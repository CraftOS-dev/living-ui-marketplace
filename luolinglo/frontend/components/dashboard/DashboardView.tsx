import React, { useState, useEffect } from 'react'
import { Card } from '../ui'
import { ApiService } from '../../services/ApiService'
import type { ViewName, DashboardData } from '../../types'
import { DailyGoalRing } from './DailyGoalRing'
import { StreakCard } from './StreakCard'
import { XPCard } from './XPCard'
import { DueCardsCard } from './DueCardsCard'
import { DailyTipCard } from './DailyTipCard'

interface DashboardViewProps {
  onNavigate: (view: ViewName) => void
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [tips, setTips] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      try {
        setLoading(true)
        setError(null)

        const [dashboardData, tipsData] = await Promise.all([
          ApiService.getDashboard(),
          ApiService.getTips().catch(() => ({ tips: [] })),
        ])

        if (!cancelled) {
          setDashboard(dashboardData)
          setTips(tipsData.tips)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          Loading dashboard...
        </span>
      </div>
    )
  }

  if (error || !dashboard) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <span style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
          {error || 'Unable to load dashboard'}
        </span>
      </div>
    )
  }

  const { profile } = dashboard

  return (
    <div className="dashboard-view">
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--font-size-xl, 1.5rem)',
            fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
            color: 'var(--text-primary)',
          }}
        >
          Welcome back, {profile.displayName}!
        </h1>
        <p
          style={{
            margin: 0,
            marginTop: 'var(--space-1)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          Keep up the great work learning {profile.targetLanguage}.
        </p>
      </div>

      <div className="dashboard-grid">
        {/* Daily Goal Ring */}
        <Card style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <DailyGoalRing
            progress={dashboard.dailyGoalProgress}
            dailyXpEarned={profile.dailyXpEarned}
            dailyXpGoal={profile.dailyXpGoal}
          />
        </Card>

        {/* Streak */}
        <StreakCard
          currentStreak={profile.currentStreak}
          longestStreak={profile.longestStreak}
          streakFreezeCount={profile.streakFreezeInventory}
        />

        {/* XP & Level */}
        <XPCard
          totalXp={profile.totalXp}
          level={profile.level}
          levelTitle={dashboard.levelTitle}
          xpInCurrentLevel={dashboard.xpInCurrentLevel}
          xpForNextLevel={dashboard.xpForNextLevel}
        />

        {/* Due Cards */}
        <DueCardsCard
          dueCount={dashboard.dueCards}
          onStartReview={() => onNavigate('flashcards')}
        />

        {/* Daily Tip */}
        {tips.length > 0 && (
          <div className="dashboard-tip">
            <DailyTipCard tips={tips} />
          </div>
        )}
      </div>

      <style>{`
        .dashboard-view {
          padding: var(--space-4);
          max-width: 900px;
          margin: 0 auto;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: var(--space-3);
        }

        .dashboard-tip {
          grid-column: 1 / -1;
        }

        @media (min-width: 768px) {
          .dashboard-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 480px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }

          .dashboard-view {
            padding: var(--space-3);
          }
        }
      `}</style>
    </div>
  )
}
