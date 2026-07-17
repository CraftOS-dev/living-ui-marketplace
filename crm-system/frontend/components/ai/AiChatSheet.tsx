import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Sparkles } from 'lucide-react'

import { api } from '@/api'
import type { AiStatus, RecordBrief } from '@/types'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { BriefAvatar } from '@/components/common/RecordAvatar'
import { EmptyState } from '@/components/common/EmptyState'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  records?: RecordBrief[]
}

const SUGGESTIONS = [
  'Which deals are stalled more than 30 days?',
  'Who should I follow up with this week?',
  "What's the total open pipeline value?",
  'Summarize activity from the last 7 days',
]

/** "Ask your CRM" slide-over (F9.4). Honest empty state when no LLM. */
export function AiChatSheet({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && status === null) {
      api.ai.status().then(setStatus).catch(() => setStatus({ configured: false, model: '' }))
    }
  }, [open, status])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinking) return
    setQuestion('')
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }])
    setThinking(true)
    try {
      const response = await api.ai.chat(trimmed)
      if (!response.configured) {
        setStatus({ configured: false, model: '' })
      } else if (response.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', text: response.answer || '', records: response.records }])
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', text: response.error || 'Something went wrong — try again.' }])
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: error instanceof Error ? error.message : 'Request failed' },
      ])
    } finally {
      setThinking(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col p-0">
        <SheetHeader className="border-b px-4 py-3.5">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Ask your CRM
          </SheetTitle>
          <SheetDescription className="text-xs">
            {status?.configured
              ? `Answers grounded in your CRM data · ${status.model}`
              : 'Natural-language questions over your CRM data'}
          </SheetDescription>
        </SheetHeader>

        {status !== null && !status.configured ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={Sparkles}
              title="No LLM provider configured"
              description="Connect an LLM provider in CraftBot settings and AI features — record summaries, email drafting, lead scoring, and this chat — light up automatically."
            />
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && !thinking ? (
                <div className="space-y-2 pt-4">
                  <p className="label-caps">Try asking</p>
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => ask(suggestion)}
                      className="block w-full rounded-md border border-border px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}

              {messages.map((message, index) => (
                <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      message.role === 'user'
                        ? 'max-w-[85%] rounded-lg bg-primary px-3 py-2 text-[13px] text-primary-foreground'
                        : 'max-w-[92%] rounded-lg border border-border bg-card px-3 py-2 text-[13px]'
                    }
                  >
                    <div className="whitespace-pre-wrap">{message.text}</div>
                    {message.records && message.records.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {message.records.map((brief) => (
                          <button
                            key={`${brief.recordType}-${brief.id}`}
                            onClick={() => {
                              setOpen(false)
                              navigateTo(recordPath(brief.recordType, brief.id))
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium hover:bg-accent"
                          >
                            <BriefAvatar brief={brief} size="xs" />
                            {brief.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {thinking ? (
                <div className="max-w-[80%] space-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-56" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ) : null}
            </div>

            <div className="border-t p-3">
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  ask(question)
                }}
              >
                <Input
                  placeholder="Ask anything about your CRM…"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  disabled={thinking}
                  autoFocus
                />
                <Button type="submit" size="icon" disabled={!question.trim() || thinking} aria-label="Send">
                  <CornerDownLeft />
                </Button>
              </form>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
