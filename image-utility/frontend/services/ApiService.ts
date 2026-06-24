import type { ImageAsset, TransformResult, TransformSpec } from '../types'

const BACKEND_URL =
  (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

class ApiServiceClass {
  private baseUrl: string

  constructor() {
    this.baseUrl = BACKEND_URL
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`)
      return response.ok
    } catch {
      return false
    }
  }

  async uploadImage(file: File): Promise<ImageAsset> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseUrl}/api/images/upload`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(err.detail || 'Upload failed')
    }
    return response.json()
  }

  async listImages(): Promise<ImageAsset[]> {
    const response = await fetch(`${this.baseUrl}/api/images`)
    if (!response.ok) {
      throw new Error(`Failed to list images: ${response.statusText}`)
    }
    return response.json()
  }

  async getImage(id: number): Promise<ImageAsset> {
    const response = await fetch(`${this.baseUrl}/api/images/${id}`)
    if (!response.ok) {
      throw new Error(`Failed to get image: ${response.statusText}`)
    }
    return response.json()
  }

  async deleteImage(id: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/images/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(`Failed to delete image: ${response.statusText}`)
    }
  }

  getPreviewUrl(id: number): string {
    return `${this.baseUrl}/api/images/${id}/preview`
  }

  async transform(id: number, spec: TransformSpec): Promise<TransformResult> {
    const response = await fetch(`${this.baseUrl}/api/images/${id}/transform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(err.detail || 'Transform failed')
    }
    return response.json()
  }

  getDownloadUrl(id: number): string {
    return `${this.baseUrl}/api/images/${id}/download`
  }

  getBaseUrl(): string {
    return this.baseUrl
  }
}

export const ApiService = new ApiServiceClass()
