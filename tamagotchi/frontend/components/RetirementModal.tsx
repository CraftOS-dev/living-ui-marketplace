import { useState } from 'react'
import { Modal, Button } from './ui'
import type { Pet } from '../types'
import type { AppController } from '../AppController'
import { toast } from 'react-toastify'

interface RetirementModalProps {
  pet: Pet
  controller: AppController
  onClose: () => void
  onRetired: () => void
}

export function RetirementModal({ pet, controller, onClose, onRetired }: RetirementModalProps) {
  const [retiring, setRetiring] = useState(false)
  const [retired, setRetired] = useState(false)

  const handleRetire = async () => {
    setRetiring(true)
    try {
      await controller.retirePet()
      setRetired(true)
      toast.success(`🌟 ${pet.name} has retired with honour!`)
    } catch (error: any) {
      toast.error(error.message || 'Failed to retire pet')
      setRetiring(false)
    }
  }

  if (retired) {
    return (
      <Modal open onClose={onRetired} title="Retirement Ceremony 🌟">
        <div style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🌟</div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
            {pet.name} has retired!
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
            After a wonderful life full of adventures, {pet.name} has earned their retirement.
            They will be remembered forever as a legendary CraftBot! ✨
          </p>
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #6366f122, #8b5cf622)',
            border: '1px solid #6366f144',
            marginBottom: '24px',
          }}>
            <p style={{ fontSize: '13px', color: '#6366f1', fontWeight: 600, margin: 0 }}>
              🥚 A new egg is waiting to be hatched...
            </p>
          </div>
          <Button variant="primary" onClick={onRetired} fullWidth>
            Hatch a New Egg
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title="Retirement Ceremony">
      <div style={{ textAlign: 'center', padding: '16px' }}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🌟</div>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
          {pet.name} is ready to retire!
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.6' }}>
          {pet.name} has lived a full and happy life as a CraftBot cat-bot.
          They've earned their retirement after reaching the pinnacle of their evolution!
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '12px',
          marginBottom: '24px',
        }}>
          <div style={{ textAlign: 'center', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)' }}>
            <div style={{ fontSize: '20px' }}>🍖</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Well Fed</div>
          </div>
          <div style={{ textAlign: 'center', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)' }}>
            <div style={{ fontSize: '20px' }}>😊</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Happy Life</div>
          </div>
          <div style={{ textAlign: 'center', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)' }}>
            <div style={{ fontSize: '20px' }}>✨</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Fully Evolved</div>
          </div>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
          After retirement, you can hatch a new egg and start fresh!
        </p>

        <div style={{ display: 'flex', gap: '12px' }}>
          <Button variant="secondary" onClick={onClose} fullWidth>
            Not Yet
          </Button>
          <Button
            variant="primary"
            onClick={handleRetire}
            loading={retiring}
            fullWidth
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            🌟 Retire {pet.name}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
