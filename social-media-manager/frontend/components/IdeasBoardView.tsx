import { useState } from 'react'
import { Lightbulb, Plus, Trash2, Archive, ArchiveRestore, ExternalLink, Copy, Hash, X } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button, Card, Input, Textarea, Select, Badge, EmptyState, Tabs, TabList, Tab, TabPanel } from './ui'
import type { AppController } from '../AppController'
import type { AppState, Platform, Idea, HashtagSet } from '../types'

interface Props {
  controller: AppController
  state: AppState
}

const PLATFORM_OPTIONS = [
  { value: '', label: 'All platforms' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'google_youtube', label: 'YouTube' },
]

const SOURCE_BADGE: Record<string, { label: string; variant: 'default' | 'primary' | 'info' | 'success' }> = {
  manual: { label: 'Manual', variant: 'default' },
  hook_creator: { label: 'Hook Creator', variant: 'primary' },
  humanizer: { label: 'Humanizer', variant: 'info' },
}

function IdeaCard({ idea, onPromote, onArchive, onDelete }: {
  idea: Idea
  onPromote: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const src = SOURCE_BADGE[idea.source] || SOURCE_BADGE.manual
  const date = idea.createdAt ? new Date(idea.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

  return (
    <Card style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {idea.title && (
        <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {idea.title}
        </p>
      )}
      <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
        {idea.content}
      </p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge variant={src.variant} size="sm">{src.label}</Badge>
        {idea.platform && <Badge variant="default" size="sm">{idea.platform === 'google_youtube' ? 'YouTube' : idea.platform === 'twitter' ? 'Twitter/X' : 'LinkedIn'}</Badge>}
        {idea.status === 'archived' && <Badge variant="warning" size="sm">Archived</Badge>}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{date}</span>
      </div>
      {idea.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {idea.tags.map((t, i) => (
            <span key={i} style={{ fontSize: '11px', padding: '1px 7px', background: 'var(--bg-secondary)', borderRadius: '10px', color: 'var(--text-secondary)' }}>{t}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', paddingTop: '4px', borderTop: '1px solid var(--border-color)' }}>
        <Button variant="secondary" size="sm" onClick={onPromote} style={{ flex: 1 }}>
          <ExternalLink size={13} /> Use in Post
        </Button>
        <Button variant="ghost" size="sm" onClick={onArchive} title={idea.status === 'archived' ? 'Restore' : 'Archive'}>
          {idea.status === 'archived' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} title="Delete" style={{ color: 'var(--color-danger, #dc2626)' }}>
          <Trash2 size={14} />
        </Button>
      </div>
    </Card>
  )
}

function NewIdeaForm({ onSave, onCancel }: { onSave: (data: Partial<Idea> & { content: string }) => void; onCancel: () => void }) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('')
  const [tagsRaw, setTagsRaw] = useState('')

  function save() {
    if (!content.trim()) { toast.error('Content is required'); return }
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    onSave({ content: content.trim(), title: title.trim() || null, platform: (platform || null) as Platform | null, tags })
  }

  return (
    <Card style={{ padding: '16px', marginBottom: '16px', border: '2px solid var(--color-primary)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Input placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea placeholder="Your idea, hook, or caption..." value={content} onChange={e => setContent(e.target.value)} rows={3} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input placeholder="Tags (comma separated)" value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} />
          </div>
          <Select
            options={PLATFORM_OPTIONS}
            value={platform}
            onChange={e => setPlatform(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={onCancel}><X size={14} /> Cancel</Button>
          <Button size="sm" onClick={save}>Save Idea</Button>
        </div>
      </div>
    </Card>
  )
}

function HashtagSetCard({ set, onCopy, onDelete, onUpdate }: {
  set: HashtagSet
  onCopy: () => void
  onDelete: () => void
  onUpdate: (data: Partial<HashtagSet>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(set.name)
  const [tagsRaw, setTagsRaw] = useState(set.tags.join('\n'))
  const [platform, setPlatform] = useState(set.platform || '')
  const [showAll, setShowAll] = useState(false)

  const displayTags = showAll ? set.tags : set.tags.slice(0, 8)
  const hasMore = set.tags.length > 8

  function saveEdit() {
    const tags = tagsRaw.split(/[\n,\s]+/).map(t => t.trim().replace(/^#/, '')).filter(Boolean).map(t => `#${t}`)
    onUpdate({ name, platform: (platform || null) as Platform | null, tags })
    setEditing(false)
  }

  if (editing) {
    return (
      <Card style={{ padding: '16px', border: '2px solid var(--color-primary)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Input placeholder="Set name" value={name} onChange={e => setName(e.target.value)} />
          <Textarea placeholder="One hashtag per line (# optional)" value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} rows={4} />
          <Select options={PLATFORM_OPTIONS} value={platform} onChange={e => setPlatform(e.target.value)} />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X size={14} /> Cancel</Button>
            <Button size="sm" onClick={saveEdit}>Save</Button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card style={{ padding: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px' }}>{set.name}</span>
          {set.platform && (
            <Badge variant="default" size="sm">
              {set.platform === 'google_youtube' ? 'YouTube' : set.platform === 'twitter' ? 'Twitter/X' : 'LinkedIn'}
            </Badge>
          )}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Used {set.useCount}×</span>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {displayTags.map((t, i) => (
          <span key={i} style={{ fontSize: '12px', padding: '2px 8px', background: '#FF4F1811', color: 'var(--color-primary)', borderRadius: '10px', fontWeight: 500 }}>{t}</span>
        ))}
        {hasMore && !showAll && (
          <button onClick={() => setShowAll(true)} style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            +{set.tags.length - 8} more
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Button variant="secondary" size="sm" onClick={onCopy} style={{ flex: 1 }}>
          <Copy size={13} /> Copy All
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" size="sm" onClick={onDelete} style={{ color: 'var(--color-danger, #dc2626)' }}>
          <Trash2 size={14} />
        </Button>
      </div>
    </Card>
  )
}

function NewHashtagSetForm({ onSave, onCancel }: { onSave: (data: Partial<HashtagSet> & { name: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [tagsRaw, setTagsRaw] = useState('')
  const [platform, setPlatform] = useState('')

  function save() {
    if (!name.trim()) { toast.error('Name is required'); return }
    const tags = tagsRaw.split(/[\n,\s]+/).map(t => t.trim().replace(/^#/, '')).filter(Boolean).map(t => `#${t}`)
    if (tags.length === 0) { toast.error('Add at least one hashtag'); return }
    onSave({ name: name.trim(), platform: (platform || null) as Platform | null, tags })
  }

  return (
    <Card style={{ padding: '16px', marginBottom: '16px', border: '2px solid var(--color-primary)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Input placeholder="Set name (e.g. SaaS Launch)" value={name} onChange={e => setName(e.target.value)} />
        <Textarea placeholder="Hashtags, one per line or space-separated (# optional)" value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} rows={4} />
        <Select options={PLATFORM_OPTIONS} value={platform} onChange={e => setPlatform(e.target.value)} />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={onCancel}><X size={14} /> Cancel</Button>
          <Button size="sm" onClick={save}>Save Set</Button>
        </div>
      </div>
    </Card>
  )
}

export default function IdeasBoardView({ controller, state }: Props) {
  const [search, setSearch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showNewIdea, setShowNewIdea] = useState(false)
  const [showNewSet, setShowNewSet] = useState(false)

  const ideas = state.ideas.filter(idea => {
    if (idea.status === 'archived' && !showArchived) return false
    if (idea.status === 'idea' && showArchived) return false
    if (filterPlatform && idea.platform !== filterPlatform) return false
    if (search) {
      const s = search.toLowerCase()
      return idea.content.toLowerCase().includes(s) || (idea.title || '').toLowerCase().includes(s)
    }
    return true
  })

  async function handleSaveIdea(data: Partial<Idea> & { content: string }) {
    const result = await controller.createIdea(data)
    if (result) { toast.success('Idea saved!'); setShowNewIdea(false) }
    else toast.error('Failed to save idea')
  }

  async function handlePromote(id: number) {
    await controller.promoteIdea(id)
    toast.success('Draft created — opening Composer')
  }

  async function handleArchive(idea: Idea) {
    await controller.updateIdea(idea.id, { status: idea.status === 'archived' ? 'idea' : 'archived' })
  }

  async function handleDelete(id: number) {
    await controller.deleteIdea(id)
    toast.success('Deleted')
  }

  async function handleCopySet(set: HashtagSet) {
    const text = set.tags.join(' ')
    navigator.clipboard.writeText(text)
    toast.success('Hashtags copied!')
    await controller.updateHashtagSet(set.id, { incrementUseCount: true })
  }

  async function handleSaveSet(data: Partial<HashtagSet> & { name: string }) {
    const result = await controller.createHashtagSet(data)
    if (result) { toast.success('Hashtag set saved!'); setShowNewSet(false) }
    else toast.error('Failed to save set')
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <Lightbulb size={22} color="var(--color-primary)" />
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Ideas Board</h1>
      </div>

      <Tabs defaultTab="ideas">
        <TabList>
          <Tab id="ideas">Ideas ({state.ideas.filter(i => i.status === 'idea').length})</Tab>
          <Tab id="hashtags"><Hash size={14} style={{ verticalAlign: 'middle' }} /> Hashtag Library ({state.hashtagSets.length})</Tab>
        </TabList>

        <TabPanel id="ideas">
          <div>
            {/* Filter bar */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: '160px' }}>
                <Input
                  placeholder="Search ideas..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <Select
                options={PLATFORM_OPTIONS}
                value={filterPlatform}
                onChange={e => setFilterPlatform(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '4px' }}>
                {[{ v: false, l: 'Active' }, { v: true, l: 'Archived' }].map(({ v, l }) => (
                  <button key={l} onClick={() => setShowArchived(v)}
                    style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1px solid', borderColor: showArchived === v ? 'var(--color-primary)' : 'var(--border-color)', background: showArchived === v ? 'var(--color-primary)' : 'transparent', color: showArchived === v ? '#fff' : 'var(--text-secondary)' }}>
                    {l}
                  </button>
                ))}
              </div>
              <Button onClick={() => setShowNewIdea(true)} disabled={showNewIdea}>
                <Plus size={15} /> New Idea
              </Button>
            </div>

            {showNewIdea && (
              <NewIdeaForm onSave={handleSaveIdea} onCancel={() => setShowNewIdea(false)} />
            )}

            {ideas.length === 0 ? (
              <EmptyState
                icon={<Lightbulb size={36} />}
                title="Nothing here yet"
                message={search || filterPlatform ? 'Try clearing your filters.' : 'Save a hook from the Hook Creator, or tap + New Idea to capture something worth writing about.'}
                action={!showNewIdea && !search && !filterPlatform
                  ? <Button size="sm" onClick={() => setShowNewIdea(true)}>+ New Idea</Button>
                  : undefined}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {ideas.map(idea => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onPromote={() => handlePromote(idea.id)}
                    onArchive={() => handleArchive(idea)}
                    onDelete={() => handleDelete(idea.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </TabPanel>

        <TabPanel id="hashtags">
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <Button onClick={() => setShowNewSet(true)} disabled={showNewSet}>
                <Plus size={15} /> New Set
              </Button>
            </div>

            {showNewSet && (
              <NewHashtagSetForm onSave={handleSaveSet} onCancel={() => setShowNewSet(false)} />
            )}

            {state.hashtagSets.length === 0 && !showNewSet ? (
              <EmptyState
                icon={<Hash size={36} />}
                title="No hashtag sets yet"
                message="Create sets of hashtags for different topics and copy them in one click"
                action={<Button size="sm" onClick={() => setShowNewSet(true)}>Create your first set</Button>}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {state.hashtagSets.map(set => (
                  <HashtagSetCard
                    key={set.id}
                    set={set}
                    onCopy={() => handleCopySet(set)}
                    onDelete={async () => { await controller.deleteHashtagSet(set.id); toast.success('Deleted') }}
                    onUpdate={data => controller.updateHashtagSet(set.id, data)}
                  />
                ))}
              </div>
            )}
          </div>
        </TabPanel>
      </Tabs>
    </div>
  )
}
