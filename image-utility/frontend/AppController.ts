import { ApiService } from './services/ApiService'
import type { ImageAsset, TransformResult, TransformSpec } from './types'

export interface AppControllerState {
  assets: ImageAsset[]
  activeId: number | null
  loading: boolean
  uploading: boolean
  processing: boolean
  lastResult: TransformResult | null
  error: string | null
}

type Listener = () => void

export class AppController {
  private state: AppControllerState = {
    assets: [],
    activeId: null,
    loading: true,
    uploading: false,
    processing: false,
    lastResult: null,
    error: null,
  }

  private listeners: Set<Listener> = new Set()

  constructor() {
    this.init()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach((fn) => fn())
  }

  getState(): AppControllerState {
    return { ...this.state }
  }

  private async init() {
    try {
      const assets = await ApiService.listImages()
      this.state = {
        ...this.state,
        assets,
        activeId: assets.length > 0 ? assets[0].id : null,
        loading: false,
      }
    } catch (err: any) {
      this.state = {
        ...this.state,
        loading: false,
        error: err.message || 'Failed to load images',
      }
    }
    this.notify()
  }

  async uploadImage(file: File): Promise<ImageAsset | null> {
    this.state = { ...this.state, uploading: true, error: null, lastResult: null }
    this.notify()

    try {
      const asset = await ApiService.uploadImage(file)
      this.state = {
        ...this.state,
        assets: [asset, ...this.state.assets],
        activeId: asset.id,
        uploading: false,
      }
      this.notify()
      return asset
    } catch (err: any) {
      this.state = {
        ...this.state,
        uploading: false,
        error: err.message || 'Upload failed',
      }
      this.notify()
      return null
    }
  }

  async deleteImage(id: number): Promise<boolean> {
    try {
      await ApiService.deleteImage(id)
      const assets = this.state.assets.filter((a) => a.id !== id)
      this.state = {
        ...this.state,
        assets,
        activeId:
          this.state.activeId === id
            ? assets.length > 0
              ? assets[0].id
              : null
            : this.state.activeId,
        lastResult: this.state.lastResult?.image_id === id ? null : this.state.lastResult,
      }
      this.notify()
      return true
    } catch (err: any) {
      this.state = { ...this.state, error: err.message || 'Delete failed' }
      this.notify()
      return false
    }
  }

  async refresh(): Promise<void> {
    try {
      const assets = await ApiService.listImages()
      this.state = { ...this.state, assets, error: null }
    } catch (err: any) {
      this.state = { ...this.state, error: err.message || 'Refresh failed' }
    }
    this.notify()
  }

  setActive(id: number | null) {
    this.state = { ...this.state, activeId: id, lastResult: null }
    this.notify()
  }

  async transform(id: number, spec: TransformSpec): Promise<TransformResult | null> {
    this.state = { ...this.state, processing: true, error: null, lastResult: null }
    this.notify()

    try {
      const result = await ApiService.transform(id, spec)
      const assets = this.state.assets.map((a) =>
        a.id === id ? { ...a, last_output: result.output } : a
      )
      this.state = {
        ...this.state,
        assets,
        processing: false,
        lastResult: result,
      }
      this.notify()
      return result
    } catch (err: any) {
      this.state = {
        ...this.state,
        processing: false,
        error: err.message || 'Transform failed',
      }
      this.notify()
      return null
    }
  }

  clearResult() {
    this.state = { ...this.state, lastResult: null }
    this.notify()
  }

  clearError() {
    this.state = { ...this.state, error: null }
    this.notify()
  }

  getActiveAsset(): ImageAsset | null {
    if (!this.state.activeId) return null
    return this.state.assets.find((a) => a.id === this.state.activeId) || null
  }
}
