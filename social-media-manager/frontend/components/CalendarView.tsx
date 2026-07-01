import { useState } from 'react'
import { ChevronLeft, ChevronRight, PenSquare } from 'lucide-react'
import { Button } from './ui'
import { PostDetailModal } from './PostDetailModal'
import type { AppController } from '../AppController'
import type { AppState, Post, Platform } from '../types'

interface CalendarViewProps {
  controller: AppController
  state: AppState
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const PLATFORM_COLORS: Record<Platform, string> = {
  twitter: '#1DA1F2',
  linkedin: '#0A66C2',
  google_youtube: '#FF0000',
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number) {
  // 0=Sun, 1=Mon... convert to Mon=0 index
  const d = new Date(year, month - 1, 1).getDay()
  return d === 0 ? 6 : d - 1
}

export function CalendarView({ controller, state }: CalendarViewProps) {
  const { calendarYear: year, calendarMonth: month, calendarPosts } = state
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [dayPopover, setDayPopover] = useState<string | null>(null)

  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // pad to complete rows
  while (cells.length % 7 !== 0) cells.push(null)

  const getDayKey = (day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const getDayPosts = (day: number): Post[] => calendarPosts[getDayKey(day)] || []

  const today = new Date()
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === day

  return (
    <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            onClick={() => controller.prevMonth()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 'var(--space-1)' }}
          >
            <ChevronLeft size={20} />
          </button>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)', minWidth: 200, textAlign: 'center' }}>
            {MONTH_NAMES[month - 1]} {year}
          </h2>
          <button
            onClick={() => controller.nextMonth()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 'var(--space-1)' }}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<PenSquare size={14} />}
          onClick={() => controller.setActiveSection('composer')}
        >
          New Post
        </Button>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 1 }}>
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              style={{
                textAlign: 'center',
                padding: 'var(--space-2)',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 'var(--font-weight-semibold)' as any,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, backgroundColor: 'var(--border-primary)' }}>
          {cells.map((day, idx) => {
            const posts = day ? getDayPosts(day) : []
            const dayKey = day ? getDayKey(day) : null
            const isPopoverOpen = dayKey === dayPopover

            return (
              <div
                key={idx}
                onClick={() => {
                  if (day && posts.length > 0) setDayPopover(isPopoverOpen ? null : dayKey)
                  else setDayPopover(null)
                }}
                style={{
                  minHeight: 80,
                  backgroundColor: day ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                  padding: 'var(--space-2)',
                  cursor: day && posts.length > 0 ? 'pointer' : 'default',
                  position: 'relative',
                }}
              >
                {day && (
                  <>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: isToday(day) ? ('var(--font-weight-bold)' as any) : 'normal',
                        backgroundColor: isToday(day) ? 'var(--color-primary)' : 'transparent',
                        color: isToday(day) ? 'white' : 'var(--text-primary)',
                        marginBottom: 'var(--space-1)',
                      }}
                    >
                      {day}
                    </div>
                    {/* Post dots */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      {posts.slice(0, 6).map((post, i) => (
                        <span
                          key={i}
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: PLATFORM_COLORS[post.platform as Platform] || 'var(--color-primary)',
                            flexShrink: 0,
                          }}
                          title={post.effectiveContent?.slice(0, 50)}
                        />
                      ))}
                      {posts.length > 6 && (
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>+{posts.length - 6}</span>
                      )}
                    </div>

                    {/* Day popover */}
                    {isPopoverOpen && posts.length > 0 && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          zIndex: 50,
                          minWidth: 200,
                          maxWidth: 280,
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-primary)',
                          borderRadius: 'var(--radius-lg)',
                          boxShadow: 'var(--shadow-lg)',
                          padding: 'var(--space-2)',
                        }}
                      >
                        {posts.map((post) => (
                          <button
                            key={post.id}
                            onClick={() => { setSelectedPost(post); setDayPopover(null) }}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 'var(--space-2)',
                              padding: 'var(--space-2)',
                              borderRadius: 'var(--radius-md)',
                              border: 'none',
                              backgroundColor: 'transparent',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: PLATFORM_COLORS[post.platform as Platform],
                                flexShrink: 0,
                                marginTop: 4,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: 200,
                              }}
                            >
                              {post.effectiveContent?.slice(0, 60) || '(no content)'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <PostDetailModal
        post={selectedPost}
        open={!!selectedPost}
        onClose={() => setSelectedPost(null)}
        controller={controller}
      />
    </div>
  )
}
