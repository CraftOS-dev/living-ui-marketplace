import { useState, useEffect, useCallback } from 'react'
import { LayoutDashboard, Youtube, MessageCircle, Twitter, BookOpen } from 'lucide-react'
import type { AppController } from '../AppController'
import type { AppState, IntegrationStatus, YouTubeChannel, YouTubeVideo } from '../types'
import { DashboardView } from './dashboard/DashboardView'
import { YouTubeView } from './youtube/YouTubeView'
import type { ReactNode } from 'react'

type Tab = 'dashboard' | 'youtube' | 'discord' | 'twitter' | 'notion'

interface MainViewProps {
  controller: AppController
}

const TABS: { key: Tab; label: string; icon: ReactNode; phase?: number }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { key: 'youtube', label: 'YouTube', icon: <Youtube size={16} /> },
  { key: 'discord', label: 'Discord', icon: <MessageCircle size={16} />, phase: 2 },
  { key: 'twitter', label: 'Twitter', icon: <Twitter size={16} />, phase: 3 },
  { key: 'notion', label: 'Notion', icon: <BookOpen size={16} />, phase: 4 },
]

export function MainView({ controller }: MainViewProps) {
  const [state, setState] = useState<AppState>(controller.getState())
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>({ bridgeAvailable: false, integrations: [] })
  const [channels, setChannels] = useState<YouTubeChannel[]>([])
  const [videos, setVideos] = useState<YouTubeVideo[]>([])

  useEffect(() => controller.subscribe(setState), [controller])

  const loadData = useCallback(async () => {
    const [status, ch, vid] = await Promise.all([
      controller.getIntegrationStatus(),
      controller.getYouTubeChannels(),
      controller.getYouTubeVideos(),
    ])
    setIntegrationStatus(status)
    setChannels(ch)
    setVideos(vid)
  }, [controller])

  useEffect(() => {
    if (state.initialized) loadData()
  }, [state.initialized, loadData])

  const isConnected = (platformId: string) =>
    integrationStatus.integrations.find(i => i.id === platformId)?.connected ?? false

  if (state.loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>Loading...</div>
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, flexShrink: 0, borderRight: '1px solid var(--border-primary)',
        background: 'var(--bg-secondary)', padding: 'var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
      }}>
        <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', margin: '0 0 var(--space-4) 0', padding: '0 var(--space-2)' }}>
          Creator Hub
        </h1>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => !tab.phase && setActiveTab(tab.key)} style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            background: activeTab === tab.key ? 'var(--color-primary-subtle)' : 'transparent',
            border: 'none', borderRadius: 'var(--radius-md)',
            color: tab.phase ? 'var(--text-muted)' : activeTab === tab.key ? 'var(--color-primary)' : 'var(--text-primary)',
            fontWeight: activeTab === tab.key ? 'var(--font-semibold)' : 'var(--font-normal)',
            fontSize: 'var(--text-sm)', cursor: tab.phase ? 'default' : 'pointer', fontFamily: 'inherit', textAlign: 'left',
            opacity: tab.phase ? 0.5 : 1,
          }}>
            {tab.icon}
            <span>{tab.label}</span>
            {tab.phase && <span style={{ fontSize: 'var(--text-xs)', marginLeft: 'auto' }}>Soon</span>}
          </button>
        ))}
      </aside>

      {/* Content */}
      <main style={{ flex: 1, padding: 'var(--space-6)', overflow: 'auto' }}>
        {activeTab === 'dashboard' && (
          <DashboardView
            integrationStatus={integrationStatus}
            channels={channels}
            videos={videos}
            onViewYouTube={() => setActiveTab('youtube')}
          />
        )}

        {activeTab === 'youtube' && (
          <YouTubeView
            controller={controller}
            channels={channels}
            videos={videos}
            isConnected={isConnected('google_workspace')}
            onDataChange={loadData}
          />
        )}
      </main>
    </div>
  )
}
