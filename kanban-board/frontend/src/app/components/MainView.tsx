import { useState, useEffect, useCallback } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { Board, Card, BoardStats, SearchParams } from '../types'
import { toast } from 'react-toastify'
import { Header } from './Header'
import { BoardView } from './BoardView'
import { Sidebar } from './Sidebar'
import { CardDetailModal } from './CardDetailModal'
import { EmptyState } from './ui'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  useAgentAware('MainView', { currentSection: 'kanban' })

  const [boards, setBoards] = useState<Board[]>([])
  const [currentBoard, setCurrentBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState<BoardStats | null>(null)
  const [searchResults, setSearchResults] = useState<Card[] | null>(null)
  const [searchParams, setSearchParams] = useState<SearchParams>({})

  const loadBoards = useCallback(async () => {
    try {
      const allBoards = await controller.getBoards()
      setBoards(allBoards)
      return allBoards
    } catch (err) {
      toast.error('Failed to load boards')
      return []
    }
  }, [controller])

  const loadBoard = useCallback(async (boardId: number) => {
    try {
      setLoading(true)
      const board = await controller.getBoard(boardId)
      setCurrentBoard(board)
      setSearchResults(null)
      setSearchParams({})
      try {
        const s = await controller.getBoardStats(boardId)
        setStats(s)
      } catch { /* stats are optional */ }
    } catch (err) {
      toast.error('Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [controller])

  const refreshBoard = useCallback(async () => {
    if (currentBoard) {
      await loadBoard(currentBoard.id)
    }
  }, [currentBoard, loadBoard])

  useEffect(() => {
    const init = async () => {
      const allBoards = await loadBoards()
      if (allBoards.length > 0) {
        await loadBoard(allBoards[0].id)
      } else {
        try {
          const newBoard = await controller.createBoard('My Board')
          setBoards([newBoard])
          await loadBoard(newBoard.id)
        } catch {
          setLoading(false)
        }
      }
    }
    init()
  }, [controller, loadBoards, loadBoard])

  const handleSwitchBoard = async (boardId: number) => {
    await loadBoard(boardId)
  }

  const handleCreateBoard = async (name: string) => {
    try {
      const board = await controller.createBoard(name)
      await loadBoards()
      await loadBoard(board.id)
      toast.success('Board created')
    } catch {
      toast.error('Failed to create board')
    }
  }

  const handleDeleteBoard = async (boardId: number) => {
    try {
      await controller.deleteBoard(boardId)
      const allBoards = await loadBoards()
      if (allBoards.length > 0) {
        await loadBoard(allBoards[0].id)
      } else {
        setCurrentBoard(null)
      }
      toast.success('Board deleted')
    } catch {
      toast.error('Failed to delete board')
    }
  }

  const handleRenameBoard = async (boardId: number, name: string) => {
    try {
      await controller.updateBoard(boardId, name)
      await loadBoards()
      if (currentBoard?.id === boardId) {
        setCurrentBoard(prev => prev ? { ...prev, name } : null)
      }
    } catch {
      toast.error('Failed to rename board')
    }
  }

  const handleSearch = async (params: SearchParams) => {
    setSearchParams(params)
    if (!currentBoard) return
    const hasFilters = params.q || params.priority || params.label_id || params.due_status
    if (!hasFilters) {
      setSearchResults(null)
      return
    }
    try {
      const results = await controller.searchCards(currentBoard.id, params)
      setSearchResults(results)
    } catch {
      toast.error('Failed to search')
    }
  }

  const handleCardClick = async (card: Card) => {
    try {
      const fullCard = await controller.getCard(card.id)
      setSelectedCard(fullCard)
    } catch {
      toast.error('Failed to load card')
    }
  }

  const handleCardUpdate = async () => {
    if (selectedCard) {
      try {
        const updated = await controller.getCard(selectedCard.id)
        setSelectedCard(updated)
      } catch { /* card may have been deleted */ }
    }
    await refreshBoard()
  }

  const handleCardClose = () => {
    setSelectedCard(null)
  }

  if (loading && !currentBoard) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-lg)' }}>Loading...</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header
        boards={boards}
        currentBoard={currentBoard}
        searchParams={searchParams}
        onSwitchBoard={handleSwitchBoard}
        onCreateBoard={handleCreateBoard}
        onDeleteBoard={handleDeleteBoard}
        onRenameBoard={handleRenameBoard}
        onSearch={handleSearch}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sidebarOpen && currentBoard && (
          <Sidebar
            controller={controller}
            board={currentBoard}
            stats={stats}
            searchParams={searchParams}
            onSearch={handleSearch}
            onRefresh={refreshBoard}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {currentBoard ? (
            <BoardView
              controller={controller}
              board={currentBoard}
              searchResults={searchResults}
              onCardClick={handleCardClick}
              onRefresh={refreshBoard}
            />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: 'var(--space-8)' }}>
              <EmptyState message="No boards yet. Create one to get started!" />
            </div>
          )}
        </div>
      </div>
      {selectedCard && currentBoard && (
        <CardDetailModal
          controller={controller}
          card={selectedCard}
          boardLabels={currentBoard.labels || []}
          onClose={handleCardClose}
          onUpdate={handleCardUpdate}
        />
      )}
    </div>
  )
}
