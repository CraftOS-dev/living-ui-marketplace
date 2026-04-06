

interface ProgressBarProps {
  value: number
  color?: string
  height?: number
  showLabel?: boolean
}

export function ProgressBar({
  value,
  color = 'var(--color-primary)',
  height = 8,
  showLabel = false,
}: ProgressBarProps) {
  const clampedValue = Math.min(1, Math.max(0, value))
  const percentage = Math.round(clampedValue * 100)

  return (
    <div className="progress-bar-wrapper">
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
            height,
          }}
        />
      </div>
      {showLabel && (
        <span className="progress-bar-label">{percentage}%</span>
      )}

      <style>{`
        .progress-bar-wrapper {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          width: 100%;
        }

        .progress-bar-track {
          flex: 1;
          height: ${height}px;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-full);
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          border-radius: var(--radius-full);
          transition: width 0.3s ease;
        }

        .progress-bar-label {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          min-width: 36px;
          text-align: right;
        }
      `}</style>
    </div>
  )
}
