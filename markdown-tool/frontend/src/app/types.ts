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

/** A tab as the session stores it: the path only, since the text is in the file. */
export interface SessionTab {
  path: string
}

export interface EditorSession {
  openTabs: SessionTab[]
  activeTab: string | null
  folderPanelWidth: number
  previewPanelWidth: number
  folderVisible: boolean
  previewVisible: boolean
  expandedDirs: string[]
}
