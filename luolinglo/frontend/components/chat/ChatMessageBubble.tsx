
import type { ChatMessageData } from '../../types'

interface ChatMessageBubbleProps {
  message: ChatMessageData
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isUser = message.role === 'user'
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <>
      <style>{`
        .chat-bubble-wrap {
          display: flex;
          flex-direction: column;
          align-items: ${isUser ? 'flex-end' : 'flex-start'};
          max-width: 100%;
        }
        .chat-bubble {
          max-width: 80%;
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
          font-size: var(--font-size-sm);
          line-height: 1.6;
          white-space: pre-wrap;
          word-wrap: break-word;
          background-color: ${isUser ? 'var(--color-primary)' : 'var(--bg-tertiary)'};
          color: ${isUser ? 'var(--color-white, #fff)' : 'var(--text-primary)'};
          border-bottom-right-radius: ${isUser ? 'var(--space-1)' : 'var(--radius-lg)'};
          border-bottom-left-radius: ${isUser ? 'var(--radius-lg)' : 'var(--space-1)'};
        }
        .chat-bubble-time {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          margin-top: var(--space-1);
          padding: 0 var(--space-1);
        }
      `}</style>
      <div className="chat-bubble-wrap">
        <div className="chat-bubble">{message.content}</div>
        <span className="chat-bubble-time">{time}</span>
      </div>
    </>
  )
}
