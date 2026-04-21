import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { AppState } from '../types'
import { PetDisplay } from './PetDisplay'
import { StatsPanel } from './StatsPanel'
import { ActionButtons } from './ActionButtons'
import { ActivityLog } from './ActivityLog'
import { RetirementModal } from './RetirementModal'
import { HatchEggView } from './HatchEggView'
import { Button } from './ui'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [appState, setAppState] = useState<AppState>(controller.getState())
  const [showRetirementModal, setShowRetirementModal] = useState(false)

  // Make this component agent-aware
  // Subscribe to controller state changes
  useEffect(() => {
    const unsubscribe = controller.subscribe((state) => {
      setAppState(state)
    })
    return unsubscribe
  }, [controller])

  const handleAction = () => {
    // State is refreshed by the controller after each action
  }

  const handleRetired = () => {
    setShowRetirementModal(false)
    controller.refresh()
  }

  // Loading state
  if (!appState.initialized || appState.loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        flexDirection: 'column',
        gap: '16px',
      }}>
        <div style={{ fontSize: '48px', animation: 'spin 2s linear infinite' }}>⚡</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading CraftBot Pet...</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // Error state
  if (appState.error && !appState.pet) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        flexDirection: 'column',
        gap: '16px',
        padding: '24px',
      }}>
        <div style={{ fontSize: '48px' }}>⚠️</div>
        <p style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 600 }}>Connection Error</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center' }}>{appState.error}</p>
        <Button variant="primary" onClick={() => controller.refresh()}>Try Again</Button>
      </div>
    )
  }

  // No pet — show hatch egg view
  if (!appState.pet) {
    return (
      <HatchEggView
        controller={controller}
        retiredPet={appState.retiredPet}
        onHatched={() => controller.refresh()}
      />
    )
  }

  const { pet, activityLog, evolutionStatus } = appState
  const canRetire = evolutionStatus?.can_retire ?? false

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      backgroundColor: 'var(--bg-primary)',
    }}>
      {/* Top Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid var(--border-primary)',
        backgroundColor: 'var(--bg-secondary)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>⚡</span>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              CraftBot Pet
            </h1>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
              Your virtual companion
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {canRetire && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowRetirementModal(true)}
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              🌟 Retire
            </Button>
          )}
          {pet.is_sick && (
            <div style={{
              padding: '4px 10px',
              borderRadius: '12px',
              backgroundColor: '#ef444420',
              border: '1px solid #ef444440',
              fontSize: '12px',
              color: '#ef4444',
              fontWeight: 600,
            }}>
              🤒 Sick!
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 280px',
        gap: '0',
        flex: 1,
        minHeight: 0,
      }}>
        {/* Left: Pet Display + Actions */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-primary)',
        }}>
          {/* Pet Display Area */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            minHeight: '300px',
            background: 'radial-gradient(ellipse at center, var(--bg-secondary) 0%, var(--bg-primary) 70%)',
          }}>
            <PetDisplay pet={pet} />
          </div>

          {/* Action Buttons */}
          <div style={{
            borderTop: '1px solid var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)',
          }}>
            <ActionButtons
              pet={pet}
              controller={controller}
              onAction={handleAction}
            />
          </div>

          {/* Activity Log */}
          <div style={{ padding: '16px', borderTop: '1px solid var(--border-primary)' }}>
            <ActivityLog entries={activityLog} />
          </div>
        </div>

        {/* Right: Stats Panel */}
        <div style={{
          padding: '16px',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-primary)',
        }}>
          <StatsPanel pet={pet} evolutionStatus={evolutionStatus} />
        </div>
      </div>

      {/* Retirement Modal */}
      {showRetirementModal && (
        <RetirementModal
          pet={pet}
          controller={controller}
          onClose={() => setShowRetirementModal(false)}
          onRetired={handleRetired}
        />
      )}

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 640px) {
          .pet-dashboard-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}
