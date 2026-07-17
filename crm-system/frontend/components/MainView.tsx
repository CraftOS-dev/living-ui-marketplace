import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useAgentAware } from '../agent/hooks'
import type { ListInfo, RecordType } from '@/types'
import { api } from '@/api'
import { useHashRoute } from '@/hooks/useHashRoute'
import { useViewport } from '@/hooks/useViewport'
import { Sidebar } from '@/components/shell/Sidebar'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog'
import { CreateRecordDialog } from '@/components/shell/CreateRecordDialog'
import { CreateListDialog } from '@/components/shell/CreateListDialog'
import { TaskQuickAdd } from '@/components/shell/TaskQuickAdd'
import { AiChatSheet } from '@/components/ai/AiChatSheet'
import { Dashboard } from '@/components/pages/Dashboard'
import { MyWork } from '@/components/pages/MyWork'
import { Reports } from '@/components/pages/Reports'
import { Settings } from '@/components/pages/Settings'
import { ObjectPage } from '@/components/views/ObjectPage'
import { RecordPage } from '@/components/record/RecordPage'

interface UiActions {
  openPalette: () => void
  openCreate: (recordType: RecordType, defaults?: Record<string, unknown>) => void
  openNewTask: (defaults?: { recordType?: RecordType; recordId?: number; recordName?: string }) => void
  openNewList: () => void
  openAiChat: () => void
  refreshLists: () => void
  lists: ListInfo[]
}

const UiActionsContext = createContext<UiActions | null>(null)

export function useUiActions(): UiActions {
  const ctx = useContext(UiActionsContext)
  if (!ctx) throw new Error('useUiActions must be used within MainView')
  return ctx
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable ||
    target.closest('[role="dialog"]') !== null
  )
}

export function MainView() {
  useAgentAware('MainView', { view: 'crm' })
  const [route, navigate] = useHashRoute()
  const viewport = useViewport()

  const [lists, setLists] = useState<ListInfo[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [listDialogOpen, setListDialogOpen] = useState(false)
  const [createState, setCreateState] = useState<{ type: RecordType; defaults?: Record<string, unknown> } | null>(null)
  const [taskState, setTaskState] = useState<{ open: boolean; defaults?: { recordType?: RecordType; recordId?: number; recordName?: string } }>({ open: false })
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile sheet

  const refreshLists = useCallback(() => {
    api.lists.all().then(setLists).catch(() => setLists([]))
  }, [])

  useEffect(() => {
    refreshLists()
  }, [refreshLists])

  // Current-context record type for the `c` shortcut
  const contextRecordType: RecordType = useMemo(() => {
    if (route.page === 'companies') return 'company'
    if (route.page === 'deals') return 'deal'
    if (route.page === 'lists' && route.parts[1]) {
      const list = lists.find((l) => l.id === Number(route.parts[1]))
      return (list?.parentObject as RecordType) || 'deal'
    }
    if (route.page === 'records' && route.parts[1]) return route.parts[1] as RecordType
    return 'person'
  }, [route, lists])

  // Global keyboard shortcuts (F7.2)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (isTypingTarget(event.target)) return
      if (event.key === '/') {
        event.preventDefault()
        setPaletteOpen(true)
      } else if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(true)
      } else if (event.key.toLowerCase() === 't' && !meta && !event.altKey) {
        event.preventDefault()
        setTaskState({ open: true })
      } else if (event.key.toLowerCase() === 'c' && !meta && !event.altKey) {
        event.preventDefault()
        setCreateState({ type: contextRecordType })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [contextRecordType])

  // Close the mobile sidebar sheet on navigation
  useEffect(() => {
    setSidebarOpen(false)
  }, [route])

  const actions: UiActions = useMemo(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openCreate: (recordType, defaults) => setCreateState({ type: recordType, defaults }),
      openNewTask: (defaults) => setTaskState({ open: true, defaults }),
      openNewList: () => setListDialogOpen(true),
      openAiChat: () => setAiOpen(true),
      refreshLists,
      lists,
    }),
    [refreshLists, lists]
  )

  const renderPage = () => {
    switch (route.page) {
      case 'my-work':
        return <MyWork key="my-work" />
      case 'people':
        return <ObjectPage key="people" recordType="person" />
      case 'companies':
        return <ObjectPage key="companies" recordType="company" />
      case 'deals':
        return <ObjectPage key="deals" recordType="deal" />
      case 'lists': {
        const listId = Number(route.parts[1] || 0)
        const list = lists.find((l) => l.id === listId)
        return <ObjectPage key={`list-${listId}`} recordType={(list?.parentObject as RecordType) || 'deal'} listId={listId} />
      }
      case 'reports':
        return <Reports key="reports" />
      case 'settings':
        return <Settings key="settings" />
      case 'records': {
        const recordType = route.parts[1] as RecordType
        const recordId = Number(route.parts[2] || 0)
        return <RecordPage key={`${recordType}-${recordId}`} recordType={recordType} recordId={recordId} />
      }
      default:
        return <Dashboard key="home" />
    }
  }

  return (
    <UiActionsContext.Provider value={actions}>
      <div className="flex h-full overflow-hidden bg-background text-foreground">
        <Sidebar
          route={route}
          navigate={navigate}
          lists={lists}
          viewport={viewport}
          mobileOpen={sidebarOpen}
          setMobileOpen={setSidebarOpen}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{renderPage()}</main>
      </div>

      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
      <ShortcutsDialog open={shortcutsOpen} setOpen={setShortcutsOpen} />
      <AiChatSheet open={aiOpen} setOpen={setAiOpen} />
      <CreateListDialog open={listDialogOpen} setOpen={setListDialogOpen} />
      {createState ? (
        <CreateRecordDialog
          recordType={createState.type}
          defaults={createState.defaults}
          onClose={() => setCreateState(null)}
        />
      ) : null}
      <TaskQuickAdd
        open={taskState.open}
        defaults={taskState.defaults}
        onClose={() => setTaskState({ open: false })}
      />
    </UiActionsContext.Provider>
  )
}
