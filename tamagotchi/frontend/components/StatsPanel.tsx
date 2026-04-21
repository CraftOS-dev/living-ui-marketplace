import { Card } from './ui'
import type { Pet, EvolutionStatus } from '../types'
import { STAGE_INFO, MOOD_INFO } from '../types'

interface StatsPanelProps {
  pet: Pet
  evolutionStatus: EvolutionStatus | null
}

interface StatBarProps {
  label: string
  value: number
  emoji: string
  color: string
  warningThreshold?: number
  criticalThreshold?: number
}

function StatBar({ label, value, emoji, color, warningThreshold = 30, criticalThreshold = 10 }: StatBarProps) {
  const isCritical = value <= criticalThreshold
  const isWarning = value <= warningThreshold && !isCritical
  const barColor = isCritical ? '#ef4444' : isWarning ? '#f97316' : color

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          {emoji} {label}
        </span>
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          color: isCritical ? '#ef4444' : isWarning ? '#f97316' : 'var(--text-secondary)'
        }}>
          {Math.round(value)}/100
          {isCritical && ' ⚠️'}
        </span>
      </div>
      <div style={{
        height: '8px',
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.max(0, Math.min(100, value))}%`,
          backgroundColor: barColor,
          borderRadius: '4px',
          transition: 'width 0.5s ease, background-color 0.3s ease',
        }} />
      </div>
    </div>
  )
}

export function StatsPanel({ pet, evolutionStatus }: StatsPanelProps) {
  const stageInfo = STAGE_INFO[pet.stage]
  const moodInfo = MOOD_INFO[pet.mood]
  const ageHours = Math.floor(pet.age_minutes / 60)
  const ageMinutes = Math.floor(pet.age_minutes % 60)

  const evoProgress = evolutionStatus
    ? Math.min(100, (evolutionStatus.evolution_points / evolutionStatus.current_threshold) * 100)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Pet Identity Card */}
      <Card style={{ padding: '16px' }}>
        <div style={{ textAlign: 'center', marginBottom: '12px' }}>
          <div style={{ fontSize: '32px', marginBottom: '4px' }}>{stageInfo.emoji}</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {pet.name}
          </h2>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            marginTop: '4px',
            padding: '2px 10px',
            borderRadius: '12px',
            backgroundColor: stageInfo.color + '22',
            border: `1px solid ${stageInfo.color}44`,
          }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: stageInfo.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {stageInfo.label}
            </span>
          </div>
        </div>

        {/* Mood */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '8px',
          borderRadius: '8px',
          backgroundColor: moodInfo.color + '15',
          border: `1px solid ${moodInfo.color}30`,
          marginBottom: '12px',
        }}>
          <span style={{ fontSize: '18px' }}>{moodInfo.emoji}</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: moodInfo.color }}>
            {moodInfo.label}
          </span>
          {pet.is_sick && (
            <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>• SICK</span>
          )}
        </div>

        {/* Age */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <span>Age</span>
          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
            {ageHours > 0 ? `${ageHours}h ${ageMinutes}m` : `${ageMinutes}m`}
          </span>
        </div>
      </Card>

      {/* Stats Card */}
      <Card style={{ padding: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', margin: '0 0 12px 0' }}>
          Stats
        </h3>
        <StatBar
          label="Hunger"
          value={pet.hunger}
          emoji="🍖"
          color="#f97316"
          warningThreshold={30}
          criticalThreshold={10}
        />
        <StatBar
          label="Happiness"
          value={pet.happiness}
          emoji="😊"
          color="#22c55e"
          warningThreshold={30}
          criticalThreshold={10}
        />
        <StatBar
          label="Health"
          value={pet.health}
          emoji="❤️"
          color="#ef4444"
          warningThreshold={30}
          criticalThreshold={10}
        />
      </Card>

      {/* Evolution Card */}
      {evolutionStatus && (
        <Card style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px 0' }}>
            Evolution
          </h3>
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {evolutionStatus.is_max_stage ? 'Retirement' : `→ ${evolutionStatus.next_stage ? STAGE_INFO[evolutionStatus.next_stage].label : ''}`}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {evolutionStatus.evolution_points} / {evolutionStatus.current_threshold}
              </span>
            </div>
            <div style={{
              height: '6px',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${evoProgress}%`,
                background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                borderRadius: '3px',
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
            {evolutionStatus.can_retire
              ? '🌟 Ready to retire!'
              : evolutionStatus.is_max_stage
              ? 'Keep stats above 70 to earn retirement points'
              : 'Keep stats above 70 to earn evolution points'}
          </p>
        </Card>
      )}
    </div>
  )
}
