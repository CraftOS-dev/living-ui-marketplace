
import { Card, Badge } from '../ui'
import { ProgressBar } from '../shared/ProgressBar'

interface XPCardProps {
  totalXp: number
  level: number
  levelTitle: string
  xpInCurrentLevel: number
  xpForNextLevel: number
}

export function XPCard({ totalXp, level, levelTitle, xpInCurrentLevel, xpForNextLevel }: XPCardProps) {
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-white)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
              }}
            >
              {level}
            </div>
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
                  color: 'var(--text-primary)',
                  lineHeight: 1.2,
                }}
              >
                {levelTitle}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                Level {level}
              </div>
            </div>
          </div>
          <Badge variant="primary">{totalXp} XP</Badge>
        </div>

        <div>
          <ProgressBar
            value={xpForNextLevel > 0 ? xpInCurrentLevel / xpForNextLevel : 0}
            showLabel
          />
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-1)',
              textAlign: 'right',
            }}
          >
            {xpInCurrentLevel} / {xpForNextLevel} XP
          </div>
        </div>
      </div>
    </Card>
  )
}
