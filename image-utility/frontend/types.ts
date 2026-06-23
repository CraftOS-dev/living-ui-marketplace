export interface ImageAsset {
  id: number
  filename: string
  file_size: number
  format: string
  width: number
  height: number
  last_output: OutputMeta | null
  uploaded_at: string
}

export interface OutputMeta {
  path: string
  filename: string
  size: number
  format: string
  width: number
  height: number
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ResizeSpec {
  width?: number
  height?: number
  maintain_aspect: boolean
}

export type OutputFormat = 'PNG' | 'JPEG' | 'WEBP'

export interface TransformSpec {
  crop?: CropRect
  resize?: ResizeSpec
  format: OutputFormat
  quality: number
}

export interface TransformResult {
  image_id: number
  output: OutputMeta
  percent_smaller: number
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
