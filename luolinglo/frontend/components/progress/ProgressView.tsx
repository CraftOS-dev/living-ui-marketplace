import { useState, useEffect } from 'react'
import { Tabs, Tab, TabList, TabPanel, Spinner } from '../ui'
import { ApiService } from '../../services/ApiService'
import { StatsCards } from './StatsCards'
import { AchievementGrid } from './AchievementGrid'
import { WeeklyXPChart } from './WeeklyXPChart'
import { StreakCalendar } from './StreakCalendar'
import { PersonalBests } from './PersonalBests'
import { ActivitySummary } from './ActivitySummary'
import { RecentDays } from './RecentDays'
import { toast } from 'react-toastify'
import type { ProgressStats, AchievementBadge, WeeklyXp, DailyActivityData } from '../../types'

export function ProgressView() {
  const [stats, setStats] = useState<ProgressStats | null>(null)
  const [badges, setBadges] = useState<AchievementBadge[]>([])
  const [earnedCount, setEarnedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [weeklyXp, setWeeklyXp] = useState<WeeklyXp[]>([])
  const [activities, setActivities] = useState<DailyActivityData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const loadData = async () => {
      try {
        setLoading(true)
        const [statsData, achievementsData, weeklyData, activityData] = await Promise.all([
          ApiService.getStats(),
          ApiService.getAchievements(),
          ApiService.getWeeklyXp(),
          ApiService.getActivity(30),
        ])
        if (cancelled) return
        setStats(statsData)
        setBadges(achievementsData.badges)
        setEarnedCount(achievementsData.earnedCount)
        setTotalCount(achievementsData.totalCount)
        setWeeklyXp(weeklyData)
        setActivities(activityData)
      } catch {
        if (!cancelled) toast.error('Failed to load progress data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <>
      <style>{`
        .progress-view {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
        .progress-view-title {
          margin: 0;
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }
        .progress-tab-content {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }
        .activity-tab-row {
          display: flex;
          gap: var(--space-4);
          align-items: flex-start;
          flex-wrap: wrap;
        }
        @media (max-width: 720px) {
          .activity-tab-row { flex-direction: column; }
          .activity-tab-row > * { width: 100%; }
        }
      `}</style>
      <div className="progress-view">
        <h2 className="progress-view-title">Progress</h2>
        <Tabs defaultTab="overview">
          <TabList>
            <Tab id="overview">Overview</Tab>
            <Tab id="achievements">Achievements</Tab>
            <Tab id="activity">Activity</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="progress-tab-content">
              {stats && <StatsCards stats={stats} />}
              {weeklyXp.length > 0 && <WeeklyXPChart data={weeklyXp} />}
              {stats && <PersonalBests stats={stats} />}
            </div>
          </TabPanel>

          <TabPanel id="achievements">
            <div className="progress-tab-content">
              <AchievementGrid badges={badges} earnedCount={earnedCount} totalCount={totalCount} />
            </div>
          </TabPanel>

          <TabPanel id="activity">
            <div className="progress-tab-content">
              <ActivitySummary activities={activities} windowDays={30} />
              <div className="activity-tab-row">
                <StreakCalendar activities={activities} />
                <RecentDays activities={activities} count={10} />
              </div>
              {weeklyXp.length > 0 && <WeeklyXPChart data={weeklyXp} />}
            </div>
          </TabPanel>
        </Tabs>
      </div>
    </>
  )
}
