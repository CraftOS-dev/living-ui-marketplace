import { useState, useEffect } from 'react'
import { Download, Lock, Unlock } from 'lucide-react'
import { Button, Input, Select } from './ui'
import { ApiService } from '../services/ApiService'
import type { AppController } from '../AppController'
import type { AppControllerState } from '../AppController'
import type { CropRect, ImageAsset, OutputFormat, TransformSpec } from '../types'
import { formatBytes } from '../types'

type CompressionPreset = 'smallest' | 'balanced' | 'best'

const COMPRESSION_OPTIONS: {
  value: CompressionPreset
  label: string
  quality: number
}[] = [
  { value: 'smallest', label: 'Smallest file — heavy compression', quality: 55 },
  { value: 'balanced', label: 'Balanced — recommended', quality: 80 },
  { value: 'best', label: 'Best detail — larger file', quality: 95 },
]

function qualityFromPreset(preset: CompressionPreset): number {
  return COMPRESSION_OPTIONS.find((o) => o.value === preset)?.quality ?? 80
}

interface EditPanelProps {
  asset: ImageAsset
  crop: CropRect
  controller: AppController
  state: AppControllerState
  fullCrop: boolean
}

export function EditPanel({ asset, crop, controller, state, fullCrop }: EditPanelProps) {
  const [width, setWidth] = useState(String(asset.width))
  const [height, setHeight] = useState(String(asset.height))
  const [maintainAspect, setMaintainAspect] = useState(true)
  const [format, setFormat] = useState<OutputFormat>(
    (asset.format === 'JPEG' ? 'JPEG' : asset.format === 'WEBP' ? 'WEBP' : 'PNG') as OutputFormat
  )
  const [compression, setCompression] = useState<CompressionPreset>('balanced')

  useEffect(() => {
    const w = fullCrop ? asset.width : crop.width
    const h = fullCrop ? asset.height : crop.height
    setWidth(String(Math.round(w)))
    setHeight(String(Math.round(h)))
  }, [asset.id, crop, fullCrop, asset.width, asset.height])

  const handleWidthChange = (val: string) => {
    setWidth(val)
    if (maintainAspect && val) {
      const baseW = fullCrop ? asset.width : crop.width
      const baseH = fullCrop ? asset.height : crop.height
      const num = parseInt(val, 10)
      if (!isNaN(num) && baseW > 0) {
        setHeight(String(Math.round(num * (baseH / baseW))))
      }
    }
  }

  const handleHeightChange = (val: string) => {
    setHeight(val)
    if (maintainAspect && val) {
      const baseW = fullCrop ? asset.width : crop.width
      const baseH = fullCrop ? asset.height : crop.height
      const num = parseInt(val, 10)
      if (!isNaN(num) && baseH > 0) {
        setWidth(String(Math.round(num * (baseW / baseH))))
      }
    }
  }

  const buildSpec = (): TransformSpec => {
    const spec: TransformSpec = {
      format,
      quality: qualityFromPreset(compression),
    }

    if (!fullCrop) {
      spec.crop = {
        x: Math.round(crop.x),
        y: Math.round(crop.y),
        width: Math.round(crop.width),
        height: Math.round(crop.height),
      }
    }

    const w = parseInt(width, 10)
    const h = parseInt(height, 10)
    const baseW = fullCrop ? asset.width : crop.width
    const baseH = fullCrop ? asset.height : crop.height

    if ((!isNaN(w) && w !== Math.round(baseW)) || (!isNaN(h) && h !== Math.round(baseH))) {
      spec.resize = {
        width: !isNaN(w) ? w : undefined,
        height: !isNaN(h) ? h : undefined,
        maintain_aspect: maintainAspect,
      }
    }

    return spec
  }

  const handleApply = async () => {
    await controller.transform(asset.id, buildSpec())
  }

  const result = state.lastResult

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        width: '100%',
        maxWidth: 360,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 'var(--font-size-base)',
          fontWeight: 'var(--font-weight-semibold)' as any,
          color: 'var(--text-primary)',
        }}
      >
        Edit
      </h3>

      {!fullCrop && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          Crop: {Math.round(crop.width)} × {Math.round(crop.height)} px
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <Input
          label="Width"
          type="number"
          min={1}
          value={width}
          onChange={(e) => handleWidthChange(e.target.value)}
          style={{ flex: 1 }}
        />
        <Input
          label="Height"
          type="number"
          min={1}
          value={height}
          onChange={(e) => handleHeightChange(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMaintainAspect(!maintainAspect)}
          title={maintainAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
          style={{ minWidth: 36, minHeight: 36, padding: 0 }}
        >
          {maintainAspect ? <Lock size={16} /> : <Unlock size={16} />}
        </Button>
      </div>

      <Select
        label="Format"
        value={format}
        onChange={(e) => setFormat(e.target.value as OutputFormat)}
        options={[
          { value: 'PNG', label: 'PNG — lossless, no compression slider' },
          { value: 'JPEG', label: 'JPEG — best for photos & small downloads' },
          { value: 'WEBP', label: 'WEBP — modern, good size/quality balance' },
        ]}
      />

      {(format === 'JPEG' || format === 'WEBP') && (
        <div>
          <Select
            label="File size"
            value={compression}
            onChange={(e) => setCompression(e.target.value as CompressionPreset)}
            options={COMPRESSION_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
          <p
            style={{
              margin: 'var(--space-1) 0 0',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
            }}
          >
            {compression === 'smallest' &&
              'Prioritizes a tiny download. Fine for previews and thumbnails.'}
            {compression === 'balanced' &&
              'Default pick — smaller than the original without obvious artifacts.'}
            {compression === 'best' &&
              'Keeps more detail. Use when you need a clean final asset.'}
          </p>
        </div>
      )}

      <Button
        variant="primary"
        fullWidth
        loading={state.processing}
        onClick={handleApply}
      >
        Apply
      </Button>

      {result && result.image_id === asset.id && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
            {result.output.width} × {result.output.height} · {formatBytes(result.output.size)}
            {result.percent_smaller > 0 && (
              <span style={{ color: 'var(--color-success)' }}>
                {' '}
                ({result.percent_smaller}% smaller)
              </span>
            )}
          </p>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            style={{ marginTop: 'var(--space-2)' }}
            onClick={() => window.open(ApiService.getDownloadUrl(asset.id), '_blank')}
          >
            <Download size={16} />
            Download
          </Button>
        </div>
      )}
    </div>
  )
}
