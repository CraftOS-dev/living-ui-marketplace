import React, { useState, useEffect } from 'react'
import { Card } from '../ui'

interface DailyTipCardProps {
  tips: string[]
}

export function DailyTipCard({ tips }: DailyTipCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (tips.length <= 1) return
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % tips.length)
    }, 10000)
    return () => clearInterval(interval)
  }, [tips.length])

  if (tips.length === 0) {
    return null
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '24px', lineHeight: 1, flexShrink: 0 }} role="img" aria-label="tip">
          {'\uD83D\uDCA1'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-1)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Learning Tip
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}
          >
            {tips[currentIndex]}
          </div>
          {tips.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                marginTop: 'var(--space-2)',
                justifyContent: 'center',
              }}
            >
              {tips.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentIndex(index)}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    backgroundColor:
                      index === currentIndex ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                    transition: 'background-color 0.2s ease',
                  }}
                  aria-label={`Show tip ${index + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
