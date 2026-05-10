import { useState, useEffect, useCallback, useRef } from 'react'
import { Scissors, Upload, Menu } from 'lucide-react'
import { toast } from 'react-toastify'
import { AppController } from '../AppController'
import type { AppControllerState } from '../AppController'
import { Sidebar } from './Sidebar'
import { DropZone } from './DropZone'
import { ThumbnailGrid } from './ThumbnailGrid'
import { SplitControls } from './SplitControls'
import { SplitHistory } from './SplitHistory'
import { Spinner, Button } from './ui'

const MOBILE_BREAKPOINT = 768

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
  )
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return isMobile
}

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [state, setState] = useState<AppControllerState>(controller.getState())
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())
  const [showUploadZone, setShowUploadZone] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const prevSplitJobRef = useRef(state.lastSplitJob)
  const isMobile = useIsMobile()

  useEffect(() => {
    return controller.subscribe(() => {
      setState(controller.getState())
    })
  }, [controller])

  // On mobile, the sidebar should default to collapsed so the main content
  // gets the full viewport width.
  useEffect(() => {
    if (isMobile && !controller.getState().sidebarCollapsed) {
      controller.toggleSidebar()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])

  // Bump history refresh key when a new split job completes
  useEffect(() => {
    if (state.lastSplitJob && state.lastSplitJob !== prevSplitJobRef.current) {
      setHistoryRefreshKey((k) => k + 1)
    }
    prevSplitJobRef.current = state.lastSplitJob
  }, [state.lastSplitJob])

  // Reset selection when active document changes
  useEffect(() => {
    setSelectedPages(new Set())
    setShowUploadZone(false)
  }, [state.activeDocumentId])

  const handleFileSelect = useCallback(
    async (file: File) => {
      const doc = await controller.uploadPdf(file)
      if (doc) {
        toast.success(`Uploaded "${doc.filename}" (${doc.page_count} pages)`)
        setShowUploadZone(false)
      } else {
        toast.error(controller.getState().error || 'Upload failed')
        controller.clearError()
      }
    },
    [controller]
  )

  const handleDeleteDocument = useCallback(
    async (id: number) => {
      const doc = state.documents.find((d) => d.id === id)
      const ok = await controller.deletePdf(id)
      if (ok) {
        toast.success(`Deleted "${doc?.filename || 'document'}"`)
      } else {
        toast.error(controller.getState().error || 'Delete failed')
        controller.clearError()
      }
    },
    [controller, state.documents]
  )

  const handleClearSelection = useCallback(() => {
    setSelectedPages(new Set())
  }, [])

  const activeDoc = controller.getActiveDocument()

  if (state.loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <Spinner size="lg" />
      </div>
    )
  }

  const sidebarOpen = !state.sidebarCollapsed
  const showSidebarOverlay = isMobile && sidebarOpen

  const handleSelectDocument = (id: number) => {
    controller.setActiveDocument(id)
    if (isMobile) controller.toggleSidebar()
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Backdrop for mobile sidebar overlay */}
      {showSidebarOverlay && (
        <div
          onClick={() => controller.toggleSidebar()}
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 9,
          }}
        />
      )}

      {/* Sidebar — fixed-overlay on mobile, inline on desktop */}
      <div
        style={
          isMobile
            ? {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                zIndex: 10,
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 0.2s ease',
                boxShadow: sidebarOpen ? 'var(--shadow-lg)' : 'none',
              }
            : { display: 'flex', height: '100%' }
        }
      >
        <Sidebar
          documents={state.documents}
          activeDocumentId={state.activeDocumentId}
          collapsed={isMobile ? false : state.sidebarCollapsed}
          onSelectDocument={handleSelectDocument}
          onDeleteDocument={handleDeleteDocument}
          onToggleCollapse={() => controller.toggleSidebar()}
        />
      </div>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        {/* Top bar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)',
            minHeight: 48,
            flexWrap: 'wrap',
          }}
        >
          {isMobile && (
            <button
              type="button"
              onClick={() => controller.toggleSidebar()}
              aria-label="Toggle sidebar"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: 'var(--space-1)',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)',
                minWidth: 36,
                minHeight: 36,
                justifyContent: 'center',
              }}
            >
              <Menu size={20} />
            </button>
          )}
          <Scissors size={22} style={{ color: 'var(--color-primary)' }} />
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-bold)' as any,
              color: 'var(--text-primary)',
            }}
          >
            PDF Splitter
          </h1>
          {activeDoc && (
            <div style={{ marginLeft: 'auto' }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUploadZone(!showUploadZone)}
              >
                <Upload size={16} />
                {isMobile ? 'Upload' : 'Upload another'}
              </Button>
            </div>
          )}
        </header>

        {/* Content area */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: isMobile ? 'var(--space-3)' : 'var(--space-6)',
          }}
        >
          {!activeDoc ? (
            // No document selected - show upload zone
            <div
              style={{
                maxWidth: 600,
                margin: '0 auto',
                paddingTop: 'var(--space-8)',
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 'var(--font-size-xl)',
                    fontWeight: 'var(--font-weight-semibold)' as any,
                    color: 'var(--text-primary)',
                  }}
                >
                  Upload a PDF to get started
                </h2>
                <p
                  style={{
                    margin: 0,
                    marginTop: 'var(--space-2)',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--font-size-base)',
                  }}
                >
                  Split your PDF into individual pages, ranges, or equal chunks.
                </p>
              </div>
              <DropZone onFileSelect={handleFileSelect} uploading={state.uploading} />
            </div>
          ) : (
            // Document selected - show thumbnails, split controls, and history
            <div>
              {/* Document header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--space-4)',
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 'var(--font-size-lg)',
                      fontWeight: 'var(--font-weight-semibold)' as any,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {activeDoc.filename}
                  </h2>
                  <p
                    style={{
                      margin: 0,
                      marginTop: 'var(--space-1)',
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    {activeDoc.page_count} pages
                  </p>
                </div>
              </div>

              {/* Inline upload zone (toggled) */}
              {showUploadZone && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <DropZone onFileSelect={handleFileSelect} uploading={state.uploading} />
                </div>
              )}

              {/* Page thumbnails grid */}
              <ThumbnailGrid
                documentId={activeDoc.id}
                pageCount={activeDoc.page_count}
                selectedPages={selectedPages}
                onSelectionChange={setSelectedPages}
              />

              {/* Split controls */}
              <SplitControls
                controller={controller}
                state={state}
                documentId={activeDoc.id}
                pageCount={activeDoc.page_count}
                selectedPages={selectedPages}
                onClearSelection={handleClearSelection}
              />

              {/* Split history */}
              <SplitHistory
                documentId={activeDoc.id}
                refreshKey={historyRefreshKey}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
