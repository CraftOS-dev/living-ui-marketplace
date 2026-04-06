

interface LoadingViewProps {
  message?: string
}

export function LoadingView({ message = 'Loading...' }: LoadingViewProps) {
  return (
    <div className="loading-view">
      <span className="loading-spinner" />
      <p className="loading-message">{message}</p>

      <style>{`
        .loading-view {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          gap: var(--space-4);
        }

        .loading-spinner {
          display: inline-block;
          width: 32px;
          height: 32px;
          border: 3px solid var(--border-primary);
          border-top-color: var(--color-primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .loading-message {
          font-size: var(--font-size-base);
          color: var(--text-secondary);
          margin: 0;
        }
      `}</style>
    </div>
  )
}
