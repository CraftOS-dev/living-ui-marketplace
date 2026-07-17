import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Building2,
  CheckSquare,
  Handshake,
  Home,
  Kanban,
  Landmark,
  List as ListIcon,
  LogOut,
  Menu,
  PenTool,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  UsersRound,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ListInfo } from '@/types'
import type { Route } from '@/hooks/useHashRoute'
import type { Viewport } from '@/hooks/useViewport'
import { useAuth } from '@/components/auth/AuthProvider'
import { useUiActions } from '@/components/MainView'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RecordAvatar } from '@/components/common/RecordAvatar'

const LIST_ICONS: Record<string, LucideIcon> = {
  kanban: Kanban,
  list: ListIcon,
  landmark: Landmark,
  'pen-tool': PenTool,
  users: UsersRound,
}

interface SidebarProps {
  route: Route
  navigate: (path: string) => void
  lists: ListInfo[]
  viewport: Viewport
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  path: string
}

const MAIN_NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: Home, path: 'home' },
  { key: 'my-work', label: 'My Work', icon: CheckSquare, path: 'my-work' },
  { key: 'people', label: 'People', icon: Users, path: 'people' },
  { key: 'companies', label: 'Companies', icon: Building2, path: 'companies' },
  { key: 'deals', label: 'Deals', icon: Handshake, path: 'deals' },
]

const FOOTER_NAV: NavItem[] = [
  { key: 'reports', label: 'Reports', icon: BarChart3, path: 'reports' },
  { key: 'settings', label: 'Settings', icon: SettingsIcon, path: 'settings' },
]

function SidebarBody({ route, navigate, lists, collapsed }: { route: Route; navigate: (p: string) => void; lists: ListInfo[]; collapsed: boolean }) {
  const { user, logout } = useAuth()
  const { openPalette, openNewList } = useUiActions()

  const isActive = (item: NavItem) =>
    route.page === item.key || (item.key === 'home' && (route.page === '' || route.page === 'home'))

  const NavButton = ({ item }: { item: NavItem }) => {
    const button = (
      <button
        onClick={() => navigate(item.path)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive(item)
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </button>
    )
    if (!collapsed) return button
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Workspace header */}
      <div className={cn('flex items-center gap-2 px-3 pb-2 pt-3', collapsed && 'justify-center px-0')}>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Users className="h-3.5 w-3.5" />
        </div>
        {!collapsed && <span className="truncate text-sm font-semibold">CRM System</span>}
      </div>

      {/* Search trigger */}
      <div className={cn('px-2 pb-2', collapsed && 'px-1.5')}>
        <button
          onClick={openPalette}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60',
            collapsed && 'justify-center px-0'
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && (
            <>
              <span>Search…</span>
              <kbd className="ml-auto rounded border border-border bg-muted px-1 text-[10px] font-medium">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex flex-col gap-0.5 px-2">
        {MAIN_NAV.map((item) => (
          <NavButton key={item.key} item={item} />
        ))}
      </nav>

      {/* Lists */}
      <div className="mt-4 flex-1 overflow-y-auto px-2">
        {!collapsed && (
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="label-caps">Lists</span>
            <button
              onClick={openNewList}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="New list"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {lists.map((list) => {
            const Icon = LIST_ICONS[list.icon] || ListIcon
            const active = route.page === 'lists' && Number(route.parts[1]) === list.id
            const button = (
              <button
                key={list.id}
                onClick={() => navigate(`lists/${list.id}`)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" style={{ color: list.color || undefined }} />
                {!collapsed && (
                  <>
                    <span className="truncate">{list.name}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{list.entryCount ?? 0}</span>
                  </>
                )}
              </button>
            )
            if (!collapsed) return button
            return (
              <Tooltip key={list.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right">{list.name}</TooltipContent>
              </Tooltip>
            )
          })}
          {collapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={openNewList}
                  className="flex w-full items-center justify-center rounded-md px-0 py-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  aria-label="New list"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">New list</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Footer nav + AI + user */}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border px-2 py-2">
        <NavButton item={{ key: 'ai', label: 'Ask your CRM', icon: Sparkles, path: '' } as NavItem} />
        {FOOTER_NAV.map((item) => (
          <NavButton key={item.key} item={item} />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
                collapsed && 'justify-center px-0'
              )}
            >
              <RecordAvatar name={user?.username || '?'} color="#7c9ce8" size="xs" />
              {!collapsed && <span className="truncate">{user?.username}</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuLabel className="normal-case tracking-normal text-xs">
              {user?.email}
              {user?.role === 'admin' ? ' · Admin' : ''}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function Sidebar({ route, navigate, lists, viewport, mobileOpen, setMobileOpen }: SidebarProps) {
  const { openAiChat } = useUiActions()

  // Intercept the "Ask your CRM" pseudo nav item
  const wrappedNavigate = (path: string) => {
    if (path === '') {
      openAiChat()
      return
    }
    navigate(path)
  }

  if (viewport.isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card shadow-sm"
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4" />
        </button>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarBody route={route} navigate={wrappedNavigate} lists={lists} collapsed={false} />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  const collapsed = viewport.isTablet
  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-card/50',
        collapsed ? 'w-[52px]' : 'w-60'
      )}
    >
      <SidebarBody route={route} navigate={wrappedNavigate} lists={lists} collapsed={collapsed} />
    </aside>
  )
}
