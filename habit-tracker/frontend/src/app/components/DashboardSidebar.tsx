import { Flame, Trophy, CalendarDays, CheckCircle2 } from 'lucide-react'
import type { DashboardSummary, Habit } from '../types'

interface DashboardSidebarProps {
  summary: DashboardSummary
  habits: Habit[]
}

export function DashboardSidebar({ summary, habits }: DashboardSidebarProps) {
  const ratio = summary.todayTotal > 0 ? summary.todayCompleted / summary.todayTotal : 0
  const longest = habits.reduce((max, h) => Math.max(max, h.currentStreak ?? 0), 0)
  const longestHabit = habits.find((h) => (h.currentStreak ?? 0) === longest && longest > 0)

  return (
    <aside
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        padding: 16,
        borderLeft: '1px solid var(--border-primary)',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflowY: 'auto',
      }}
    >
      <Block title="Today">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ProgressRing ratio={ratio} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
              {summary.todayCompleted}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                {' '}/ {summary.todayTotal}
              </span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              done today
            </span>
          </div>
        </div>
      </Block>

      <Block title="This week">
        <Stat
          icon={<CalendarDays size={14} />}
          label="completion"
          value={`${Math.round(summary.weeklyRate * 100)}%`}
        />
        <Stat
          icon={<CheckCircle2 size={14} />}
          label="active streaks ≥ 7d"
          value={String(summary.activeStreaks)}
        />
      </Block>

      {longestHabit && (
        <Block title="Top streak">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: longestHabit.color,
                color: '#fff',
                flexShrink: 0,
              }}
            >
              <Flame size={15} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {longestHabit.name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {longest} day{longest === 1 ? '' : 's'} in a row
              </span>
            </div>
          </div>
        </Block>
      )}

      <Block title="Tips">
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          <li>Press <Kbd>1</Kbd>–<Kbd>9</Kbd> to focus the Nth habit.</li>
          <li>Press <Kbd>n</Kbd> for a new habit, <Kbd>/</Kbd> to search.</li>
        </ul>
      </Block>

      {habits.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 8,
            border: '1px dashed var(--border-primary)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          <Trophy size={12} /> Add your first habit to see stats.
        </div>
      )}
    </aside>
  )
}

interface BlockProps {
  title: string
  children: React.ReactNode
}

function Block({ title, children }: BlockProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          fontWeight: 600,
        }}
      >
        {title}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
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

function ProgressRing({ ratio }: { ratio: number }) {
  const size = 56
  const stroke = 5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.max(0, Math.min(1, ratio)))
  return (
    <svg width={size} height={size} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-tertiary)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 200ms ease' }}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        style={{ fill: 'var(--text-primary)', fontSize: 11, fontWeight: 600 }}
      >
        {Math.round(ratio * 100)}%
      </text>
    </svg>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        padding: '0 4px',
        height: 16,
        lineHeight: '16px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 3,
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </kbd>
  )
}
