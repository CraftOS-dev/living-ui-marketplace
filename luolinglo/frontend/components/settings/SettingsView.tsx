import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Input, Select, Modal, Divider, Spinner } from '../ui'
import { ApiService } from '../../services/ApiService'
import { toast } from 'react-toastify'
import type { UserProfile } from '../../types'
import { CURATED_LANGUAGES, DAILY_GOAL_OPTIONS } from '../../types'
const PROFICIENCY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'elementary', label: 'Elementary' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'upper-intermediate', label: 'Upper Intermediate' },
  { value: 'advanced', label: 'Advanced' },
]

const LANGUAGE_OPTIONS = CURATED_LANGUAGES.map((lang) => ({ value: lang, label: lang }))

export function SettingsView() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [dailyGoal, setDailyGoal] = useState('50')
  const [nativeLanguage, setNativeLanguage] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('')
  const [proficiency, setProficiency] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [savingGoal, setSavingGoal] = useState(false)
  const [savingLanguages, setSavingLanguages] = useState(false)
  const [savingProficiency, setSavingProficiency] = useState(false)
  const [buyingFreeze, setBuyingFreeze] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetting, setResetting] = useState(false)

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true)
      const p = await ApiService.getProfile()
      if (p) {
        setProfile(p)
        setDisplayName(p.displayName)
        setDailyGoal(String(p.dailyXpGoal))
        setNativeLanguage(p.nativeLanguage)
        setTargetLanguage(p.targetLanguage)
        setProficiency(p.proficiencyLevel)
      }
    } catch {
      toast.error('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const handleSaveName = async () => {
    if (!displayName.trim()) return
    try {
      setSavingName(true)
      const updated = await ApiService.updateProfile({ displayName: displayName.trim() })
      setProfile(updated)
      toast.success('Display name updated')
    } catch {
      toast.error('Failed to update display name')
    } finally {
      setSavingName(false)
    }
  }

  const handleSaveGoal = async () => {
    try {
      setSavingGoal(true)
      const updated = await ApiService.updateDailyGoal(Number(dailyGoal))
      setProfile(updated)
      toast.success('Daily goal updated')
    } catch {
      toast.error('Failed to update daily goal')
    } finally {
      setSavingGoal(false)
    }
  }

  const handleBuyFreeze = async () => {
    try {
      setBuyingFreeze(true)
      const updated = await ApiService.buyStreakFreeze()
      setProfile(updated)
      toast.success('Streak freeze purchased!')
    } catch {
      toast.error('Not enough XP or failed to purchase')
    } finally {
      setBuyingFreeze(false)
    }
  }

  const handleSaveLanguages = async () => {
    try {
      setSavingLanguages(true)
      const updated = await ApiService.updateProfile({
        nativeLanguage,
        targetLanguage,
      })
      setProfile(updated)
      toast.success('Languages updated')
    } catch {
      toast.error('Failed to update languages')
    } finally {
      setSavingLanguages(false)
    }
  }

  const handleSaveProficiency = async () => {
    try {
      setSavingProficiency(true)
      const updated = await ApiService.updateProfile({ proficiencyLevel: proficiency })
      setProfile(updated)
      toast.success('Proficiency level updated')
    } catch {
      toast.error('Failed to update proficiency')
    } finally {
      setSavingProficiency(false)
    }
  }

  const handleResetProgress = async () => {
    try {
      setResetting(true)
      await ApiService.executeAction('reset_progress')
      setShowResetModal(false)
      toast.success('Progress has been reset')
      await loadProfile()
    } catch {
      toast.error('Failed to reset progress')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <>
      <style>{`
        .settings-view {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          max-width: 600px;
        }
        .settings-view-title {
          margin: 0;
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }
        .settings-section-title {
          margin: 0 0 var(--space-3) 0;
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }
        .settings-row {
          display: flex;
          gap: var(--space-3);
          align-items: flex-end;
        }
        .settings-row > *:first-child {
          flex: 1;
        }
        .settings-danger-zone {
          border: 1px solid var(--color-error);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
        }
        .settings-danger-title {
          margin: 0 0 var(--space-2) 0;
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-semibold);
          color: var(--color-error);
        }
        .settings-danger-desc {
          margin: 0 0 var(--space-3) 0;
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }
        .settings-info {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          margin-top: var(--space-1);
        }
        @media (max-width: 480px) {
          .settings-row {
            flex-direction: column;
            align-items: stretch;
          }
        }
      `}</style>
      <div className="settings-view">
        <h2 className="settings-view-title">Settings</h2>

        {/* Display Name */}
        <Card padding="md">
          <h3 className="settings-section-title">Display Name</h3>
          <div className="settings-row">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
            />
            <Button onClick={handleSaveName} loading={savingName} disabled={!displayName.trim()}>
              Save
            </Button>
          </div>
        </Card>

        {/* Daily XP Goal */}
        <Card padding="md">
          <h3 className="settings-section-title">Daily XP Goal</h3>
          <div className="settings-row">
            <Select
              value={dailyGoal}
              onChange={(e) => setDailyGoal(e.target.value)}
              options={DAILY_GOAL_OPTIONS.map((opt) => ({
                value: String(opt.value),
                label: `${opt.label} - ${opt.description}`,
              }))}
            />
            <Button onClick={handleSaveGoal} loading={savingGoal}>
              Save
            </Button>
          </div>
        </Card>

        {/* Streak Freeze */}
        <Card padding="md">
          <h3 className="settings-section-title">Streak Freeze</h3>
          <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Protect your streak when you miss a day. Costs 100 XP.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
              Current inventory: <strong>{profile?.streakFreezeInventory ?? 0}</strong>
            </span>
            <Button onClick={handleBuyFreeze} loading={buyingFreeze} variant="secondary">
              Buy Streak Freeze (100 XP)
            </Button>
          </div>
        </Card>

        {/* Language Pair */}
        <Card padding="md">
          <h3 className="settings-section-title">Language Pair</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Select
              label="Native Language"
              value={nativeLanguage}
              onChange={(e) => setNativeLanguage(e.target.value)}
              options={LANGUAGE_OPTIONS}
            />
            <Select
              label="Target Language"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              options={LANGUAGE_OPTIONS}
            />
            <Button onClick={handleSaveLanguages} loading={savingLanguages}>
              Save Languages
            </Button>
          </div>
        </Card>

        {/* Proficiency Level */}
        <Card padding="md">
          <h3 className="settings-section-title">Proficiency Level</h3>
          <div className="settings-row">
            <Select
              value={proficiency}
              onChange={(e) => setProficiency(e.target.value)}
              options={PROFICIENCY_OPTIONS}
            />
            <Button onClick={handleSaveProficiency} loading={savingProficiency}>
              Save
            </Button>
          </div>
        </Card>

        <Divider spacing="md" />

        {/* Danger Zone */}
        <div className="settings-danger-zone">
          <h3 className="settings-danger-title">Danger Zone</h3>
          <p className="settings-danger-desc">
            Reset all your progress including vocabulary, flashcards, quiz history, and XP. This action cannot be undone.
          </p>
          <Button variant="danger" onClick={() => setShowResetModal(true)}>
            Reset All Progress
          </Button>
        </div>

        <Modal
          open={showResetModal}
          onClose={() => setShowResetModal(false)}
          title="Reset Progress"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowResetModal(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleResetProgress} loading={resetting}>
                Yes, Reset Everything
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>
            Are you sure you want to reset all your progress? This will permanently delete all your vocabulary, flashcard progress, quiz history, achievements, and XP. This action cannot be undone.
          </p>
        </Modal>
      </div>
    </>
  )
}
