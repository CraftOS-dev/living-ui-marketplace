export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

export interface Board {
  id: number
  name: string
  lists: BoardList[]
  labels: Label[]
  createdAt: string
  updatedAt: string
}

export interface BoardList {
  id: number
  boardId: number
  title: string
  position: number
  cards: Card[]
  createdAt: string
  updatedAt: string
}

export interface Card {
  id: number
  listId: number
  title: string
  description: string | null
  priority: Priority
  dueDate: string | null
  position: number
  archived: boolean
  labels: Label[]
  checklistItems: ChecklistItem[]
  checklistTotal: number
  checklistCompleted: number
  createdAt: string
  updatedAt: string
}

export interface Label {
  id: number
  boardId: number
  name: string
  color: string
}

export interface ChecklistItem {
  id: number
  cardId: number
  text: string
  completed: boolean
  position: number
  createdAt: string
}

export interface BoardStats {
  totalCards: number
  cardsByList: { listId: number; title: string; count: number }[]
  cardsByPriority: Record<Priority, number>
  overdueCount: number
  completedChecklistItems: number
  totalChecklistItems: number
}

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
}

export interface SearchParams {
  q?: string
  priority?: Priority
  label_id?: number
  due_status?: 'overdue' | 'upcoming' | 'no_date'
}
