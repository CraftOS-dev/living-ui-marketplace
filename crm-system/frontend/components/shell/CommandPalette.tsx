import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Building2,
  CheckSquare,
  Handshake,
  Home,
  Kanban,
  Plus,
  Settings,
  Sparkles,
  SquarePen,
  Users,
} from 'lucide-react'

import { api } from '@/api'
import type { RecordBrief, SearchResults } from '@/types'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { useUiActions } from '@/components/MainView'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { BriefAvatar } from '@/components/common/RecordAvatar'
import { Badge } from '@/components/ui/badge'

const TYPE_BADGE: Record<string, string> = { person: 'Person', company: 'Company', deal: 'Deal' }

export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { openCreate, openNewTask, openNewList, openAiChat, lists } = useUiActions()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>({ people: [], companies: [], deals: [] })
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults({ people: [], companies: [], deals: [] })
    }
  }, [open])

  useEffect(() => {
    const term = query.trim()
    if (!term) {
      setResults({ people: [], companies: [], deals: [] })
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      api
        .search(term)
        .then(setResults)
        .catch(() => setResults({ people: [], companies: [], deals: [] }))
        .finally(() => setSearching(false))
    }, 150)
    return () => window.clearTimeout(timer)
  }, [query])

  const close = () => setOpen(false)

  const go = (path: string) => {
    close()
    navigateTo(path)
  }

  const openRecord = (brief: RecordBrief) => {
    close()
    navigateTo(recordPath(brief.recordType, brief.id))
  }

  const fuzzyMatch = (label: string) => {
    const term = query.trim().toLowerCase()
    if (!term) return true
    let index = 0
    for (const char of label.toLowerCase()) {
      if (char === term[index]) index++
      if (index === term.length) return true
    }
    return false
  }

  const actions = useMemo(
    () => [
      { label: 'Create person', icon: Plus, run: () => { close(); openCreate('person') }, shortcut: 'C' },
      { label: 'Create company', icon: Plus, run: () => { close(); openCreate('company') } },
      { label: 'Create deal', icon: Plus, run: () => { close(); openCreate('deal') } },
      { label: 'New task', icon: CheckSquare, run: () => { close(); openNewTask() }, shortcut: 'T' },
      { label: 'New note on…', icon: SquarePen, run: () => { close(); openNewTask() }, hidden: true },
      { label: 'New list / pipeline', icon: Kanban, run: () => { close(); openNewList() } },
      { label: 'Ask your CRM (AI)', icon: Sparkles, run: () => { close(); openAiChat() } },
    ],
    [openCreate, openNewTask, openNewList, openAiChat]
  )

  const navTargets = useMemo(
    () => [
      { label: 'Go to Home', icon: Home, path: 'home' },
      { label: 'Go to My Work', icon: CheckSquare, path: 'my-work' },
      { label: 'Go to People', icon: Users, path: 'people' },
      { label: 'Go to Companies', icon: Building2, path: 'companies' },
      { label: 'Go to Deals', icon: Handshake, path: 'deals' },
      ...lists.map((list) => ({ label: `Go to ${list.name}`, icon: Kanban, path: `lists/${list.id}` })),
      { label: 'Go to Reports', icon: BarChart3, path: 'reports' },
      { label: 'Go to Settings', icon: Settings, path: 'settings' },
    ],
    [lists]
  )

  const records: RecordBrief[] = [...results.people, ...results.companies, ...results.deals]
  const visibleActions = actions.filter((a) => !a.hidden && fuzzyMatch(a.label))
  const visibleNav = navTargets.filter((n) => fuzzyMatch(n.label))
  const nothing = !searching && records.length === 0 && visibleActions.length === 0 && visibleNav.length === 0

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search records, or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {nothing && <CommandEmpty>No results for “{query}”.</CommandEmpty>}

        {records.length > 0 && (
          <CommandGroup heading="Records">
            {records.map((brief) => (
              <CommandItem key={`${brief.recordType}-${brief.id}`} value={`record-${brief.recordType}-${brief.id}`} onSelect={() => openRecord(brief)}>
                <BriefAvatar brief={brief} size="xs" />
                <span className="truncate">{brief.name}</span>
                {brief.recordType === 'person' && brief.email ? (
                  <span className="truncate text-xs text-muted-foreground">{brief.email}</span>
                ) : null}
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {TYPE_BADGE[brief.recordType]}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {visibleActions.length > 0 && (
          <>
            {records.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Actions">
              {visibleActions.map((action) => (
                <CommandItem key={action.label} value={`action-${action.label}`} onSelect={action.run}>
                  <action.icon />
                  {action.label}
                  {action.shortcut ? <CommandShortcut>{action.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {visibleNav.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Navigate">
              {visibleNav.map((item) => (
                <CommandItem key={item.label} value={`nav-${item.label}`} onSelect={() => go(item.path)}>
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
