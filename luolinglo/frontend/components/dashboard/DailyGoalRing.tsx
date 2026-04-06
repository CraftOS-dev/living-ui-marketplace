

interface DailyGoalRingProps {
  progress: number
  dailyXpEarned: number
  dailyXpGoal: number
}

export function DailyGoalRing({ progress, dailyXpEarned, dailyXpGoal }: DailyGoalRingProps) {
  const size = 120
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clampedProgress = Math.min(Math.max(progress, 0), 1)
  const strokeDashoffset = circumference - clampedProgress * circumference

  const getColor = (): string => {
    if (clampedProgress === 0) return 'var(--text-muted)'
    if (clampedProgress >= 1) return 'var(--color-success)'
    return 'var(--color-primary)'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--bg-tertiary)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={getColor()}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
              color: 'var(--text-primary)',
              lineHeight: 1.2,
            }}
          >
            {dailyXpEarned}
          </span>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-secondary)',
            }}
          >
            / {dailyXpGoal} XP
          </span>
        </div>
      </div>
      <span
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-secondary)',
          fontWeight: 'var(--font-weight-medium)' as React.CSSProperties['fontWeight'],
        }}
      >
        Daily Goal
      </span>
    </div>
  )
}
