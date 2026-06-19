import { useState, useRef } from 'react'
import { Bird, Linkedin, Youtube, Image, Sparkles, Send, Clock, X, Zap, Wand2 } from 'lucide-react'
import { Button, Textarea } from './ui'
import { PlatformPreview } from './PlatformPreview'
import { AiCaptionModal } from './AiCaptionModal'
import type { AppController } from '../AppController'
import type { AppState, Platform, PostCreateInput } from '../types'
import { toast } from 'react-toastify'

interface ComposerViewProps {
  controller: AppController
  state: AppState
}

const PLATFORMS: { id: Platform; label: string; icon: React.ReactNode; limit: number }[] = [
  { id: 'twitter', label: 'Twitter/X', icon: <Bird size={14} />, limit: 280 },
  { id: 'linkedin', label: 'LinkedIn', icon: <Linkedin size={14} />, limit: 3000 },
  { id: 'google_youtube', label: 'YouTube', icon: <Youtube size={14} />, limit: 10000 },
]

export function ComposerView({ controller, state }: ComposerViewProps) {
  const { accounts } = state
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set(['twitter']))
  const [activePlatform, setActivePlatform] = useState<Platform>('twitter')
  const [globalContent, setGlobalContent] = useState('')
  const [overrides, setOverrides] = useState<Partial<Record<Platform, string>>>({})
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const selectedList = Array.from(selectedPlatforms)

  const getContent = (platform: Platform) => overrides[platform] || globalContent

  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev)
      if (next.has(platform) && next.size === 1) return prev // at least one
      if (next.has(platform)) next.delete(platform)
      else next.add(platform)
      return next
    })
    if (!selectedPlatforms.has(platform)) setActivePlatform(platform)
  }

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    const urls: string[] = []
    for (const file of Array.from(files)) {
      const url = await controller.uploadMedia(file)
      if (url) urls.push(url)
    }
    setMediaUrls((prev) => [...prev, ...urls])
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSubmit = async () => {
    if (selectedList.length === 0) return
    if (!globalContent.trim() && !selectedList.some((p) => overrides[p]?.trim())) {
      toast.error('Write some content first')
      return
    }
    if (scheduleMode === 'schedule' && !scheduledAt) {
      toast.error('Pick a schedule time')
      return
    }
    setSubmitting(true)
    let successCount = 0
    try {
      for (const platform of selectedList) {
        const extra: Record<string, unknown> = {}
        if (Object.keys(overrides).some((k) => overrides[k as Platform])) {
          extra.overrides = { ...overrides }
        }
        const payload: PostCreateInput = {
          globalContent,
          platform,
          status: scheduleMode === 'schedule' ? 'scheduled' : 'draft',
          scheduledAt: scheduleMode === 'schedule' ? scheduledAt : null,
          mediaUrls,
          extraData: extra,
        }
        let result: any
        if (scheduleMode === 'now') {
          const post = await controller.createPost(payload)
          if (post) {
            result = await controller.publishNow(post.id)
          }
          if (result && result.status === 'ok') successCount++
        } else {
          result = await controller.createPost(payload)
          if (result) successCount++
        }
      }
      if (successCount === selectedList.length) {
        toast.success(scheduleMode === 'now' ? 'Posts published!' : 'Posts scheduled!')
        setGlobalContent('')
        setOverrides({})
        setMediaUrls([])
        setScheduledAt('')
      } else {
        toast.warning(`${successCount}/${selectedList.length} posts succeeded`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleAiInsert = (text: string) => {
    setOverrides((prev) => ({ ...prev, [activePlatform]: text }))
  }

  const activePlatformData = PLATFORMS.find((p) => p.id === activePlatform)!
  const activeContent = getContent(activePlatform)
  const charCount = activeContent.length
  const overLimit = charCount > activePlatformData.limit

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left pane — compose */}
      <div
        style={{
          flex: '0 0 480px',
          minWidth: 320,
          padding: 'var(--space-6)',
          overflowY: 'auto',
          borderRight: '1px solid var(--border-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
          Compose
        </h2>

        {/* Platform selection */}
        <div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', fontWeight: 'var(--font-weight-semibold)' as any, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Post to
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {PLATFORMS.map(({ id, label, icon }) => {
              const selected = selectedPlatforms.has(id)
              return (
                <button
                  key={id}
                  onClick={() => togglePlatform(id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--border-primary)'}`,
                    backgroundColor: selected ? 'var(--color-primary-light)' : 'transparent',
                    color: selected ? 'var(--color-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: selected ? ('var(--font-weight-medium)' as any) : 'normal',
                    transition: 'var(--transition-fast)',
                  }}
                >
                  {icon} {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Platform tabs when multiple selected */}
        {selectedList.length > 1 && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)', gap: 'var(--space-1)' }}>
            {selectedList.map((platform) => {
              const p = PLATFORMS.find((x) => x.id === platform)!
              const isActive = activePlatform === platform
              return (
                <button
                  key={platform}
                  onClick={() => setActivePlatform(platform)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    padding: 'var(--space-2) var(--space-3)',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                    backgroundColor: 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    marginBottom: -1,
                  }}
                >
                  {p.icon} {p.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Global text area */}
        <div>
          <Textarea
            label="Content"
            placeholder="What do you want to say?"
            value={globalContent}
            onChange={(e) => setGlobalContent(e.target.value)}
            rows={5}
          />
        </div>

        {/* Per-platform override */}
        <div
          style={{
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => {}}
            style={{
              width: '100%',
              padding: 'var(--space-2) var(--space-3)',
              backgroundColor: 'var(--bg-tertiary)',
              border: 'none',
              cursor: 'default',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Customize for {PLATFORMS.find((p) => p.id === activePlatform)?.label}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              {overrides[activePlatform] ? 'Override active' : 'Using global content'}
            </span>
          </button>
          <div style={{ padding: 'var(--space-3)' }}>
            <Textarea
              placeholder={`Override text for ${PLATFORMS.find((p) => p.id === activePlatform)?.label} only. Leave blank to use global content.`}
              value={overrides[activePlatform] || ''}
              onChange={(e) => setOverrides((prev) => ({ ...prev, [activePlatform]: e.target.value }))}
              rows={3}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-1)' }}>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: overLimit ? 'var(--color-error)' : 'var(--text-muted)',
                }}
              >
                {charCount} / {activePlatformData.limit}
                {overLimit && ' — over limit!'}
              </span>
              {overrides[activePlatform] && (
                <button
                  onClick={() => setOverrides((prev) => { const n = {...prev}; delete n[activePlatform]; return n })}
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Clear override
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Media upload */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleMediaUpload}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<Image size={14} />}
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Uploading…' : 'Add Media'}
          </Button>
          {mediaUrls.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
              {mediaUrls.map((url, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img
                    src={url}
                    alt=""
                    style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <button
                    onClick={() => setMediaUrls((prev) => prev.filter((_, j) => j !== i))}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-error)',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Schedule section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(['now', 'schedule'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setScheduleMode(mode)}
                style={{
                  flex: 1,
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${scheduleMode === mode ? 'var(--color-primary)' : 'var(--border-primary)'}`,
                  backgroundColor: scheduleMode === mode ? 'var(--color-primary-light)' : 'transparent',
                  color: scheduleMode === mode ? 'var(--color-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                {mode === 'now' ? <><Send size={12} /> Post Now</> : <><Clock size={12} /> Schedule</>}
              </button>
            ))}
          </div>
          {scheduleMode === 'schedule' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              style={{
                width: '100%',
                padding: 'var(--space-2) var(--space-3)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
              }}
            />
          )}
        </div>

        {/* AI shortcuts */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', alignSelf: 'center' }}>AI:</span>
          <Button variant="ghost" size="sm" onClick={() => controller.setPrefilledTool('hooks', globalContent, activePlatform)}>
            <Zap size={13} /> Hooks
          </Button>
          <Button variant="ghost" size="sm" onClick={() => controller.setPrefilledTool('humanizer', globalContent, activePlatform)}>
            <Wand2 size={13} /> Humanize
          </Button>
        </div>

        {/* AI Assist + Submit row */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            variant="secondary"
            icon={<Sparkles size={14} />}
            onClick={() => setAiModalOpen(true)}
          >
            AI Assist
          </Button>
          <Button
            variant="primary"
            fullWidth
            loading={submitting}
            onClick={handleSubmit}
            icon={scheduleMode === 'now' ? <Send size={14} /> : <Clock size={14} />}
          >
            {scheduleMode === 'now' ? 'Publish' : 'Schedule'}
          </Button>
        </div>
      </div>

      {/* Right pane — previews */}
      <div
        style={{
          flex: 1,
          padding: 'var(--space-6)',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', fontWeight: 'normal' as any }}>
          Preview
        </h3>
        {selectedList.map((platform) => {
          const account = accounts.find((a) => a.platform === platform) || null
          return (
            <PlatformPreview
              key={platform}
              platform={platform}
              content={getContent(platform)}
              account={account}
            />
          )
        })}
      </div>

      <AiCaptionModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        platform={activePlatform}
        controller={controller}
        onInsert={handleAiInsert}
      />
    </div>
  )
}
