import { useState, useEffect, useCallback } from 'react'
import { Image, Upload, Menu } from 'lucide-react'
import { toast } from 'react-toastify'
import { useAgentAware } from '../agent/hooks'
import { AppController } from '../AppController'
import type { AppControllerState } from '../AppController'
import { ApiService } from '../services/ApiService'
import type { CropRect, ImageAsset } from '../types'
import { AssetList } from './AssetList'
import { DropZone } from './DropZone'
import { ImageCanvas } from './ImageCanvas'
import { EditPanel } from './EditPanel'
import { Button } from './ui'

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

function fullCropFor(asset: ImageAsset): CropRect {
  return { x: 0, y: 0, width: asset.width, height: asset.height }
}

function isFullCrop(crop: CropRect, asset: ImageAsset): boolean {
  return (
    crop.x === 0 &&
    crop.y === 0 &&
    Math.abs(crop.width - asset.width) < 2 &&
    Math.abs(crop.height - asset.height) < 2
  )
}

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  useAgentAware('MainView', {
    activeId: controller.getState().activeId,
    assetCount: controller.getState().assets.length,
  })

  const [state, setState] = useState<AppControllerState>(controller.getState())
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    return controller.subscribe(() => setState(controller.getState()))
  }, [controller])

  useEffect(() => {
    if (isMobile) setSidebarOpen(false)
  }, [isMobile])

  const active = controller.getActiveAsset()
  const activeId = state.activeId

  useEffect(() => {
    if (!activeId) {
      setCrop(null)
      return
    }
    const asset = controller.getActiveAsset()
    if (asset) {
      setCrop(fullCropFor(asset))
      controller.clearResult()
    }
  }, [activeId, controller])

  useEffect(() => {
    if (state.lastResult && active && state.lastResult.image_id === active.id) {
      toast.success('Image processed')
    }
  }, [state.lastResult, active])

  const handleUpload = useCallback(
    async (file: File) => {
      const asset = await controller.uploadImage(file)
      if (asset) {
        toast.success(`Uploaded "${asset.filename}"`)
        setShowUpload(false)
      } else {
        toast.error(controller.getState().error || 'Upload failed')
        controller.clearError()
      }
    },
    [controller]
  )

  const handleDelete = useCallback(
    async (id: number) => {
      const name = state.assets.find((a) => a.id === id)?.filename
      const ok = await controller.deleteImage(id)
      if (ok) {
        toast.success(`Deleted "${name || 'image'}"`)
      } else {
        toast.error(controller.getState().error || 'Delete failed')
        controller.clearError()
      }
    },
    [controller, state.assets]
  )

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
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
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
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 9,
          }}
        />
      )}

      <aside
        style={{
          width: isMobile ? 260 : sidebarOpen ? 260 : 0,
          flexShrink: 0,
          borderRight: sidebarOpen ? '1px solid var(--border-primary)' : 'none',
          backgroundColor: 'var(--bg-secondary)',
          overflow: 'hidden',
          transition: 'width 0.2s ease',
          ...(isMobile
            ? {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                zIndex: 10,
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                width: 260,
              }
            : {}),
        }}
      >
        <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border-primary)' }}>
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--text-secondary)' }}>
            Images
          </span>
        </div>
        <AssetList
          assets={state.assets}
          activeId={state.activeId}
          onSelect={(id) => {
            controller.setActive(id)
            if (isMobile) setSidebarOpen(false)
          }}
          onDelete={handleDelete}
        />
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: 'var(--space-1)',
              display: 'flex',
              minWidth: 36,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Menu size={20} />
          </button>
          <Image size={22} style={{ color: 'var(--color-primary)' }} />
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-bold)' as any,
              color: 'var(--text-primary)',
            }}
          >
            Image Utility
          </h1>
          {active && (
            <div style={{ marginLeft: 'auto' }}>
              <Button variant="ghost" size="sm" onClick={() => setShowUpload(!showUpload)}>
                <Upload size={16} />
                Upload
              </Button>
            </div>
          )}
        </header>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: isMobile ? 'var(--space-3)' : 'var(--space-6)',
          }}
        >
          {!active ? (
            <div style={{ maxWidth: 560, margin: '0 auto', paddingTop: 'var(--space-8)' }}>
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 'var(--font-size-xl)',
                    fontWeight: 'var(--font-weight-semibold)' as any,
                  }}
                >
                  Upload an image to get started
                </h2>
                <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-secondary)' }}>
                  Crop, resize, compress, or convert — then download.
                </p>
              </div>
              <DropZone onFileSelect={handleUpload} uploading={state.uploading} />
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 'var(--font-size-lg)',
                    fontWeight: 'var(--font-weight-semibold)' as any,
                  }}
                >
                  {active.filename}
                </h2>
                <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  {active.width} × {active.height} · {active.format}
                </p>
              </div>

              {showUpload && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <DropZone onFileSelect={handleUpload} uploading={state.uploading} />
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: 'var(--space-4)',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
                  {crop && (
                    <ImageCanvas
                      previewUrl={ApiService.getPreviewUrl(active.id)}
                      naturalWidth={active.width}
                      naturalHeight={active.height}
                      crop={crop}
                      onCropChange={setCrop}
                    />
                  )}
                </div>

                {crop && (
                  <EditPanel
                    asset={active}
                    crop={crop}
                    controller={controller}
                    state={state}
                    fullCrop={isFullCrop(crop, active)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
