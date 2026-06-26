import { useState, useEffect } from 'react'
import { Zap, RefreshCw, Copy, ExternalLink, Bookmark, FileText, X, Pencil, Check } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button, Input, Card } from './ui'
import type { AppController } from '../AppController'
import type { AppState, Platform, HookResult, HookFramework } from '../types'

interface Props {
  controller: AppController
  state: AppState
}

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'google_youtube', label: 'YouTube' },
]

const FRAMEWORK_COLORS: Record<HookFramework, string> = {
  'Data/Number': '#FF4F18',
  'Curiosity Gap': '#8B5CF6',
  'Problem-Solution': '#059669',
  'Social Proof': '#0EA5E9',
  'Contrarian': '#DC2626',
  'Story': '#D97706',
  'Question': '#7C3AED',
}

const TONES = ['professional', 'casual', 'playful', 'persuasive', 'edgy']
const GOALS = [
  { value: 'grow_followers', label: 'Grow followers' },
  { value: 'drive_clicks', label: 'Drive clicks' },
  { value: 'drive_dms', label: 'Drive DMs' },
  { value: 'increase_saves', label: 'Increase saves' },
  { value: 'spark_debate', label: 'Spark debate' },
]

export default function HookCreatorView({ controller, state }: Props) {
  const prefilled = state.prefilledTool?.tool === 'hooks' ? state.prefilledTool : null

  const [topic, setTopic] = useState(prefilled?.text || '')
  const [description, setDescription] = useState('')
  const [platform, setPlatform] = useState<Platform>(prefilled?.platform || 'twitter')
  const [audience, setAudience] = useState('general audience')
  const [tone, setTone] = useState('casual')
  const [goal, setGoal] = useState('grow_followers')
  const [count, setCount] = useState(5)
  const [hooks, setHooks] = useState<HookResult[]>([])
  const [loading, setLoading] = useState(false)
  const [post, setPost] = useState<{ hook: string; text: string } | null>(null)
  const [postLoadingHook, setPostLoadingHook] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (prefilled) {
      setTopic(prefilled.text.slice(0, 200))
      setPlatform(prefilled.platform)
    }
  }, [state.prefilledTool])

  async function generate() {
    if (!topic.trim()) { toast.error('Enter a topic first'); return }
    setLoading(true)
    setHooks([])
    try {
      const results = await controller.generateHooks(topic, platform, { description: description.trim() || undefined, audience, tone, goal, count })
      if (results.length === 0) {
        toast.warning('No hooks generated — check CraftBot bridge connection')
      }
      setHooks(results)
    } finally {
      setLoading(false)
    }
  }

  async function createFullPost(hook: string) {
    setPostLoadingHook(hook)
    try {
      const text = await controller.generatePost(topic, hook, platform, { description: description.trim() || undefined, audience, tone, goal })
      if (!text) { toast.warning('No post generated — check AI connection'); return }
      setPost({ hook, text })
      setEditing(false)
    } finally {
      setPostLoadingHook(null)
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text)
    toast.success('Copied!')
  }

  function useInPost(text: string) {
    controller.sendToComposer(text, platform)
    toast.success('Added to Compose')
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <Zap size={22} color="var(--color-primary)" />
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Post Creator</h1>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'flex-end', paddingBottom: '2px' }}>Step 1 · pick a hook</span>
      </div>

      {state.integrations && !state.integrations.bridgeAvailable && (
        <div style={{ background: 'var(--color-warning-bg, #fef3c7)', border: '1px solid var(--color-warning, #d97706)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: '20px', color: 'var(--color-warning-text, #92400e)', fontSize: '14px' }}>
          Connect CraftBot to use AI features
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
        <Card style={{ padding: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Topic *</label>
              <Input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="e.g. building in public, cold email strategy"
                onKeyDown={e => e.key === 'Enter' && generate()}
              />
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Post description <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span></label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What is the post about? Key points, angle, what you want people to feel or do..."
                rows={3}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', resize: 'vertical', fontFamily: 'var(--font-sans)', boxSizing: 'border-box', outline: 'none', transition: 'var(--transition-base)' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Platform</label>
              <select value={platform} onChange={e => setPlatform(e.target.value as Platform)}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px' }}>
                {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Target Audience</label>
              <Input value={audience} onChange={e => setAudience(e.target.value)} placeholder="SaaS founders, content creators..." />
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Tone</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {TONES.map(t => (
                  <button key={t} onClick={() => setTone(t)}
                    style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: tone === t ? 'var(--color-primary)' : 'var(--border-color)', background: tone === t ? 'var(--color-primary)' : 'transparent', color: tone === t ? '#fff' : 'var(--text-secondary)' }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Goal</label>
              <select value={goal} onChange={e => setGoal(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px' }}>
                {GOALS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Number of hooks</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[3, 5, 7].map(n => (
                  <button key={n} onClick={() => setCount(n)}
                    style={{ flex: 1, padding: '6px', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: '1px solid', borderColor: count === n ? 'var(--color-primary)' : 'var(--border-color)', background: count === n ? 'var(--color-primary)' : 'transparent', color: count === n ? '#fff' : 'var(--text-secondary)' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={generate} disabled={loading} style={{ width: '100%', marginTop: '4px' }}>
              {loading ? 'Generating...' : <><Zap size={15} /> Generate Hooks</>}
            </Button>
          </div>
        </Card>

        <div>
          {post && (
            <Card style={{ padding: '20px', marginBottom: '16px', border: '1px solid var(--color-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)' }}>Step 2 · Full post</span>
                <Button variant="ghost" size="sm" onClick={() => { setPost(null); setEditing(false) }}><X size={14} /> Back to hooks</Button>
              </div>
              {editing ? (
                <textarea
                  value={post.text}
                  onChange={e => setPost({ hook: post.hook, text: e.target.value })}
                  rows={8}
                  autoFocus
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', lineHeight: 1.6, resize: 'vertical', fontFamily: 'var(--font-sans)', boxSizing: 'border-box', outline: 'none' }}
                />
              ) : (
                <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{post.text}</p>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
                <Button variant="secondary" size="sm" onClick={() => createFullPost(post.hook)} disabled={postLoadingHook !== null}>
                  <RefreshCw size={13} className={postLoadingHook === post.hook ? 'spin' : undefined} /> Regenerate
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
                  {editing ? <><Check size={13} /> Done</> : <><Pencil size={13} /> Edit</>}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copyText(post.text)}><Copy size={13} /> Copy</Button>
                <Button variant="ghost" size="sm" onClick={() => useInPost(post.text)}><ExternalLink size={13} /> Use in Post</Button>
                <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>{post.text.length} chars</span>
              </div>
            </Card>
          )}

          {hooks.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{hooks.length} hooks generated</span>
              <Button variant="ghost" size="sm" onClick={generate} disabled={loading}>
                <RefreshCw size={14} /> Regenerate
              </Button>
            </div>
          )}

          {loading && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} style={{ height: '120px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          )}

          {!loading && hooks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              <Zap size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
              <p style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)' }}>Ready to generate</p>
              <p style={{ margin: 0, fontSize: '13px', maxWidth: '260px', marginInline: 'auto', lineHeight: 1.5 }}>Enter your topic, pick a platform and tone, then click Generate. Each hook uses a different copywriting framework so you can test what lands.</p>
            </div>
          )}

          {!loading && hooks.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {hooks.map((h, i) => (
                <Card key={i} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, background: FRAMEWORK_COLORS[h.framework as HookFramework] + '22', color: FRAMEWORK_COLORS[h.framework as HookFramework] }}>
                      {h.framework}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.5, fontWeight: 500, color: 'var(--text-primary)' }}>{h.hook}</p>
                  {h.explanation && (
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{h.explanation}</p>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                    <Button variant="ghost" size="sm" onClick={() => copyText(h.hook)}>
                      <Copy size={13} /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { controller.saveHookAsIdea(h.hook, platform); toast.success('Saved to Ideas!') }}>
                      <Bookmark size={13} /> Save
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => createFullPost(h.hook)} disabled={postLoadingHook !== null} style={{ flex: 1 }}>
                      {postLoadingHook === h.hook ? <RefreshCw size={13} className="spin" /> : <FileText size={13} />} Create full post
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  )
}
