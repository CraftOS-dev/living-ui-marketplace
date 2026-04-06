import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Spinner, EmptyState } from '../ui'
import { ApiService } from '../../services/ApiService'
import { ChatMessageBubble } from './ChatMessageBubble'
import { ChatInput } from './ChatInput'
import { toast } from 'react-toastify'
import type { ChatSession, ChatMessageData } from '../../types'

const QUICK_ACTIONS = [
  { label: 'Free Conversation', prompt: "Let's have a free conversation to practice!" },
  { label: 'Grammar Help', prompt: 'Can you help me understand a grammar concept?' },
  { label: 'Translate', prompt: 'Can you translate something for me?' },
  { label: 'Explain a Word', prompt: 'Can you explain the meaning and usage of a word?' },
]

export function AITeacherView() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const loadSessions = useCallback(async () => {
    try {
      const data = await ApiService.getChatSessions()
      setSessions(data)
      return data
    } catch {
      toast.error('Failed to load chat sessions')
      return []
    }
  }, [])

  // Load sessions on mount
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setLoading(true)
      const data = await loadSessions()
      if (!cancelled && data.length > 0) {
        setActiveSessionId(data[0].sessionId)
      }
      if (!cancelled) setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [loadSessions])

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      return
    }
    let cancelled = false
    const loadMessages = async () => {
      try {
        setLoading(true)
        const data = await ApiService.getChatSession(activeSessionId)
        if (!cancelled) setMessages(data.messages)
      } catch {
        if (!cancelled) toast.error('Failed to load messages')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadMessages()
    return () => { cancelled = true }
  }, [activeSessionId])

  const handleNewConversation = async () => {
    try {
      const { sessionId } = await ApiService.createChatSession()
      setActiveSessionId(sessionId)
      setMessages([])
      await loadSessions()
      setShowSidebar(false)
    } catch {
      toast.error('Failed to create conversation')
    }
  }

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await ApiService.deleteChatSession(sessionId)
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setMessages([])
      }
      await loadSessions()
      toast.success('Conversation deleted')
    } catch {
      toast.error('Failed to delete conversation')
    }
  }

  const handleSend = async (content: string) => {
    let sessionId = activeSessionId
    if (!sessionId) {
      try {
        const result = await ApiService.createChatSession()
        sessionId = result.sessionId
        setActiveSessionId(sessionId)
      } catch {
        toast.error('Failed to create conversation')
        return
      }
    }

    const tempUserMsg: ChatMessageData = {
      id: Date.now(),
      sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])
    setSending(true)

    try {
      const { message: aiMessage, userMessage } = await ApiService.sendChatMessage(sessionId, content)
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id)
        return [...withoutTemp, userMessage, aiMessage]
      })
      loadSessions()
    } catch {
      toast.error('Failed to send message')
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id))
    } finally {
      setSending(false)
    }
  }

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId)
    setShowSidebar(false)
  }

  return (
    <>
      <style>{`
        .ai-teacher-container {
          display: flex;
          height: 100%;
          min-height: 400px;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          overflow: hidden;
          position: relative;
        }
        .ai-teacher-sidebar {
          width: 250px;
          min-width: 250px;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
        }
        .ai-teacher-sidebar-header {
          padding: var(--space-3);
          border-bottom: 1px solid var(--border-color);
        }
        .ai-teacher-session-list {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-2);
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }
        .ai-teacher-session-item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          cursor: pointer;
          border: none;
          background: none;
          text-align: left;
          width: 100%;
          color: var(--text-primary);
          font-size: var(--font-size-sm);
          transition: background-color 0.15s;
        }
        .ai-teacher-session-item:hover {
          background-color: var(--bg-tertiary);
        }
        .ai-teacher-session-item.active {
          background-color: var(--color-primary);
          color: var(--color-white, #fff);
        }
        .ai-teacher-session-preview {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ai-teacher-session-delete {
          opacity: 0.5;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          padding: 0 var(--space-1);
          color: inherit;
          line-height: 1;
          flex-shrink: 0;
        }
        .ai-teacher-session-delete:hover {
          opacity: 1;
        }
        .ai-teacher-chat-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .ai-teacher-messages {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-4);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }
        .ai-teacher-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-4);
          gap: var(--space-2);
          color: var(--text-muted);
          font-size: var(--font-size-sm);
        }
        .ai-teacher-mobile-header {
          display: none;
          padding: var(--space-2) var(--space-3);
          border-bottom: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
          align-items: center;
          gap: var(--space-2);
        }
        @media (max-width: 640px) {
          .ai-teacher-sidebar {
            position: absolute;
            inset: 0;
            width: 100%;
            min-width: 100%;
            z-index: 10;
          }
          .ai-teacher-sidebar.hidden-mobile {
            display: none;
          }
          .ai-teacher-mobile-header {
            display: flex;
          }
          .ai-teacher-chat-area.hidden-mobile {
            display: none;
          }
        }
      `}</style>
      <div className="ai-teacher-container">
        <div className={`ai-teacher-sidebar${!showSidebar ? ' hidden-mobile' : ''}`}>
          <div className="ai-teacher-sidebar-header">
            <Button fullWidth size="sm" onClick={handleNewConversation}>
              New Conversation
            </Button>
          </div>
          <div className="ai-teacher-session-list">
            {sessions.length === 0 && !loading && (
              <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
                No conversations yet
              </div>
            )}
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                className={`ai-teacher-session-item${activeSessionId === session.sessionId ? ' active' : ''}`}
                onClick={() => handleSelectSession(session.sessionId)}
              >
                <span className="ai-teacher-session-preview">
                  {session.preview || 'New conversation'}
                </span>
                <button
                  className="ai-teacher-session-delete"
                  onClick={(e) => handleDeleteSession(session.sessionId, e)}
                  title="Delete conversation"
                >
                  ×
                </button>
              </button>
            ))}
          </div>
        </div>

        <div className={`ai-teacher-chat-area${showSidebar ? ' hidden-mobile' : ''}`}>
          <div className="ai-teacher-mobile-header">
            <Button variant="ghost" size="sm" onClick={() => setShowSidebar(true)}>
              ← Back
            </Button>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              AI Teacher
            </span>
          </div>

          <div className="ai-teacher-messages">
            {loading && messages.length === 0 ? (
              <div className="ai-teacher-loading">
                <Spinner size={20} />
                <span>Loading messages...</span>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<span style={{ fontSize: 48 }}>💬</span>}
                title="Start a Conversation"
                message="Ask your AI teacher anything about language learning!"
              />
            ) : (
              messages.map((msg) => (
                <ChatMessageBubble key={msg.id} message={msg} />
              ))
            )}
            {sending && (
              <div className="ai-teacher-loading">
                <Spinner size={16} />
                <span>AI is thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <ChatInput
            onSend={handleSend}
            disabled={sending}
            quickActions={QUICK_ACTIONS}
          />
        </div>
      </div>
    </>
  )
}
