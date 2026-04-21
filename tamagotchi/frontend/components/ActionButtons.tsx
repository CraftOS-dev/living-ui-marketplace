import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { Pet, CareAction } from '../types'
import { ACTION_INFO } from '../types'
import { toast } from 'react-toastify'

interface ActionButtonsProps {
  pet: Pet
  controller: AppController
  onAction: () => void
}

const COOLDOWN_MAP: Record<CareAction, number> = {
  feed: 30,
  play: 60,
  sleep: 0,
  wake: 0,
  clean: 120,
  medicine: 60,
}

const ERROR_MESSAGES: Record<string, string> = {
  feed_cooldown: 'Still digesting! Wait a moment before feeding again.',
  play_cooldown: 'Needs a rest! Wait before playing again.',
  clean_cooldown: 'Already clean! Come back later.',
  medicine_cooldown: 'Already gave medicine recently.',
  pet_sleeping: 'Your pet is sleeping! Wake them up first.',
  already_sleeping: 'Already sleeping!',
  not_sleeping: 'Not sleeping right now.',
  pet_retired: 'Your pet has retired.',
}

function CooldownTimer({ action, pet }: { action: CareAction; pet: Pet }) {
  const [remaining, setRemaining] = useState(0)
  const cooldownSeconds = COOLDOWN_MAP[action]

  useEffect(() => {
    if (cooldownSeconds === 0) return
    const lastUsedStr = pet.cooldowns[action]
    if (!lastUsedStr) return

    const update = () => {
      const lastUsed = new Date(lastUsedStr).getTime()
      const elapsed = (Date.now() - lastUsed) / 1000
      const rem = Math.max(0, Math.ceil(cooldownSeconds - elapsed))
      setRemaining(rem)
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [action, pet.cooldowns, cooldownSeconds])

  if (remaining <= 0) return null
  return (
    <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'block', textAlign: 'center', marginTop: '2px' }}>
      {remaining}s
    </span>
  )
}

export function ActionButtons({ pet, controller, onAction }: ActionButtonsProps) {
  const [loading, setLoading] = useState<CareAction | null>(null)

  const handleAction = async (action: CareAction) => {
    setLoading(action)
    try {
      await controller.performAction(action)
      const info = ACTION_INFO[action]
      toast.success(`${info.emoji} ${info.label}! ${pet.name} is happy!`)
      onAction()
    } catch (error: any) {
      const detail = error.message || 'Something went wrong'
      const friendlyMsg = ERROR_MESSAGES[detail] || detail
      toast.error(friendlyMsg)
    } finally {
      setLoading(null)
    }
  }

  const isOnCooldown = (action: CareAction): boolean => {
    const cooldownSeconds = COOLDOWN_MAP[action]
    if (cooldownSeconds === 0) return false
    const lastUsedStr = pet.cooldowns[action]
    if (!lastUsedStr) return false
    const lastUsed = new Date(lastUsedStr).getTime()
    const elapsed = (Date.now() - lastUsed) / 1000
    return elapsed < cooldownSeconds
  }

  const isDisabled = (action: CareAction): boolean => {
    if (loading !== null) return true
    if (isOnCooldown(action)) return true
    if (action === 'play' && pet.is_sleeping) return true
    if (action === 'sleep' && pet.is_sleeping) return true
    if (action === 'wake' && !pet.is_sleeping) return true
    if (action === 'medicine' && !pet.is_sick) return false // always allow medicine
    return false
  }

  // Determine which sleep/wake button to show
  const sleepWakeAction: CareAction = pet.is_sleeping ? 'wake' : 'sleep'

  const actions: CareAction[] = ['feed', 'play', sleepWakeAction, 'clean', 'medicine']

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: '8px',
      padding: '16px',
    }}>
      {actions.map((action) => {
        const info = ACTION_INFO[action]
        const disabled = isDisabled(action)
        const onCooldown = isOnCooldown(action)
        const isLoading = loading === action

        return (
          <div key={action} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              onClick={() => handleAction(action)}
              disabled={disabled}
              title={info.description}
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                border: `2px solid ${disabled ? 'var(--border-primary)' : '#6366f1'}`,
                backgroundColor: disabled ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                opacity: disabled ? 0.5 : 1,
                boxShadow: disabled ? 'none' : '0 2px 8px rgba(99, 102, 241, 0.2)',
                position: 'relative',
              }}
            >
              {isLoading ? '⏳' : info.emoji}
            </button>
            <span style={{
              fontSize: '11px',
              fontWeight: 500,
              color: disabled ? 'var(--text-secondary)' : 'var(--text-primary)',
              marginTop: '4px',
              textAlign: 'center',
            }}>
              {info.label}
            </span>
            {onCooldown && <CooldownTimer action={action} pet={pet} />}
          </div>
        )
      })}
    </div>
  )
}
