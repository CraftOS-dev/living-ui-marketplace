/**
 * AppController - State management for PDF Splitter
 *
 * Manages PDF documents, upload state, active document selection,
 * split operations, and sidebar visibility. All data persisted via backend API.
 */

import { ApiService } from './services/ApiService'
import type { PDFDocument, SplitJob, SplitType } from './types'

export interface AppControllerState {
  documents: PDFDocument[]
  activeDocumentId: number | null
  sidebarCollapsed: boolean
  uploading: boolean
  loading: boolean
  splitting: boolean
  lastSplitJob: SplitJob | null
  error: string | null
}

type Listener = () => void

export class AppController {
  private state: AppControllerState = {
    documents: [],
    activeDocumentId: null,
    sidebarCollapsed: false,
    uploading: false,
    loading: true,
    splitting: false,
    lastSplitJob: null,
    error: null,
  }

  private listeners: Set<Listener> = new Set()

  constructor() {
    this.init()
  }

  // ---------------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  private async init() {
    try {
      const docs = await ApiService.listPdfs()
      this.state = { ...this.state, documents: docs, loading: false }
    } catch (err: any) {
      this.state = {
        ...this.state,
        loading: false,
        error: err.message || 'Failed to load documents',
      }
    }
    this.notify()
  }

  // ---------------------------------------------------------------------------
  // Document operations
  // ---------------------------------------------------------------------------

  async uploadPdf(file: File): Promise<PDFDocument | null> {
    this.state = { ...this.state, uploading: true, error: null }
    this.notify()

    try {
      const doc = await ApiService.uploadPdf(file)
      this.state = {
        ...this.state,
        documents: [doc, ...this.state.documents],
        activeDocumentId: doc.id,
        uploading: false,
      }
      this.notify()
      return doc
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

  async deletePdf(id: number): Promise<boolean> {
    try {
      await ApiService.deletePdf(id)
      const newDocs = this.state.documents.filter((d) => d.id !== id)
      this.state = {
        ...this.state,
        documents: newDocs,
        activeDocumentId:
          this.state.activeDocumentId === id
            ? (newDocs.length > 0 ? newDocs[0].id : null)
            : this.state.activeDocumentId,
      }
      this.notify()
      return true
    } catch (err: any) {
      this.state = { ...this.state, error: err.message || 'Delete failed' }
      this.notify()
      return false
    }
  }

  async refreshDocuments(): Promise<void> {
    try {
      const docs = await ApiService.listPdfs()
      this.state = { ...this.state, documents: docs, error: null }
    } catch (err: any) {
      this.state = { ...this.state, error: err.message || 'Refresh failed' }
    }
    this.notify()
  }

  // ---------------------------------------------------------------------------
  // Split operations
  // ---------------------------------------------------------------------------

  async splitPdf(
    docId: number,
    splitType: SplitType,
    config: Record<string, any>
  ): Promise<SplitJob | null> {
    this.state = { ...this.state, splitting: true, error: null, lastSplitJob: null }
    this.notify()

    try {
      const job = await ApiService.splitPdf(docId, splitType, config)
      this.state = {
        ...this.state,
        splitting: false,
        lastSplitJob: job,
      }
      this.notify()
      return job
    } catch (err: any) {
      this.state = {
        ...this.state,
        splitting: false,
        error: err.message || 'Split failed',
      }
      this.notify()
      return null
    }
  }

  clearLastSplitJob() {
    this.state = { ...this.state, lastSplitJob: null }
    this.notify()
  }

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------

  setActiveDocument(id: number | null) {
    this.state = { ...this.state, activeDocumentId: id, lastSplitJob: null }
    this.notify()
  }

  toggleSidebar() {
    this.state = { ...this.state, sidebarCollapsed: !this.state.sidebarCollapsed }
    this.notify()
  }

  clearError() {
    this.state = { ...this.state, error: null }
    this.notify()
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  getActiveDocument(): PDFDocument | null {
    if (!this.state.activeDocumentId) return null
    return this.state.documents.find((d) => d.id === this.state.activeDocumentId) || null
  }
}
