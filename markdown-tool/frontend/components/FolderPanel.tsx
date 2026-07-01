import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { toast } from 'react-toastify'
import {
  File, Folder, FolderOpen, FilePlus, FolderPlus, FileUp, FolderUp,
  Pencil, Trash2, ChevronRight, ChevronDown,
} from 'lucide-react'
import type { FileItem } from '../types'
import type { AppController } from '../AppController'
import { UploadConflictError } from '../AppController'
import { Modal, Input, Button } from './ui'

interface FileNode {
  item: FileItem
  children?: FileNode[]
  expanded?: boolean
  loading?: boolean
}

interface FolderPanelProps {
  controller: AppController
  activeFilePath: string | null
  onOpenFile: (path: string) => void
  onRefresh: () => void
  onFileDeleted: (path: string) => void
  onFileRenamed: (oldPath: string, newPath: string) => void
}

export function FolderPanel({ controller, activeFilePath, onOpenFile, onRefresh, onFileDeleted, onFileRenamed }: FolderPanelProps) {
  const [nodes, setNodes] = useState<FileNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())

  const [newItemModal, setNewItemModal] = useState<{ type: 'file' | 'directory'; parentPath: string } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [renameModal, setRenameModal] = useState<{ path: string; oldName: string } | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string } | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const draggedPath = useRef<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [uploadConflict, setUploadConflict] = useState<{
    items: { file: File; relativePath: string }[]
    conflicts: string[]
  } | null>(null)
  const [uploading, setUploading] = useState(false)

  const loadRoot = useCallback(async () => {
    setLoading(true)
    try {
      const items = await controller.listDirectory('')
      setNodes(items.map(item => ({ item })))
    } catch {
      toast.error('Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }, [controller])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  function isExpanded(nodes: FileNode[] | null, path: string): boolean {
    if (!nodes) return false
    for (const n of nodes) {
      if (n.item.path === path) return !!n.expanded
      if (n.children) { const r = isExpanded(n.children, path); if (r) return r }
    }
    return false
  }

  function setNodeState(
    nodes: FileNode[],
    path: string,
    update: Partial<Pick<FileNode, 'expanded' | 'children'>>,
  ): FileNode[] {
    return nodes.map(n => {
      if (n.item.path === path) return { ...n, ...update }
      if (n.children) return { ...n, children: setNodeState(n.children, path, update) }
      return n
    })
  }

  async function toggleDir(path: string) {
    const currentlyExpanded = isExpanded(nodes, path)

    if (currentlyExpanded) {
      setNodes(prev => prev ? setNodeState(prev, path, { expanded: false }) : prev)
      return
    }

    // Expand immediately for responsiveness, then load children
    setNodes(prev => prev ? setNodeState(prev, path, { expanded: true }) : prev)
    setLoadingPaths(s => new Set([...s, path]))
    try {
      const children = await controller.listDirectory(path)
      setNodes(prev =>
        prev ? setNodeState(prev, path, { children: children.map(item => ({ item })) }) : prev
      )
    } catch {
      toast.error('Failed to load folder')
      setNodes(prev => prev ? setNodeState(prev, path, { expanded: false }) : prev)
    } finally {
      setLoadingPaths(s => { const ns = new Set(s); ns.delete(path); return ns })
    }
  }

  async function handleCreate(type: 'file' | 'directory') {
    if (!newItemName.trim()) return
    const parentPath = newItemModal?.parentPath || ''
    const fullPath = parentPath ? `${parentPath}/${newItemName.trim()}` : newItemName.trim()
    const finalPath = type === 'file' && !fullPath.endsWith('.md') ? `${fullPath}.md` : fullPath
    try {
      await controller.createItem(finalPath, type)
      toast.success(`Created ${type === 'file' ? 'file' : 'folder'}: ${newItemName.trim()}`)
      setNewItemModal(null)
      setNewItemName('')
      await loadRoot()
      onRefresh()
    } catch (e: any) {
      toast.error(e?.message?.includes('409') ? 'Already exists' : `Failed to create ${type}`)
    }
  }

  async function handleRename() {
    if (!renameModal || !renameName.trim()) return
    const dir = renameModal.path.includes('/') ? renameModal.path.split('/').slice(0, -1).join('/') : ''
    const newPath = dir ? `${dir}/${renameName.trim()}` : renameName.trim()
    try {
      await controller.renameItem(renameModal.path, newPath)
      onFileRenamed(renameModal.path, newPath)
      toast.success('Renamed successfully')
      setRenameModal(null)
      setRenameName('')
      await loadRoot()
      onRefresh()
    } catch (e: any) {
      toast.error(e?.message?.includes('409') ? 'Name already taken' : 'Failed to rename')
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return
    const { path, name } = deleteConfirm
    try {
      await controller.deleteItem(path)
      toast.success(`Deleted ${name}`)
      setDeleteConfirm(null)
      onFileDeleted(path)
      await loadRoot()
      onRefresh()
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function performUpload(items: { file: File; relativePath: string }[], overwrite: boolean) {
    if (items.length === 0) return
    setUploading(true)
    try {
      const result = await controller.uploadFiles(items, overwrite)
      toast.success(`Uploaded ${result.written.length} file${result.written.length === 1 ? '' : 's'}`)
      setUploadConflict(null)
      await loadRoot()
      onRefresh()
    } catch (e: any) {
      if (e instanceof UploadConflictError) {
        setUploadConflict({ items, conflicts: e.conflicts })
      } else {
        toast.error('Failed to upload')
      }
    } finally {
      setUploading(false)
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    e.target.value = ''
    if (!fileList || fileList.length === 0) return
    const items = Array.from(fileList).map(file => ({ file, relativePath: file.name }))
    performUpload(items, false)
  }

  function handleFolderInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    e.target.value = ''
    if (!fileList || fileList.length === 0) return
    const items = Array.from(fileList).map(file => ({
      file,
      relativePath: (file as any).webkitRelativePath || file.name,
    }))
    performUpload(items, false)
  }

  function handleConfirmOverwrite() {
    if (!uploadConflict) return
    performUpload(uploadConflict.items, true)
  }

  async function handleDrop(e: React.DragEvent, targetFolderPath: string) {
    e.preventDefault()
    setDragOverPath(null)
    const src = draggedPath.current
    if (!src) return
    const fileName = src.split('/').pop()!
    const dst = `${targetFolderPath}/${fileName}`
    if (src === dst) return
    try {
      await controller.renameItem(src, dst)
      onFileRenamed(src, dst)
      await loadRoot()
      onRefresh()
    } catch (err: any) {
      toast.error(err?.message?.includes('409') ? 'A file with that name already exists in this folder' : 'Failed to move file')
    }
  }

  function renderNodes(nodes: FileNode[], depth = 0): ReactNode {
    return nodes.map(node => {
      const { item } = node
      const indent = depth * 14
      const isActive = item.path === activeFilePath
      const isDragOver = dragOverPath === item.path

      return (
        <div key={item.path}>
          <div
            className={`tree-item ${isActive ? 'tree-item-active' : ''} ${!item.is_dir && !item.is_markdown ? 'tree-item-muted' : ''} ${isDragOver ? 'tree-item-drag-over' : ''}`}
            style={{ paddingLeft: `${8 + indent}px` }}
            draggable={!item.is_dir}
            onClick={() => {
              if (item.is_dir) toggleDir(item.path)
              else if (item.is_markdown) onOpenFile(item.path)
            }}
            onDragStart={!item.is_dir ? () => { draggedPath.current = item.path } : undefined}
            onDragEnd={!item.is_dir ? () => { draggedPath.current = null } : undefined}
            onDragOver={item.is_dir ? e => { e.preventDefault(); setDragOverPath(item.path) } : undefined}
            onDragLeave={item.is_dir ? () => setDragOverPath(null) : undefined}
            onDrop={item.is_dir ? e => handleDrop(e, item.path) : undefined}
          >
            <span className="tree-arrow">
              {item.is_dir
                ? (node.expanded
                  ? <ChevronDown size={12} />
                  : <ChevronRight size={12} />)
                : <span style={{ width: 12, display: 'inline-block' }} />}
            </span>
            <span className="tree-icon">
              {item.is_dir
                ? (node.expanded ? <FolderOpen size={14} /> : <Folder size={14} />)
                : <File size={14} />}
            </span>
            <span className="tree-name">{item.name}</span>
            {loadingPaths.has(item.path) && <span className="tree-spinner">…</span>}

            <span className="tree-actions">
              {item.is_dir && (
                <>
                  <button
                    className="tree-action-btn"
                    title="New file here"
                    onClick={e => {
                      e.stopPropagation()
                      setNewItemModal({ type: 'file', parentPath: item.path })
                      setNewItemName('')
                    }}
                  >
                    <FilePlus size={12} />
                  </button>
                  <button
                    className="tree-action-btn"
                    title="New folder here"
                    onClick={e => {
                      e.stopPropagation()
                      setNewItemModal({ type: 'directory', parentPath: item.path })
                      setNewItemName('')
                    }}
                  >
                    <FolderPlus size={12} />
                  </button>
                </>
              )}
              <button
                className="tree-action-btn"
                title="Rename"
                onClick={e => {
                  e.stopPropagation()
                  setRenameModal({ path: item.path, oldName: item.name })
                  setRenameName(item.name)
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="tree-action-btn tree-action-delete"
                title="Delete"
                onClick={e => {
                  e.stopPropagation()
                  setDeleteConfirm({ path: item.path, name: item.name })
                }}
              >
                <Trash2 size={12} />
              </button>
            </span>
          </div>

          {item.is_dir && node.expanded && node.children && (
            <div>{renderNodes(node.children, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="folder-panel">
      <div className="folder-header">
        <span className="folder-title">EXPLORER</span>
        <div className="folder-toolbar">
          <button
            className="folder-btn"
            title="New File"
            onClick={() => { setNewItemModal({ type: 'file', parentPath: '' }); setNewItemName('') }}
          >
            <FilePlus size={14} />
          </button>
          <button
            className="folder-btn"
            title="New Folder"
            onClick={() => { setNewItemModal({ type: 'directory', parentPath: '' }); setNewItemName('') }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="folder-btn"
            title="Upload File"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={14} />
          </button>
          <button
            className="folder-btn"
            title="Upload Folder"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderUp size={14} />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderInputChange}
        {...({ webkitdirectory: '', directory: '' } as any)}
      />

      <div className="folder-tree">
        {loading ? (
          <div className="folder-loading">Loading workspace…</div>
        ) : nodes && nodes.length === 0 ? (
          <div className="folder-empty">
            <p>Workspace is empty</p>
            <Button size="sm" variant="secondary" onClick={() => setNewItemModal({ type: 'file', parentPath: '' })}>
              New File
            </Button>
          </div>
        ) : (
          nodes && renderNodes(nodes)
        )}
      </div>

      {/* New File/Folder Modal */}
      {newItemModal && (() => {
        const modal = newItemModal
        return (
          <Modal
            open
            onClose={() => { setNewItemModal(null); setNewItemName('') }}
            title={`New ${modal.type === 'file' ? 'File' : 'Folder'}`}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <Input
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                placeholder={modal.type === 'file' ? 'filename.md' : 'folder-name'}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate(modal.type)}
              />
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => { setNewItemModal(null); setNewItemName('') }}>Cancel</Button>
                <Button onClick={() => handleCreate(modal.type)}>Create</Button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Rename Modal */}
      {renameModal && (
        <Modal open onClose={() => setRenameModal(null)} title="Rename">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <Input
              value={renameName}
              onChange={e => setRenameName(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleRename()}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setRenameModal(null)}>Cancel</Button>
              <Button onClick={handleRename}>Rename</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <Modal open onClose={() => setDeleteConfirm(null)} title="Confirm Delete">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p>Delete <strong>{deleteConfirm.name}</strong>? This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleDelete}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Upload Conflict Modal */}
      {uploadConflict && (
        <Modal open onClose={() => setUploadConflict(null)} title="File(s) Already Exist">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p>
              The following file{uploadConflict.conflicts.length === 1 ? '' : 's'} already
              exist{uploadConflict.conflicts.length === 1 ? 's' : ''} in the workspace.
              Overwrite {uploadConflict.conflicts.length === 1 ? 'it' : 'them'}?
            </p>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', maxHeight: 200, overflowY: 'auto' }}>
              {uploadConflict.conflicts.map(path => (
                <li key={path} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--font-size-sm)' }}>
                  {path}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setUploadConflict(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleConfirmOverwrite} loading={uploading}>Overwrite</Button>
            </div>
          </div>
        </Modal>
      )}

      <style>{`
        .folder-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          background-color: var(--bg-secondary);
        }

        .folder-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-2) var(--space-3);
          border-bottom: 1px solid var(--border-primary);
          flex-shrink: 0;
        }

        .folder-title {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .folder-toolbar {
          display: flex;
          gap: var(--space-1);
        }

        .folder-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          padding: var(--space-1);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          transition: color var(--transition-fast), background var(--transition-fast);
        }
        .folder-btn:hover { color: var(--text-primary); background-color: var(--bg-hover); }

        .folder-tree {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: var(--space-1) 0;
        }

        .folder-loading,
        .folder-empty {
          padding: var(--space-4);
          text-align: center;
          color: var(--text-muted);
          font-size: var(--font-size-sm);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          align-items: center;
        }

        .tree-item {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          padding-right: var(--space-2);
          padding-top: 3px;
          padding-bottom: 3px;
          cursor: pointer;
          user-select: none;
          font-size: var(--font-size-sm);
          color: var(--text-primary);
          position: relative;
          min-height: 24px;
        }
        .tree-item:hover { background-color: var(--bg-hover); }
        .tree-item-active {
          background-color: var(--color-primary-light);
          color: var(--color-primary);
        }
        .tree-item-muted { color: var(--text-muted); cursor: default; }

        .tree-arrow { display: flex; align-items: center; flex-shrink: 0; color: var(--text-muted); }
        .tree-icon { display: flex; align-items: center; flex-shrink: 0; color: var(--text-secondary); }
        .tree-item-active .tree-icon { color: var(--color-primary); }

        .tree-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tree-spinner { color: var(--text-muted); font-size: 11px; margin-left: var(--space-1); }

        .tree-actions {
          display: none;
          gap: 2px;
          flex-shrink: 0;
        }
        .tree-item:hover .tree-actions { display: flex; }

        .tree-action-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          padding: 2px;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          transition: color var(--transition-fast), background var(--transition-fast);
        }
        .tree-action-btn:hover { color: var(--text-primary); background-color: var(--bg-tertiary); }
        .tree-action-delete:hover { color: var(--color-error); background-color: var(--color-error-light); }

        .tree-item-drag-over {
          background-color: var(--color-primary-light) !important;
          outline: 1px solid var(--color-primary);
          outline-offset: -1px;
        }
      `}</style>
    </div>
  )
}
