import { useState } from 'react'
import { MessageSquare, Search, AlertCircle, Info } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button, Card } from './ui'
import type { AppController } from '../AppController'
import type { AppState, Platform, CommentInsightsResult, CommentInsightsAnalysis } from '../types'

interface Props {
  controller: AppController
  state: AppState
}

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'google_youtube', label: 'YouTube' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'linkedin', label: 'LinkedIn' },
]

function SentimentBar({ sentiment }: { sentiment: CommentInsightsAnalysis['sentiment'] }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>Sentiment</div>
      <div style={{ display: 'flex', height: '24px', borderRadius: '12px', overflow: 'hidden', gap: '2px' }}>
        {sentiment.positive > 0 && (
          <div style={{ flex: sentiment.positive, background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#fff', minWidth: '30px' }}>
            {sentiment.positive}%
          </div>
        )}
        {sentiment.neutral > 0 && (
          <div style={{ flex: sentiment.neutral, background: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#fff', minWidth: '30px' }}>
            {sentiment.neutral}%
          </div>
        )}
        {sentiment.negative > 0 && (
          <div style={{ flex: sentiment.negative, background: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#fff', minWidth: '30px' }}>
            {sentiment.negative}%
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
        <span>● Positive {sentiment.positive}%</span>
        <span>● Neutral {sentiment.neutral}%</span>
        <span>● Negative {sentiment.negative}%</span>
      </div>
    </div>
  )
}

export default function CommentInsightsView({ controller, state }: Props) {
  const publishedPosts = state.posts.filter(p => p.status === 'published' && p.platformPostId)

  const [platform, setPlatform] = useState<Platform>('google_youtube')
  const [postId, setPostId] = useState('')
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CommentInsightsResult | null>(null)
  const [mode, setMode] = useState<'pick' | 'manual'>('pick')

  async function analyze() {
    const id = mode === 'pick'
      ? (state.posts.find(p => p.id === selectedPostId)?.platformPostId || '')
      : postId.trim()

    if (!id) { toast.error('Select a post or enter a post ID'); return }

    const plat = mode === 'pick'
      ? (state.posts.find(p => p.id === selectedPostId)?.platform || platform)
      : platform

    setLoading(true)
    setResult(null)
    try {
      const res = await controller.fetchCommentInsights(plat, id)
      setResult(res)
      if (res?.status === 'ok' && res.commentsFetched === 0) {
        toast.info('No comments found yet')
      }
    } finally {
      setLoading(false)
    }
  }

  function replyToComment(text: string) {
    navigator.clipboard.writeText(text)
    toast.success('Comment copied — switch to Compose to reply')
    controller.setActiveSection('composer')
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <MessageSquare size={22} color="var(--color-primary)" />
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Comment Insights</h1>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px' }}>
        Fetch comments from your published posts and get AI-powered analysis of sentiment, themes, and top questions.
      </p>

      <Card style={{ padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {(['pick', 'manual'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: mode === m ? 'var(--color-primary)' : 'var(--border-color)', background: mode === m ? 'var(--color-primary)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-secondary)' }}>
              {m === 'pick' ? 'Pick a post' : 'Enter post ID'}
            </button>
          ))}
        </div>

        {mode === 'pick' ? (
          publishedPosts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>No published posts yet. Publish a post first.</p>
          ) : (
            <select value={selectedPostId ?? ''} onChange={e => setSelectedPostId(Number(e.target.value))}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px' }}>
              <option value="">Select a published post...</option>
              {publishedPosts.map(p => (
                <option key={p.id} value={p.id}>
                  [{p.platform}] {p.effectiveContent.slice(0, 60)}{p.effectiveContent.length > 60 ? '...' : ''}
                </option>
              ))}
            </select>
          )
        ) : (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Platform</label>
              <select value={platform} onChange={e => setPlatform(e.target.value as Platform)}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px' }}>
                {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Post ID</label>
              <input value={postId} onChange={e => setPostId(e.target.value)}
                placeholder="YouTube video ID, tweet ID, or LinkedIn post URN"
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>
          </div>
        )}

        <Button onClick={analyze} disabled={loading} style={{ marginTop: '16px' }}>
          {loading ? 'Analyzing...' : <><Search size={15} /> Fetch & Analyze</>}
        </Button>
      </Card>

      {loading && (
        <Card style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <MessageSquare size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
          <p style={{ margin: 0 }}>Fetching comments and analyzing with AI...</p>
        </Card>
      )}

      {!loading && result && (
        <>
          {result.status === 'unavailable' && (
            <Card style={{ padding: '20px', borderLeft: '4px solid var(--color-warning, #d97706)', display: 'flex', gap: '12px' }}>
              <AlertCircle size={20} color="var(--color-warning, #d97706)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '14px' }}>Bridge Unavailable</div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {result.message || 'Connect CraftBot to use AI features.'}
                </p>
              </div>
            </Card>
          )}

          {(result.status === 'error' || result.status === 'restricted') && (
            <Card style={{ padding: '20px', borderLeft: '4px solid var(--color-warning, #d97706)', display: 'flex', gap: '12px' }}>
              <AlertCircle size={20} color="var(--color-warning, #d97706)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '14px' }}>
                  {result.status === 'restricted' ? 'Access Restricted' : 'Could Not Fetch Comments'}
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{result.message}</p>
              </div>
            </Card>
          )}

          {result.status === 'ok' && result.commentsFetched === 0 && (
            <Card style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Info size={28} style={{ marginBottom: '10px', opacity: 0.4 }} />
              <p style={{ margin: 0 }}>{result.message || 'No comments found on this post yet.'}</p>
            </Card>
          )}

          {result.status === 'ok' && result.analysis && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '-8px' }}>
                Based on {result.commentsFetched} comments from {result.platform}
              </div>

              <Card style={{ padding: '20px' }}>
                <SentimentBar sentiment={result.analysis.sentiment} />

                {result.analysis.themes.length > 0 && (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)' }}>Top Themes</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                      {result.analysis.themes.map((t, i) => (
                        <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontWeight: 600, fontSize: '13px' }}>{t.theme}</span>
                            <span style={{ fontSize: '11px', background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: '10px', color: 'var(--text-muted)' }}>{t.count}</span>
                          </div>
                          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>"{t.quote}"</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {result.analysis.top_questions.length > 0 && (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)' }}>Top Questions</div>
                    <ol style={{ margin: '0 0 20px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {result.analysis.top_questions.map((q, i) => (
                        <li key={i} style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{q}</li>
                      ))}
                    </ol>
                  </>
                )}

                {result.analysis.insights.length > 0 && (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)' }}>Key Insights</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                      {result.analysis.insights.map((ins, i) => (
                        <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px 12px', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)' }}>
                          <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>→</span>
                          <span style={{ fontSize: '13px' }}>{ins}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {result.analysis.top_comments.length > 0 && (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)' }}>Worth Replying To</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {result.analysis.top_comments.map((c, i) => (
                        <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                          <div>
                            <p style={{ margin: '0 0 4px', fontSize: '13px' }}>"{c.text}"</p>
                            <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>{c.reason}</p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => replyToComment(c.text)} style={{ flexShrink: 0 }}>
                            Reply
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
