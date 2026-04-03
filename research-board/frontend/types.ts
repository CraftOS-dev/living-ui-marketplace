/**
 * Research Board - Type Definitions
 */

// Item types supported on the canvas
export type ItemType = 'image' | 'video' | 'youtube' | 'doc' | 'note'

// A board item on the canvas
export interface BoardItem {
  id: number
  type: ItemType
  title: string
  x: number
  y: number
  content?: string | null   // For notes: body text
  url?: string | null       // For URL-based items
  filePath?: string | null  // For uploaded files
  createdAt: string
  updatedAt: string
}

// Request to create a board item
export interface CreateBoardItemRequest {
  type: ItemType
  title: string
  x?: number
  y?: number
  content?: string
  url?: string
}

// Request to update a board item
export interface UpdateBoardItemRequest {
  title?: string
  x?: number
  y?: number
  content?: string
  url?: string
  file_path?: string
}

// App state
export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
}

// A connection between two board items
export interface Connection {
  id: number
  sourceId: number
  targetId: number
  createdAt: string
}

// Upload response
export interface UploadResponse {
  filePath: string
  fileName: string
  contentType: string
}
