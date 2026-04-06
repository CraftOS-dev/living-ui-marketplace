
import { List, ListItem, Badge } from '../ui'
import { ProgressBar } from '../shared/ProgressBar'
import type { ViewName, UserProfile, DashboardData } from '../../types'

interface SidebarProps {
  activeView: ViewName
  onNavigate: (view: ViewName) => void
  profile: UserProfile | null
  dashboard: DashboardData | null
}

interface NavItem {
  view: ViewName
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { view: 'dashboard', label: 'Dashboard', icon: '\u{1F3E0}' },
  { view: 'flashcards', label: 'Flashcards', icon: '\u{1F0CF}' },
  { view: 'vocabulary', label: 'Vocabulary', icon: '\u{1F4DA}' },
  { view: 'quizzes', label: 'Quizzes', icon: '\u{1F9E0}' },
  { view: 'ai-teacher', label: 'AI Teacher', icon: '\u{1F916}' },
  { view: 'progress', label: 'Progress', icon: '\u{1F4CA}' },
  { view: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
]

export function Sidebar({ activeView, onNavigate, profile, dashboard }: SidebarProps) {
  const levelProgress = dashboard
    ? dashboard.xpInCurrentLevel / dashboard.xpForNextLevel
    : 0

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-logo">Luolinglo</h1>
      </div>

      {profile && (
        <div className="sidebar-profile">
          <div className="sidebar-level">
            <span className="sidebar-level-text">
              Level {profile.level} - {dashboard?.levelTitle || 'Learner'}
            </span>
            <span className="sidebar-xp-text">{profile.totalXp} XP</span>
          </div>
          <ProgressBar value={levelProgress} height={6} />

          <div className="sidebar-streak">
            <span className="sidebar-streak-icon">{'\u{1F525}'}</span>
            <span className="sidebar-streak-count">{profile.currentStreak} day streak</span>
          </div>
        </div>
      )}

      <nav className="sidebar-nav">
        <List dividers={false}>
          {NAV_ITEMS.map((item) => (
            <ListItem
              key={item.view}
              active={activeView === item.view}
              onClick={() => onNavigate(item.view)}
            >
              <div className="sidebar-nav-item">
                <span className="sidebar-nav-icon">{item.icon}</span>
                <span className="sidebar-nav-label">{item.label}</span>
                {item.view === 'flashcards' && dashboard && dashboard.dueCards > 0 && (
                  <Badge variant="primary" size="sm">{dashboard.dueCards}</Badge>
                )}
              </div>
            </ListItem>
          ))}
        </List>
      </nav>

      <div className="sidebar-footer">
        {profile && (
          <div className="sidebar-daily-goal">
            <span className="sidebar-daily-label">Daily Goal</span>
            <ProgressBar
              value={profile.dailyXpGoal > 0 ? profile.dailyXpEarned / profile.dailyXpGoal : 0}
              height={4}
              color="var(--color-success)"
            />
            <span className="sidebar-daily-text">
              {profile.dailyXpEarned} / {profile.dailyXpGoal} XP
            </span>
          </div>
        )}
      </div>

      <style>{`
        .sidebar {
          width: 260px;
          min-width: 260px;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background-color: var(--bg-secondary);
          border-right: 1px solid var(--border-primary);
          overflow-y: auto;
          position: sticky;
          top: 0;
        }

        .sidebar-header {
          padding: var(--space-5) var(--space-4);
          border-bottom: 1px solid var(--border-primary);
        }

        .sidebar-logo {
          margin: 0;
          font-size: var(--font-size-xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-primary);
          letter-spacing: -0.5px;
        }

        .sidebar-profile {
          padding: var(--space-4);
          border-bottom: 1px solid var(--border-primary);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .sidebar-level {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .sidebar-level-text {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
        }

        .sidebar-xp-text {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }

        .sidebar-streak {
          display: flex;
          align-items: center;
          gap: var(--space-1);
        }

        .sidebar-streak-icon {
          font-size: var(--font-size-lg);
        }

        .sidebar-streak-count {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          font-weight: var(--font-weight-medium);
        }

        .sidebar-nav {
          flex: 1;
          padding: var(--space-3) var(--space-2);
        }

        .sidebar-nav-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .sidebar-nav-icon {
          font-size: var(--font-size-lg);
          width: 24px;
          text-align: center;
          flex-shrink: 0;
        }

        .sidebar-nav-label {
          flex: 1;
          font-size: var(--font-size-base);
          color: var(--text-primary);
        }

        .sidebar-footer {
          padding: var(--space-4);
          border-top: 1px solid var(--border-primary);
        }

        .sidebar-daily-goal {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .sidebar-daily-label {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          font-weight: var(--font-weight-medium);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .sidebar-daily-text {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }

        @media (max-width: 767px) {
          .sidebar {
            width: 60px;
            min-width: 60px;
          }

          .sidebar-logo {
            font-size: var(--font-size-base);
            text-align: center;
            overflow: hidden;
          }

          .sidebar-logo::after {
            content: 'L';
          }

          .sidebar-profile,
          .sidebar-footer,
          .sidebar-nav-label {
            display: none;
          }

          .sidebar-header {
            padding: var(--space-4) var(--space-2);
            text-align: center;
          }

          .sidebar-logo {
            font-size: 0;
          }

          .sidebar-logo::after {
            font-size: var(--font-size-xl);
            font-weight: var(--font-weight-bold);
            color: var(--color-primary);
          }

          .sidebar-nav {
            padding: var(--space-2);
          }

          .sidebar-nav-item {
            justify-content: center;
          }

          .sidebar-nav-icon {
            width: auto;
          }
        }
      `}</style>
    </aside>
  )
}
