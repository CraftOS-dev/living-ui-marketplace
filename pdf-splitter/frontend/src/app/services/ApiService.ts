/**
 * ApiService - Backend API client for PDF Splitter
 *
 * Provides methods to communicate with the FastAPI backend.
 * All state is stored in the backend, making it persistent across
 * page reloads and tab switches.
 */

import type { PDFDocument, SplitJob } from '../types'

// Backend URL — detected from manifest at runtime, falls back to creation-time port
const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

export interface ActionRequest {
  action: string
  payload?: Record<string, unknown>
}

export interface ActionResponse {
  status: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

class ApiServiceClass {
  private baseUrl: string

  constructor() {
    this.baseUrl = BACKEND_URL
  }

  /**
   * Check if the backend is healthy/available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      return response.ok
    } catch {
      return false
    }
  }

  // ============================================================================
  // State Management
  // ============================================================================

  async getState<T = Record<string, unknown>>(): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/state`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to get state: ${response.statusText}`)
    }
    return response.json()
  }

  async updateState<T = Record<string, unknown>>(
    updates: Partial<T>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: updates }),
    })
    if (!response.ok) {
      throw new Error(`Failed to update state: ${response.statusText}`)
    }
    return response.json()
  }

  async replaceState<T = Record<string, unknown>>(state: T): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/state/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: state }),
    })
    if (!response.ok) {
      throw new Error(`Failed to replace state: ${response.statusText}`)
    }
    return response.json()
  }

  async clearState(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/state`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to clear state: ${response.statusText}`)
    }
  }

  // ============================================================================
  // Actions
  // ============================================================================

  async executeAction(
    action: string,
    payload?: Record<string, unknown>
  ): Promise<ActionResponse> {
    const response = await fetch(`${this.baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    })
    if (!response.ok) {
      throw new Error(`Failed to execute action: ${response.statusText}`)
    }
    return response.json()
  }

  // ============================================================================
  // PDF Documents
  // ============================================================================

  /**
   * Upload a PDF file
   */
  async uploadPdf(file: File): Promise<PDFDocument> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseUrl}/api/pdfs/upload`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(err.detail || 'Upload failed')
    }
    return response.json()
  }

  /**
   * List all uploaded PDFs
   */
  async listPdfs(): Promise<PDFDocument[]> {
    const response = await fetch(`${this.baseUrl}/api/pdfs`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to list PDFs: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Get a specific PDF document by ID
   */
  async getPdf(id: number): Promise<PDFDocument> {
    const response = await fetch(`${this.baseUrl}/api/pdfs/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to get PDF: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Delete a PDF document
   */
  async deletePdf(id: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pdfs/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to delete PDF: ${response.statusText}`)
    }
  }

  // ============================================================================
  // Thumbnails
  // ============================================================================

  /**
   * Get thumbnail URL for a specific page
   */
  getThumbnailUrl(docId: number, pageNum: number): string {
    return `${this.baseUrl}/api/pdfs/${docId}/thumbnails/${pageNum}`
  }

  /**
   * Get list of all thumbnail URLs for a document
   */
  async getThumbnailList(docId: number): Promise<{ page: number; url: string }[]> {
    const response = await fetch(`${this.baseUrl}/api/pdfs/${docId}/thumbnails`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to get thumbnails: ${response.statusText}`)
    }
    return response.json()
  }

  // ============================================================================
  // Split Operations
  // ============================================================================

  /**
   * Split a PDF document
   * @param docId - PDF document ID
   * @param splitType - 'pages' | 'ranges' | 'every_n'
   * @param config - Split configuration
   *   pages: { pages: number[] }
   *   ranges: { ranges: [number, number][] }
   *   every_n: { n: number }
   */
  async splitPdf(
    docId: number,
    splitType: 'pages' | 'ranges' | 'every_n',
    config: Record<string, any>
  ): Promise<SplitJob> {
    const response = await fetch(`${this.baseUrl}/api/pdfs/${docId}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ split_type: splitType, ...config }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(err.detail || 'Split failed')
    }
    return response.json()
  }

  /**
   * List all split jobs
   */
  async listSplits(): Promise<SplitJob[]> {
    const response = await fetch(`${this.baseUrl}/api/splits`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to list splits: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * List split jobs for a specific document
   */
  async listDocumentSplits(docId: number): Promise<SplitJob[]> {
    const response = await fetch(`${this.baseUrl}/api/pdfs/${docId}/splits`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to list document splits: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Get download URL for a specific split file
   */
  getDownloadUrl(splitId: number, fileIndex: number): string {
    return `${this.baseUrl}/api/splits/${splitId}/download/${fileIndex}`
  }

  /**
   * Get ZIP download URL for all files in a split job
   */
  getZipDownloadUrl(splitId: number): string {
    return `${this.baseUrl}/api/splits/${splitId}/download-zip`
  }

  /**
   * Get the backend base URL (for constructing custom URLs)
   */
  getBaseUrl(): string {
    return this.baseUrl
  }
}

// Export singleton instance
export const ApiService = new ApiServiceClass()
