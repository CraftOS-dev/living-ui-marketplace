export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  [key: string]: unknown
}

export interface FileItem {
  name: string
  path: string
  is_dir: boolean
  is_markdown: boolean
  modified: number
}

export interface OpenTab {
  path: string
  content: string
  savedContent: string
}

export interface EditorSession {
  openTabs: OpenTab[]
  activeTab: string | null
  folderPanelWidth: number
  previewPanelWidth: number
  folderVisible: boolean
  previewVisible: boolean
  expandedDirs: string[]
}
