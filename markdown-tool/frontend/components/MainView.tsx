import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'react-toastify'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { FolderPanel } from './FolderPanel'
import { TabBar } from './TabBar'
import { EditorPanel } from './EditorPanel'
import { PreviewPanel } from './PreviewPanel'
import { PanelDivider } from './PanelDivider'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { OpenTab } from '../types'

const MIN_FOLDER_W = 160
const MAX_FOLDER_W = 500
const MIN_PREVIEW_W = 180
const MAX_PREVIEW_W = 700

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  useAgentAware('MainView', { currentSection: 'editor' })

  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [folderWidth, setFolderWidth] = useState(240)
  const [previewWidth, setPreviewWidth] = useState(380)
  const [folderVisible, setFolderVisible] = useState(true)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSave = useCallback(
    (patch: Parameters<AppController['saveSession']>[0]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try { await controller.saveSession(patch) } catch { /* ignore */ }
      }, 500)
    },
    [controller],
  )

  // Restore session on mount
  useEffect(() => {
    async function restore() {
      try {
        const session = await controller.getSession()
        setFolderWidth(clamp(session.folderPanelWidth || 240, MIN_FOLDER_W, MAX_FOLDER_W))
        setPreviewWidth(clamp(session.previewPanelWidth || 380, MIN_PREVIEW_W, MAX_PREVIEW_W))
        setFolderVisible(session.folderVisible ?? true)
        setPreviewVisible(session.previewVisible ?? true)

        const restored: OpenTab[] = []
        for (const tab of session.openTabs || []) {
          try {
            const res = await controller.readFile(tab.path)
            restored.push({ path: tab.path, content: res.content, savedContent: res.content })
          } catch { /* file may have been deleted */ }
        }
        setTabs(restored)
        const activeExists = restored.some(t => t.path === session.activeTab)
        setActiveTab(activeExists ? session.activeTab : (restored[0]?.path ?? null))
      } catch { /* no session yet */ }
      setSessionLoaded(true)
    }
    restore()
  }, [controller])

  // Persist panel widths after resize (debounced)
  useEffect(() => {
    if (!sessionLoaded) return
    const t = setTimeout(() => {
      controller.saveSession({ folderPanelWidth: folderWidth, previewPanelWidth: previewWidth })
    }, 600)
    return () => clearTimeout(t)
  }, [folderWidth, previewWidth, sessionLoaded, controller])

  async function openFile(path: string) {
    const existing = tabs.find(t => t.path === path)
    if (existing) {
      setActiveTab(path)
      debouncedSave({ activeTab: path })
      return
    }
    try {
      const res = await controller.readFile(path)
      const newTab: OpenTab = { path, content: res.content, savedContent: res.content }
      setTabs(prev => {
        const next = [...prev, newTab]
        debouncedSave({
          openTabs: next.map(t => ({ path: t.path, savedContent: t.savedContent })) as any,
          activeTab: path,
        })
        return next
      })
      setActiveTab(path)
    } catch {
      toast.error(`Failed to open ${path}`)
    }
  }

  function switchTab(path: string) {
    setActiveTab(path)
    debouncedSave({ activeTab: path })
  }

  function closeTab(path: string) {
    setTabs(prev => {
      const next = prev.filter(t => t.path !== path)
      let newActive = activeTab
      if (activeTab === path) {
        const idx = prev.findIndex(t => t.path === path)
        newActive = next[Math.min(idx, next.length - 1)]?.path ?? null
      }
      setActiveTab(newActive)
      debouncedSave({
        openTabs: next.map(t => ({ path: t.path, savedContent: t.savedContent })) as any,
        activeTab: newActive,
      })
      return next
    })
  }

  function handleEditorChange(content: string) {
    if (!activeTab) return
    setTabs(prev => prev.map(t => t.path === activeTab ? { ...t, content } : t))
  }

  async function handleSave() {
    if (!activeTab) return
    const tab = tabs.find(t => t.path === activeTab)
    if (!tab) return
    try {
      await controller.writeFile(activeTab, tab.content)
      setTabs(prev => {
        const next = prev.map(t => t.path === activeTab ? { ...t, savedContent: t.content } : t)
        debouncedSave({
          openTabs: next.map(t => ({ path: t.path, savedContent: t.savedContent })) as any,
        })
        return next
      })
      toast.success('Saved')
    } catch {
      toast.error('Failed to save')
    }
  }

  const activeTabData = tabs.find(t => t.path === activeTab) ?? null

  if (!sessionLoaded) {
    return (
      <div className="workspace-loading">
        <span>Loading…</span>
        <style>{`.workspace-loading { display:flex;align-items:center;justify-content:center;height:100vh;color:var(--text-muted); }`}</style>
      </div>
    )
  }

  return (
    <div className="workspace">
      {/* Toolbar strip */}
      <div className="workspace-toolbar">
        <button
          className={`wt-btn ${folderVisible ? 'wt-btn-active' : ''}`}
          title={folderVisible ? 'Hide explorer' : 'Show explorer'}
          onClick={() => {
            const v = !folderVisible
            setFolderVisible(v)
            controller.saveSession({ folderVisible: v })
          }}
        >
          {folderVisible ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

        <span className="wt-title">Markdown Editor</span>

        <button
          className={`wt-btn ${previewVisible ? 'wt-btn-active' : ''}`}
          title={previewVisible ? 'Hide preview' : 'Show preview'}
          onClick={() => {
            const v = !previewVisible
            setPreviewVisible(v)
            controller.saveSession({ previewVisible: v })
          }}
        >
          {previewVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </div>

      {/* Three-panel area */}
      <div className="workspace-panels">
        {/* Folder panel */}
        {folderVisible && (
          <div className="panel panel-folder" style={{ width: folderWidth, minWidth: folderWidth, maxWidth: folderWidth }}>
            <FolderPanel
              key={folderRefreshKey}
              controller={controller}
              activeFilePath={activeTab}
              onOpenFile={openFile}
              onRefresh={() => setFolderRefreshKey(k => k + 1)}
              onFileDeleted={closeTab}
            />
          </div>
        )}

        <PanelDivider
          onDrag={dx => setFolderWidth(w => clamp(w + dx, MIN_FOLDER_W, MAX_FOLDER_W))}
          disabled={!folderVisible}
        />

        {/* Center: tabs + editor */}
        <div className="panel panel-center">
          <TabBar tabs={tabs} activeTab={activeTab} onSwitch={switchTab} onClose={closeTab} />
          <div className="panel-center-body">
            <EditorPanel
              content={activeTabData?.content ?? ''}
              onChange={handleEditorChange}
              onSave={handleSave}
              filePath={activeTab}
            />
          </div>
        </div>

        <PanelDivider
          onDrag={dx => setPreviewWidth(w => clamp(w - dx, MIN_PREVIEW_W, MAX_PREVIEW_W))}
          disabled={!previewVisible}
        />

        {/* Preview panel */}
        {previewVisible && (
          <div className="panel panel-preview" style={{ width: previewWidth, minWidth: previewWidth, maxWidth: previewWidth }}>
            <div className="preview-header">
              <span className="preview-header-label">PREVIEW</span>
            </div>
            <PreviewPanel
              content={activeTabData?.content ?? ''}
              filePath={activeTab}
            />
          </div>
        )}
      </div>

      <style>{`
        .workspace {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          background-color: var(--bg-primary);
        }

        .workspace-toolbar {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: 0 var(--space-3);
          height: 36px;
          background-color: var(--bg-secondary);
          border-bottom: 1px solid var(--border-primary);
          flex-shrink: 0;
        }

        .wt-title {
          flex: 1;
          text-align: center;
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--text-secondary);
          letter-spacing: 0.04em;
        }

        .wt-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          padding: var(--space-1);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          transition: color var(--transition-fast), background var(--transition-fast);
        }
        .wt-btn:hover { color: var(--text-primary); background-color: var(--bg-hover); }
        .wt-btn-active { color: var(--color-primary); }
        .wt-btn-active:hover { color: var(--color-primary-hover); }

        .workspace-panels {
          display: flex;
          flex: 1;
          overflow: hidden;
          min-height: 0;
        }

        .panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
        }

        .panel-folder {
          flex-shrink: 0;
          border-right: 1px solid var(--border-primary);
        }

        .panel-center {
          flex: 1;
          min-width: 0;
          background-color: var(--bg-primary);
        }

        .panel-center-body {
          flex: 1;
          display: flex;
          overflow: hidden;
          min-height: 0;
        }

        .panel-preview {
          flex-shrink: 0;
          border-left: 1px solid var(--border-primary);
          background-color: var(--bg-primary);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .preview-header {
          display: flex;
          align-items: center;
          padding: 0 var(--space-3);
          height: 34px;
          background-color: var(--bg-secondary);
          border-bottom: 1px solid var(--border-primary);
          flex-shrink: 0;
        }

        .preview-header-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          text-transform: uppercase;
        }
      `}</style>
    </div>
  )
}
