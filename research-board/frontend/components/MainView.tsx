import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'react-toastify'
import { Button, EmptyState, Input } from './ui'
import { ItemCard } from './ItemCard'
import { AddItemModal } from './AddItemModal'
import { ItemDetailModal } from './ItemDetailModal'
import { ConnectionLines } from './ConnectionLines'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { BoardItem, Connection, CreateBoardItemRequest, UpdateBoardItemRequest, ItemType } from '../types'

interface MainViewProps {
  controller: AppController
}

const ITEM_TYPES: { type: ItemType; label: string; icon: string; color: string }[] = [
  { type: 'image', label: 'Image', icon: '🖼️', color: '#6366f1' },
  { type: 'video', label: 'Video', icon: '🎬', color: '#8b5cf6' },
  { type: 'youtube', label: 'YouTube', icon: '📺', color: '#ef4444' },
  { type: 'doc', label: 'Document', icon: '📄', color: '#06b6d4' },
  { type: 'note', label: 'Note', icon: '📝', color: '#f59e0b' },
]

export function MainView({ controller }: MainViewProps) {
  useAgentAware('MainView', { currentSection: 'canvas' })

  const [items, setItems] = useState<BoardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalType, setAddModalType] = useState<ItemType | undefined>(undefined)
  const [selectedItem, setSelectedItem] = useState<BoardItem | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<ItemType | ''>('')
  const [connections, setConnections] = useState<Connection[]>([])
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnectSource] = useState<BoardItem | null>(null)

  const loadItems = useCallback(async () => {
    try {
      const [itemData, connData] = await Promise.all([
        controller.getItems(),
        controller.getConnections(),
      ])
      setItems(itemData)
      setConnections(connData)
    } catch (err) {
      toast.error('Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [controller])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const handleAddItem = async (data: CreateBoardItemRequest) => {
    try {
      const newItem = await controller.createItem(data)
      setItems(prev => [...prev, newItem])
      toast.success(`${data.type.charAt(0).toUpperCase() + data.type.slice(1)} added to board`)
    } catch (err) {
      toast.error('Failed to add item')
      throw err
    }
  }

  const handleUpdateItem = async (id: number, data: UpdateBoardItemRequest) => {
    try {
      const updated = await controller.updateItem(id, data)
      setItems(prev => prev.map(item => item.id === id ? updated : item))
      if (selectedItem?.id === id) setSelectedItem(updated)
    } catch (err) {
      toast.error('Failed to update item')
      throw err
    }
  }

  const handleDeleteItem = async (id: number) => {
    try {
      await controller.deleteItem(id)
      setItems(prev => prev.filter(item => item.id !== id))
      setSelectedItem(null)
    } catch (err) {
      toast.error('Failed to delete item')
      throw err
    }
  }

  const handleDragEnd = async (id: number, x: number, y: number) => {
    // Adjust for canvas offset
    const adjustedX = x - canvasOffset.x
    const adjustedY = y - canvasOffset.y
    setItems(prev => prev.map(item => item.id === id ? { ...item, x: adjustedX, y: adjustedY } : item))
    try {
      await controller.updateItem(id, { x: adjustedX, y: adjustedY })
    } catch (err) {
      // Silently fail position updates
      console.error('Failed to save position:', err)
    }
  }

  const handleItemClick = async (item: BoardItem) => {
    if (connectMode) {
      if (!connectSource) {
        // First click - set source
        setConnectSource(item)
        toast.info(`Source selected: "${item.title}" - now click the target item`)
      } else if (connectSource.id === item.id) {
        // Clicked same item - cancel
        setConnectSource(null)
        toast.info('Connection cancelled')
      } else {
        // Second click - create connection
        try {
          const conn = await controller.createConnection(connectSource.id, item.id)
          setConnections(prev => {
            if (prev.find(c => c.id === conn.id)) return prev
            return [...prev, conn]
          })
          toast.success('Connection created!')
        } catch (err) {
          toast.error('Failed to create connection')
        }
        setConnectSource(null)
      }
      return
    }
    setSelectedItem(item)
    setDetailModalOpen(true)
  }

  const handleDeleteConnection = async (id: number) => {
    try {
      await controller.deleteConnection(id)
      setConnections(prev => prev.filter(c => c.id !== id))
      toast.success('Connection removed')
    } catch (err) {
      toast.error('Failed to remove connection')
    }
  }

  const handleAddButtonClick = (type?: ItemType) => {
    setAddModalType(type)
    setAddModalOpen(true)
  }

  // Canvas panning
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.item-card')) return
    setIsPanning(true)
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: canvasOffset.x,
      offsetY: canvasOffset.y,
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    setCanvasOffset({
      x: panStart.current.offsetX + dx,
      y: panStart.current.offsetY + dy,
    })
  }

  const handleCanvasMouseUp = () => {
    setIsPanning(false)
  }

  const itemCounts = ITEM_TYPES.reduce((acc, { type }) => {
    acc[type] = items.filter(i => i.type === type).length
    return acc
  }, {} as Record<string, number>)

  // Filter items based on search query and type filter
  const filteredItems = items.filter(item => {
    const matchesSearch = !searchQuery || item.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = !filterType || item.type === filterType
    return matchesSearch && matchesType
  })

  return (
    <div className="board-layout">
      {/* Sidebar */}
      <aside className="board-sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">📋 {{APP_TITLE}}</h1>
          <p className="sidebar-subtitle">Organize & Plan</p>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-section-label">ADD ITEM</p>
          <div className="sidebar-add-buttons">
            {ITEM_TYPES.map(({ type, label, icon, color }) => (
              <button
                key={type}
                className="sidebar-add-btn"
                onClick={() => handleAddButtonClick(type)}
                title={`Add ${label}`}
              >
                <span className="sidebar-btn-icon">{icon}</span>
                <span className="sidebar-btn-label">{label}</span>
                {itemCounts[type] > 0 && (
                  <span className="sidebar-btn-count" style={{ background: color }}>
                    {itemCounts[type]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-section-label">BOARD</p>
          <div className="sidebar-stats">
            <div className="stat-item">
              <span className="stat-value">{items.length}</span>
              <span className="stat-label">Total Items</span>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-section-label">CONNECTIONS</p>
          <button
            className={`sidebar-add-btn ${connectMode ? 'connect-mode-active' : ''}`}
            onClick={() => { setConnectMode(!connectMode); setConnectSource(null) }}
            style={connectMode ? { background: 'rgba(239,68,68,0.15)', borderColor: '#ef4444', color: '#ef4444' } : {}}
          >
            <span className="sidebar-btn-icon">🔗</span>
            <span className="sidebar-btn-label">{connectMode ? 'Exit Connect' : 'Connect Items'}</span>
            {connections.length > 0 && (
              <span className="sidebar-btn-count" style={{ background: '#ef4444' }}>{connections.length}</span>
            )}
          </button>
          {connectMode && (
            <p style={{ fontSize: '11px', color: '#ef4444', margin: '6px 0 0', lineHeight: 1.4 }}>
              {connectSource ? `Click target for "${connectSource.title}"` : 'Click source item'}
            </p>
          )}
        </div>

        <div className="sidebar-footer">
          <Button
            variant="primary"
            onClick={() => handleAddButtonClick()}
            style={{ width: '100%' }}
          >
            + Add Item
          </Button>
        </div>
      </aside>

      {/* Canvas Area */}
      <main className="board-canvas-container">
        {/* Search & Filter Toolbar */}
        <div className="canvas-toolbar">
          <div className="toolbar-search">
            <Input
              placeholder="Search items..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ minWidth: '200px' }}
            />
          </div>
          <div className="toolbar-filters">
            <button
              className={`filter-btn ${filterType === '' ? 'active' : ''}`}
              onClick={() => setFilterType('')}
            >
              All ({items.length})
            </button>
            {ITEM_TYPES.map(({ type, label, icon, color }) => (
              itemCounts[type] > 0 && (
                <button
                  key={type}
                  className={`filter-btn ${filterType === type ? 'active' : ''}`}
                  onClick={() => setFilterType(filterType === type ? '' : type)}
                  style={filterType === type ? { borderColor: color, color: color } : {}}
                >
                  {icon} {label} ({itemCounts[type]})
                </button>
              )
            ))}
          </div>
        </div>
        {loading ? (
          <div className="canvas-loading">
            <div className="loading-spinner" />
            <p>Loading board...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="canvas-empty">
            <EmptyState
              title="Your board is empty"
              message="Start adding images, videos, YouTube links, documents, and notes to your game design board."
              action={
                <Button variant="primary" onClick={() => handleAddButtonClick()}>
                  + Add First Item
                </Button>
              }
            />
          </div>
        ) : (
          <div
            ref={canvasRef}
            className={`board-canvas ${isPanning ? 'panning' : ''}`}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          >
            <ConnectionLines
              items={items}
              connections={connections}
              canvasOffset={canvasOffset}
              onDeleteConnection={handleDeleteConnection}
            />
            <div
              className="canvas-content"
              style={{
                transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`,
              }}
            >
              {filteredItems.map(item => (
                <div
                  key={item.id}
                  style={{
                    outline: connectMode && connectSource?.id === item.id ? '2px solid #ef4444' : 'none',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <ItemCard
                    item={item}
                    onClick={() => handleItemClick(item)}
                    onDragEnd={handleDragEnd}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <AddItemModal
        open={addModalOpen}
        onClose={() => { setAddModalOpen(false); setAddModalType(undefined) }}
        onAdd={handleAddItem}
        controller={controller}
        defaultType={addModalType}
      />

      <ItemDetailModal
        item={selectedItem}
        open={detailModalOpen}
        onClose={() => { setDetailModalOpen(false); setSelectedItem(null) }}
        onUpdate={handleUpdateItem}
        onDelete={handleDeleteItem}
        controller={controller}
      />

      <style>{`
        .board-layout {
          display: flex;
          height: 100vh;
          overflow: hidden;
          background: var(--bg-primary);
        }

        /* Sidebar */
        .board-sidebar {
          width: 220px;
          min-width: 220px;
          background: var(--bg-secondary);
          border-right: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          z-index: 10;
        }

        .sidebar-header {
          padding: 20px 16px 12px;
          border-bottom: 1px solid var(--border-color);
        }

        .sidebar-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 4px;
        }

        .sidebar-subtitle {
          font-size: 11px;
          color: var(--text-secondary);
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .sidebar-section {
          padding: 16px;
          border-bottom: 1px solid var(--border-color);
        }

        .sidebar-section-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin: 0 0 10px;
        }

        .sidebar-add-buttons {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .sidebar-add-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          cursor: pointer;
          color: var(--text-primary);
          font-size: 13px;
          transition: all 0.15s;
          position: relative;
          text-align: left;
        }

        .sidebar-add-btn:hover {
          background: var(--bg-tertiary, rgba(99,102,241,0.1));
          border-color: var(--border-color);
        }

        .sidebar-btn-icon {
          font-size: 16px;
          width: 20px;
          text-align: center;
        }

        .sidebar-btn-label {
          flex: 1;
          font-weight: 500;
        }

        .sidebar-btn-count {
          font-size: 10px;
          font-weight: 700;
          color: white;
          padding: 1px 6px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
        }

        .sidebar-stats {
          display: flex;
          gap: 12px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: #6366f1;
        }

        .stat-label {
          font-size: 11px;
          color: var(--text-secondary);
        }

        .sidebar-footer {
          padding: 16px;
          margin-top: auto;
        }

        /* Toolbar */
        .canvas-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          flex-wrap: wrap;
          z-index: 5;
          position: relative;
        }

        .toolbar-search {
          flex: 0 0 auto;
        }

        .toolbar-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }

        .filter-btn {
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 500;
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: 20px;
          cursor: pointer;
          color: var(--text-secondary);
          transition: all 0.15s;
          white-space: nowrap;
        }

        .filter-btn:hover {
          border-color: #6366f1;
          color: var(--text-primary);
        }

        .filter-btn.active {
          background: #6366f1;
          border-color: #6366f1;
          color: white;
        }

        /* Canvas */
        .board-canvas-container {
          flex: 1;
          overflow: hidden;
          position: relative;
          display: flex;
          flex-direction: column;
        }

        .board-canvas {
          width: 100%;
          height: 100%;
          position: relative;
          overflow: hidden;
          cursor: default;
          background-image:
            radial-gradient(circle, var(--border-color) 1px, transparent 1px);
          background-size: 24px 24px;
        }

        .board-canvas.panning {
          cursor: grabbing;
        }

        .canvas-content {
          position: absolute;
          top: 0;
          left: 0;
          width: 3000px;
          height: 3000px;
          will-change: transform;
        }

        .canvas-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 16px;
          color: var(--text-secondary);
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--border-color);
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .canvas-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 40px;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .board-sidebar {
            width: 180px;
            min-width: 180px;
          }
        }
      `}</style>
    </div>
  )
}
