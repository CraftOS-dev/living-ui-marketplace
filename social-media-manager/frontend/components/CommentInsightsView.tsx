import { useState } from 'react'
import { MessageSquare, AlertCircle, Info, Sparkles, Twitter, Linkedin, Youtube } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button, Card } from './ui'
import type { AppController } from '../AppController'
import type { AppState, Platform, Post, CommentInsightsResult, CommentInsightsAnalysis } from '../types'

interface Props {
  controller: AppController
  state: AppState
}

const TABS: { value: Platform; label: string; Icon: React.ElementType }[] = [
  { value: 'google_youtube', label: 'YouTube', Icon: Youtube },
  { value: 'twitter', label: 'Twitter/X', Icon: Twitter },
  { value: 'linkedin', label: 'LinkedIn', Icon: Linkedin },
]

const TIME_FILTERS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 0, label: 'All' },
]

function SentimentBar({ sentiment }: { sentiment: CommentInsightsAnalysis['sentiment'] }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', height: '20px', borderRadius: '10px', overflow: 'hidden', gap: '2px' }}>
        {sentiment.positive > 0 && (
          <div style={{ flex: sentiment.positive, background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff', minWidth: '28px' }}>
            {sentiment.positive}%
          </div>
        )}
        {sentiment.neutral > 0 && (
          <div style={{ flex: sentiment.neutral, background: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff', minWidth: '28px' }}>
            {sentiment.neutral}%
          </div>
        )}
        {sentiment.negative > 0 && (
          <div style={{ flex: sentiment.negative, background: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff', minWidth: '28px' }}>
            {sentiment.negative}%
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)' }}>
        <span>● Positive {sentiment.positive}%</span>
        <span>● Neutral {sentiment.neutral}%</span>
        <span>● Negative {sentiment.negative}%</span>
      </div>
    </div>
  )
}

function InsightsPanel({ result, onReply }: { result: CommentInsightsResult; onReply: (text: string) => void }) {
  if (result.status === 'unavailable') {
    return (
      <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
        <AlertCircle size={15} />
        Connect CraftBot to analyze comments
      </div>
    )
  }
  if (result.status === 'restricted' || result.status === 'error') {
    return (
      <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} color="#d97706" />
        {result.message}
      </div>
    )
  }
  if (result.status === 'ok' && result.commentsFetched === 0) {
    return (
      <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
        <Info size={15} />
        No comments yet on this post
      </div>
    )
  }
  if (!result.analysis) return null

  const { analysis } = result
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Based on {result.commentsFetched} comments</div>

      <SentimentBar sentiment={analysis.sentiment} />

      {analysis.themes.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Themes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {analysis.themes.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: '12px' }}>{t.theme}</span>
                  {t.quote && <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>"{t.quote}"</p>}
                </div>
                <span style={{ fontSize: '10px', background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: '10px', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }}>{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis.top_questions.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Top Questions</div>
          <ol style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {analysis.top_questions.map((q, i) => (
              <li key={i} style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{q}</li>
            ))}
          </ol>
        </div>
      )}

      {analysis.insights.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Insights</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {analysis.insights.map((ins, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px 10px', background: '#FF4F1811', borderRadius: 'var(--radius-md)' }}>
                <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>→</span>
                <span style={{ fontSize: '12px' }}>{ins}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis.top_comments.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Worth Replying To</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {analysis.top_comments.map((c, i) => (
              <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ margin: '0 0 3px', fontSize: '12px' }}>"{c.text}"</p>
                  <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted)' }}>{c.reason}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onReply(c.text)} style={{ flexShrink: 0, fontSize: '11px' }}>
                  Reply
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PostCard({
  post,
  insights,
  loading,
  error,
  onLoad,
  onReply,
}: {
  post: Post
  insights: CommentInsightsResult | null
  loading: boolean
  error: string
  onLoad: () => void
  onReply: (text: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const date = post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

  function handleLoad() {
    setExpanded(true)
    onLoad()
  }

  return (
    <Card style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: expanded && (insights || loading) ? '14px' : '0' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 4px', fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {post.effectiveContent}
          </p>
          {date && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{date}</span>}
        </div>
        {!insights && !loading && (
          error ? (
            <span style={{ fontSize: '12px', color: 'var(--color-error)', flexShrink: 0 }}>
              {error} —{' '}
              <button onClick={handleLoad} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '12px', padding: 0 }}>
                Retry
              </button>
            </span>
          ) : (
            <Button variant="secondary" size="sm" onClick={handleLoad} style={{ flexShrink: 0 }}>
              <Sparkles size={13} /> Analyze
            </Button>
          )
        )}
        {loading && <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>Fetching...</span>}
        {insights && !loading && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ fontSize: '12px', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {expanded && loading && (
        <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--text-muted)' }}>
          Analyzing comments with AI...
        </div>
      )}
      {expanded && insights && !loading && (
        <InsightsPanel result={insights} onReply={onReply} />
      )}
    </Card>
  )
}

export default function CommentInsightsView({ controller, state }: Props) {
  const [activePlatform, setActivePlatform] = useState<Platform>('google_youtube')
  const [days, setDays] = useState(0)
  // per-post state
  const [loadingMap, setLoadingMap] = useState<Record<number, boolean>>({})
  const [insightsMap, setInsightsMap] = useState<Record<number, CommentInsightsResult>>({})
  const [errorMap, setErrorMap] = useState<Record<number, string>>({})

  const cutoff = days > 0 ? Date.now() - days * 86400000 : 0
  const posts = state.posts.filter(p =>
    p.status === 'published' &&
    p.platformPostId &&
    p.platform === activePlatform &&
    (cutoff === 0 || (p.publishedAt && new Date(p.publishedAt).getTime() >= cutoff))
  )

  async function loadInsights(post: Post) {
    if (!post.platformPostId || loadingMap[post.id]) return
    setLoadingMap(prev => ({ ...prev, [post.id]: true }))
    try {
      const res = await controller.fetchCommentInsights(post.platform, post.platformPostId!)
      if (res) {
        setInsightsMap(prev => ({ ...prev, [post.id]: res }))
        setErrorMap(prev => ({ ...prev, [post.id]: '' }))
      } else {
        setErrorMap(prev => ({ ...prev, [post.id]: 'Could not fetch comments' }))
      }
    } finally {
      setLoadingMap(prev => ({ ...prev, [post.id]: false }))
    }
  }

  function replyToComment(text: string) {
    navigator.clipboard.writeText(text)
    toast.success('Comment copied — switch to Compose to reply')
    controller.setActiveSection('composer')
  }

  return (
    <div style={{ padding: '24px', maxWidth: '860px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <MessageSquare size={22} color="var(--color-primary)" />
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Comment Insights</h1>
      </div>

      {/* Platform tabs + time filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
          {TABS.map(({ value, label, Icon }) => (
            <button
              key={value}
              onClick={() => setActivePlatform(value)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px', borderRadius: 'calc(var(--radius-md) - 2px)',
                fontSize: '13px', fontWeight: 500, cursor: 'pointer', border: 'none',
                background: activePlatform === value ? 'var(--bg-primary)' : 'transparent',
                color: activePlatform === value ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: activePlatform === value ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '4px' }}>
          {TIME_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setDays(f.value)}
              style={{
                padding: '5px 12px', borderRadius: 'var(--radius-md)', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: days === f.value ? 'var(--color-primary)' : 'var(--border-color)',
                background: days === f.value ? 'var(--color-primary)' : 'transparent',
                color: days === f.value ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Post list */}
      {posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <MessageSquare size={36} style={{ marginBottom: '12px', opacity: 0.25 }} />
          <p style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)' }}>No published {TABS.find(t => t.value === activePlatform)?.label} posts yet</p>
          <p style={{ margin: 0, fontSize: '13px', maxWidth: '280px', marginInline: 'auto', lineHeight: 1.5 }}>Once you publish a post, it appears here. Click Analyze on any post to fetch its comments and get an AI breakdown of sentiment, themes, and what's worth replying to.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              insights={insightsMap[post.id] ?? null}
              loading={!!loadingMap[post.id]}
              error={errorMap[post.id] ?? ''}
              onLoad={() => loadInsights(post)}
              onReply={replyToComment}
            />
          ))}
        </div>
      )}
    </div>
  )
}
