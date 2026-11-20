import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'react-toastify'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { FolderPanel } from './FolderPanel'
import { TabBar } from './TabBar'
import { EditorPanel } from './EditorPanel'
import { PreviewPanel } from './PreviewPanel'
import { PanelDivider } from './PanelDivider'
import { Modal, Input, Button } from './ui'
import { useAgentAware } from '../agent/hooks'
import { ApiError, failureMessage } from '../AppController'
import type { AppController } from '../AppController'
import type { EditorSession, OpenTab, SessionTab } from '../types'
import { isMarkdownName, pathProblem } from '../services/paths'

const MIN_FOLDER_W = 160
const MAX_FOLDER_W = 500
const MIN_PREVIEW_W = 180
const MAX_PREVIEW_W = 700

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// The session keeps each tab's path only: restore re-reads the text from the file.
function sessionTabs(tabs: OpenTab[]): SessionTab[] {
  return tabs.map(t => ({ path: t.path }))
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
  const [expandedDirs, setExpandedDirs] = useState<string[]>([])
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)
  const [saveAs, setSaveAs] = useState<{ path: string; folder: boolean } | null>(null)
  const [saveAsPath, setSaveAsPath] = useState('')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<Partial<EditorSession>>({})
  const expandedRef = useRef<string[]>([])

  // A session save that fails says so (one toast at a time), never silently.
  const saveSession = useCallback(
    async (patch: Partial<EditorSession>) => {
      try {
        await controller.saveSession(patch)
      } catch (e) {
        toast.error(failureMessage('Failed to save open tabs and layout', e), { toastId: 'session-save' })
      }
    },
    [controller],
  )

  // Patches within 500 ms are merged, so a later one never drops an earlier one's keys.
  const debouncedSave = useCallback(
    (patch: Partial<EditorSession>) => {
      pendingSave.current = { ...pendingSave.current, ...patch }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const merged = pendingSave.current
        pendingSave.current = {}
        void saveSession(merged)
      }, 500)
    },
    [saveSession],
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
        const expanded = Array.isArray(session.expandedDirs)
          ? session.expandedDirs.filter((d): d is string => typeof d === 'string')
          : []
        expandedRef.current = expanded
        setExpandedDirs(expanded)

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
      void saveSession({ folderPanelWidth: folderWidth, previewPanelWidth: previewWidth })
    }, 600)
    return () => clearTimeout(t)
  }, [folderWidth, previewWidth, sessionLoaded, saveSession])

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
          openTabs: sessionTabs(next),
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

  // Close every tab whose path `gone` matches; when the active tab closes, the
  // tab beside it becomes active.
  function closeTabs(gone: (path: string) => boolean) {
    setTabs(prev => {
      const next = prev.filter(t => !gone(t.path))
      let newActive = activeTab
      if (activeTab != null && gone(activeTab)) {
        const idx = prev.findIndex(t => t.path === activeTab)
        const closedBefore = prev.slice(0, Math.max(idx, 0)).filter(t => gone(t.path)).length
        newActive = next[Math.min(idx - closedBefore, next.length - 1)]?.path ?? null
      }
      setActiveTab(newActive)
      debouncedSave({
        openTabs: sessionTabs(next),
        activeTab: newActive,
      })
      return next
    })
  }

  function closeTab(path: string) {
    closeTabs(p => p === path)
  }

  // A deleted file's tab closes, and so do the tabs of every file inside a deleted folder.
  function handleFileDeleted(path: string) {
    closeTabs(p => p === path || p.startsWith(`${path}/`))
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
      setTabs(prev => prev.map(t => t.path === activeTab ? { ...t, savedContent: t.content } : t))
      toast.success('Saved')
    } catch (e) {
      // The file was renamed or deleted elsewhere, or a folder now has its
      // path: say so, and offer to save the text as a new file.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        setSaveAs({ path: activeTab, folder: e.status === 409 })
        setSaveAsPath(activeTab)
      } else {
        toast.error(failureMessage('Failed to save', e))
      }
    }
  }

  function closeSaveAs() {
    setSaveAs(null)
    setSaveAsPath('')
  }

  async function handleSaveAs() {
    if (!saveAs) return
    const typed = saveAsPath.trim()
    if (!typed) return
    const problem = pathProblem(typed)
    if (problem) {
      toast.error(problem)
      return
    }
    // As New File does, a name that is not .md or .markdown gets .md.
    const newPath = isMarkdownName(typed) ? typed : `${typed}.md`
    const oldPath = saveAs.path
    const tab = tabs.find(t => t.path === oldPath)
    if (!tab) {
      closeSaveAs()
      return
    }
    if (newPath !== oldPath && tabs.some(t => t.path === newPath)) {
      toast.error('That file is open in another tab')
      return
    }
    try {
      await controller.createItem(newPath, 'file', tab.content)
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 409 ? 'Already exists' : failureMessage('Failed to save', e))
      return
    }
    // The tab now belongs to the new file, and its text is saved.
    setTabs(prev => {
      const next = prev.map(t => t.path === oldPath ? { path: newPath, content: t.content, savedContent: tab.content } : t)
      debouncedSave({
        openTabs: sessionTabs(next),
        ...(activeTab === oldPath ? { activeTab: newPath } : {}),
      })
      return next
    })
    if (activeTab === oldPath) setActiveTab(newPath)
    closeSaveAs()
    toast.success(`Saved as ${newPath}`)
    refreshFolders()
  }

  // The tab of a renamed or moved file follows it, and so do the tabs of every
  // file inside a renamed folder.
  function handleFileRenamed(oldPath: string, newPath: string) {
    const moved = (p: string) =>
      p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p
    setTabs(prev => {
      const next = prev.map(t => ({ ...t, path: moved(t.path) }))
      const nextActive = activeTab == null ? null : moved(activeTab)
      debouncedSave({
        openTabs: sessionTabs(next),
        // Omit activeTab when there's no active tab (V1 sent `undefined`, which
        // JSON.stringify drops, leaving the persisted value untouched).
        ...(nextActive != null ? { activeTab: nextActive } : {}),
      })
      return next
    })
    if (activeTab != null) setActiveTab(moved(activeTab))
  }

  // The explorer reports which folders are open; the session keeps them
  // (expanded_dirs) so a reload opens them again.
  function handleExpandedChange(dirs: string[]) {
    if (dirs.join('\n') === expandedRef.current.join('\n')) return
    expandedRef.current = dirs
    setExpandedDirs(dirs)
    debouncedSave({ expandedDirs: dirs })
  }

  // After an explorer action the tree reloads with every folder collapsed.
  function refreshFolders() {
    handleExpandedChange([])
    setFolderRefreshKey(k => k + 1)
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
            void saveSession({ folderVisible: v })
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
            void saveSession({ previewVisible: v })
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
              initialExpanded={expandedDirs}
              onExpandedChange={handleExpandedChange}
              onOpenFile={openFile}
              onRefresh={refreshFolders}
              onFileDeleted={handleFileDeleted}
              onFileRenamed={handleFileRenamed}
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

      {/* Save as New File: the tab's file is gone, or a folder has its path */}
      {saveAs && (
        <Modal open onClose={closeSaveAs} title="Save as New File">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p>
              <strong>{saveAs.path}</strong>{' '}
              {saveAs.folder
                ? 'is now a folder, so the file cannot be saved there.'
                : 'no longer exists: it was renamed or deleted elsewhere.'}{' '}
              Save your text as a new file?
            </p>
            <Input
              value={saveAsPath}
              onChange={e => setSaveAsPath(e.target.value)}
              placeholder="filename.md"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveAs()}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={closeSaveAs}>Cancel</Button>
              <Button onClick={handleSaveAs}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

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
