import { Mail } from 'lucide-react'
import { Card } from './ui'

export function GmailGate() {
  return (
    <div className="gmail-gate">
      <Card className="gate-card">
        <div className="gate-icon">
          <Mail size={48} />
        </div>
        <h2 className="gate-title">Gmail Integration Required</h2>
        <p className="gate-body">
          Email Manager reads your Gmail inbox to populate columns. Connect your
          Google account in CraftBot to get started.
        </p>
        <ol className="gate-steps">
          <li>Open CraftBot settings</li>
          <li>Go to <strong>Integrations</strong></li>
          <li>Connect your <strong>Google / Gmail</strong> account</li>
          <li>Return here — the board will load automatically</li>
        </ol>
      </Card>

      <style>{`
        .gmail-gate {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-6);
          background: var(--bg-primary);
        }

        .gate-card {
          max-width: 440px;
          width: 100%;
          text-align: center;
          padding: var(--space-8) var(--space-6);
        }

        .gate-icon {
          display: flex;
          justify-content: center;
          margin-bottom: var(--space-4);
          color: var(--color-accent);
        }

        .gate-title {
          font-size: var(--font-size-xl);
          font-weight: var(--font-weight-semibold);
          margin-bottom: var(--space-3);
          color: var(--text-primary);
        }

        .gate-body {
          color: var(--text-secondary);
          font-size: var(--font-size-base);
          line-height: var(--line-height-relaxed);
          margin-bottom: var(--space-5);
        }

        .gate-steps {
          text-align: left;
          color: var(--text-secondary);
          font-size: var(--font-size-sm);
          line-height: var(--line-height-relaxed);
          padding-left: var(--space-5);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .gate-steps strong {
          color: var(--color-accent);
        }
      `}</style>
    </div>
  )
}
