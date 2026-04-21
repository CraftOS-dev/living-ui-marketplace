import { useState } from 'react'
import { Button, Input, Card } from './ui'
import type { AppController } from '../AppController'
import type { Pet } from '../types'
import { toast } from 'react-toastify'

interface HatchEggViewProps {
  controller: AppController
  retiredPet?: Pet | null
  onHatched: () => void
}

export function HatchEggView({ controller, retiredPet, onHatched }: HatchEggViewProps) {
  const [name, setName] = useState('{{PET_DEFAULT_NAME}}')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleHatch = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Please give your pet a name!')
      return
    }
    if (trimmedName.length > 20) {
      setError('Name must be 20 characters or less.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await controller.createPet(trimmedName)
      toast.success(`🥚 ${trimmedName} has hatched! Welcome to the world!`)
      onHatched()
    } catch (err: any) {
      toast.error(err.message || 'Failed to hatch egg')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleHatch()
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '24px',
      background: 'var(--bg-primary)',
    }}>
      {/* Memorial for retired pet */}
      {retiredPet && (
        <Card style={{
          padding: '16px',
          marginBottom: '32px',
          maxWidth: '400px',
          width: '100%',
          textAlign: 'center',
          background: 'linear-gradient(135deg, #6366f108, #8b5cf608)',
          border: '1px solid #6366f130',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🌟</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            In memory of <strong style={{ color: 'var(--text-primary)' }}>{retiredPet.name}</strong> — a legendary CraftBot who lived a full life.
          </p>
        </Card>
      )}

      {/* Egg animation */}
      <div style={{
        width: '180px',
        height: '180px',
        marginBottom: '32px',
        animation: 'eggWobble 2s ease-in-out infinite',
      }}>
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <defs>
            <radialGradient id="hatchEggGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="hatchEggBody" cx="40%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#6d28d9" />
            </radialGradient>
          </defs>
          <ellipse cx="50" cy="55" rx="40" ry="45" fill="url(#hatchEggGlow)" />
          <ellipse cx="50" cy="55" rx="26" ry="32" fill="url(#hatchEggBody)" />
          <ellipse cx="42" cy="40" rx="7" ry="9" fill="white" opacity="0.25" />
          <text x="50" y="58" textAnchor="middle" fontSize="18" fill="white" opacity="0.9">⚡</text>
          <path d="M50,28 L52,36 L48,42 L51,50" stroke="white" strokeWidth="2" fill="none" opacity="0.6" strokeLinecap="round" />
          <text x="22" y="28" fontSize="10" fill="#c4b5fd">✦</text>
          <text x="70" y="32" fontSize="8" fill="#a5b4fc">✦</text>
          <text x="18" y="68" fontSize="6" fill="#c4b5fd">✦</text>
          <text x="74" y="72" fontSize="7" fill="#a5b4fc">✦</text>
        </svg>
      </div>

      {/* Title */}
      <h1 style={{
        fontSize: '28px',
        fontWeight: 800,
        color: 'var(--text-primary)',
        marginBottom: '8px',
        textAlign: 'center',
      }}>
        {retiredPet ? 'Hatch a New Egg!' : 'Welcome to CraftBot Pet!'}
      </h1>
      <p style={{
        fontSize: '15px',
        color: 'var(--text-secondary)',
        marginBottom: '32px',
        textAlign: 'center',
        maxWidth: '360px',
        lineHeight: '1.6',
      }}>
        {retiredPet
          ? 'A new adventure awaits! Give your new CraftBot cat-bot a name to begin.'
          : 'A mysterious egg is waiting for you. Give your CraftBot cat-bot a name and hatch it!'}
      </p>

      {/* Name input */}
      <div style={{ width: '100%', maxWidth: '360px' }}>
        <Input
          placeholder="Name your pet (e.g. Bitsy, Sparky, Zap...)"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError('')
          }}
          onKeyDown={handleKeyDown}
          maxLength={20}
          style={{ marginBottom: error ? '4px' : '16px', fontSize: '15px' }}
        />
        {error && (
          <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px', marginTop: '4px' }}>
            {error}
          </p>
        )}
        <Button
          variant="primary"
          onClick={handleHatch}
          loading={loading}
          disabled={!name.trim()}
          fullWidth
          size="lg"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            fontSize: '16px',
            fontWeight: 700,
          }}
        >
          🥚 Hatch Your Pet!
        </Button>
      </div>

      <style>{`
        @keyframes eggWobble {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
      `}</style>
    </div>
  )
}
