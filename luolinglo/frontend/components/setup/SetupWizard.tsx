import { useState } from 'react'
import { Card, Select, Input, Button } from '../ui'
import { CURATED_LANGUAGES } from '../../types'

interface SetupWizardProps {
  onSubmit: (data: {
    nativeLanguage: string
    targetLanguage: string
    proficiencyLevel: string
    displayName?: string
  }) => void
}

const LANGUAGE_OPTIONS = [
  ...CURATED_LANGUAGES.map((lang) => ({ value: lang, label: lang })),
  { value: '__other__', label: 'Other...' },
]

const PROFICIENCY_OPTIONS = [
  { value: 'beginner', label: 'Beginner - Just starting out' },
  { value: 'intermediate', label: 'Intermediate - Can hold basic conversations' },
  { value: 'advanced', label: 'Advanced - Comfortable with complex topics' },
]

export function SetupWizard({ onSubmit }: SetupWizardProps) {
  const [step, setStep] = useState(1)
  const [nativeLanguage, setNativeLanguage] = useState('')
  const [customNative, setCustomNative] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('')
  const [customTarget, setCustomTarget] = useState('')
  const [proficiencyLevel, setProficiencyLevel] = useState('')
  const [displayName, setDisplayName] = useState('')

  const resolvedNative = nativeLanguage === '__other__' ? customNative : nativeLanguage
  const resolvedTarget = targetLanguage === '__other__' ? customTarget : targetLanguage

  const targetOptions = LANGUAGE_OPTIONS.filter(
    (opt) => opt.value !== nativeLanguage || opt.value === '__other__'
  )

  const canAdvance = (): boolean => {
    switch (step) {
      case 1:
        return nativeLanguage !== '' && (nativeLanguage !== '__other__' || customNative.trim() !== '')
      case 2:
        return targetLanguage !== '' && (targetLanguage !== '__other__' || customTarget.trim() !== '')
      case 3:
        return proficiencyLevel !== ''
      case 4:
        return true
      default:
        return false
    }
  }

  const handleNext = () => {
    if (step < 4) {
      setStep(step + 1)
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
    }
  }

  const handleSubmit = () => {
    onSubmit({
      nativeLanguage: resolvedNative,
      targetLanguage: resolvedTarget,
      proficiencyLevel,
      displayName: displayName.trim() || undefined,
    })
  }

  return (
    <div className="setup-wizard">
      <div className="setup-wizard-container">
        <Card padding="lg">
          <div className="setup-wizard-content">
            <div className="setup-wizard-header">
              <h1 className="setup-wizard-title">Welcome to Luolinglo</h1>
              <p className="setup-wizard-subtitle">
                Let's get you set up in just a few steps
              </p>
              <div className="setup-wizard-steps">
                {[1, 2, 3, 4].map((s) => (
                  <div
                    key={s}
                    className={`setup-wizard-step-dot ${s === step ? 'active' : ''} ${s < step ? 'completed' : ''}`}
                  />
                ))}
              </div>
            </div>

            {step === 1 && (
              <div className="setup-wizard-step">
                <h2 className="setup-step-title">What is your native language?</h2>
                <p className="setup-step-desc">This helps us provide translations you can understand.</p>
                <Select
                  label="Native Language"
                  placeholder="Select your language"
                  options={LANGUAGE_OPTIONS}
                  value={nativeLanguage}
                  onChange={(e) => setNativeLanguage(e.target.value)}
                />
                {nativeLanguage === '__other__' && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <Input
                      label="Enter your language"
                      placeholder="e.g. Vietnamese"
                      value={customNative}
                      onChange={(e) => setCustomNative(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="setup-wizard-step">
                <h2 className="setup-step-title">What language do you want to learn?</h2>
                <p className="setup-step-desc">Choose the language you'd like to practice.</p>
                <Select
                  label="Target Language"
                  placeholder="Select a language"
                  options={targetOptions}
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                />
                {targetLanguage === '__other__' && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <Input
                      label="Enter the language"
                      placeholder="e.g. Thai"
                      value={customTarget}
                      onChange={(e) => setCustomTarget(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="setup-wizard-step">
                <h2 className="setup-step-title">What's your level in {resolvedTarget}?</h2>
                <p className="setup-step-desc">We'll adjust content to match your skill.</p>
                <Select
                  label="Proficiency Level"
                  placeholder="Select your level"
                  options={PROFICIENCY_OPTIONS}
                  value={proficiencyLevel}
                  onChange={(e) => setProficiencyLevel(e.target.value)}
                />
              </div>
            )}

            {step === 4 && (
              <div className="setup-wizard-step">
                <h2 className="setup-step-title">Almost done!</h2>
                <p className="setup-step-desc">Choose a display name (optional).</p>
                <Input
                  label="Display Name"
                  placeholder="Enter your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  hint="You can always change this later in settings."
                />
                <div className="setup-summary">
                  <p><strong>Native:</strong> {resolvedNative}</p>
                  <p><strong>Learning:</strong> {resolvedTarget}</p>
                  <p><strong>Level:</strong> {proficiencyLevel}</p>
                </div>
              </div>
            )}

            <div className="setup-wizard-actions">
              {step > 1 && (
                <Button variant="ghost" onClick={handleBack}>
                  Back
                </Button>
              )}
              <div style={{ flex: 1 }} />
              {step < 4 ? (
                <Button onClick={handleNext} disabled={!canAdvance()}>
                  Next
                </Button>
              ) : (
                <Button onClick={handleSubmit}>
                  Get Started
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <style>{`
        .setup-wizard {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: var(--space-4);
          background-color: var(--bg-primary);
        }

        .setup-wizard-container {
          width: 100%;
          max-width: 480px;
        }

        .setup-wizard-content {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .setup-wizard-header {
          text-align: center;
        }

        .setup-wizard-title {
          margin: 0 0 var(--space-2) 0;
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-primary);
        }

        .setup-wizard-subtitle {
          margin: 0 0 var(--space-4) 0;
          font-size: var(--font-size-base);
          color: var(--text-secondary);
        }

        .setup-wizard-steps {
          display: flex;
          justify-content: center;
          gap: var(--space-2);
        }

        .setup-wizard-step-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: var(--bg-tertiary);
          transition: var(--transition-base);
        }

        .setup-wizard-step-dot.active {
          background-color: var(--color-primary);
          transform: scale(1.2);
        }

        .setup-wizard-step-dot.completed {
          background-color: var(--color-success);
        }

        .setup-wizard-step {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .setup-step-title {
          margin: 0;
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .setup-step-desc {
          margin: 0;
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }

        .setup-summary {
          margin-top: var(--space-4);
          padding: var(--space-3);
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-md);
        }

        .setup-summary p {
          margin: 0 0 var(--space-1) 0;
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }

        .setup-summary p:last-child {
          margin-bottom: 0;
        }

        .setup-summary strong {
          color: var(--text-primary);
        }

        .setup-wizard-actions {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }
      `}</style>
    </div>
  )
}
