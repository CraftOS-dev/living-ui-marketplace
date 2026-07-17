import type { LucideIcon } from 'lucide-react'
import {
  ArrowRightLeft,
  CheckCircle2,
  CheckSquare,
  FilePen,
  ListPlus,
  Mail,
  Phone,
  Sparkles,
  SquarePen,
  UserPlus,
  Video,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export const ACTIVITY_META: Record<string, { icon: LucideIcon; tint: string }> = {
  created: { icon: UserPlus, tint: 'text-muted-foreground' },
  field_change: { icon: FilePen, tint: 'text-muted-foreground' },
  stage_change: { icon: ArrowRightLeft, tint: 'text-primary' },
  note_created: { icon: SquarePen, tint: 'text-amber-500' },
  note: { icon: SquarePen, tint: 'text-amber-500' },
  email: { icon: Mail, tint: 'text-sky-500' },
  call: { icon: Phone, tint: 'text-emerald-500' },
  meeting: { icon: Video, tint: 'text-violet-500' },
  task_created: { icon: CheckSquare, tint: 'text-muted-foreground' },
  task_completed: { icon: CheckCircle2, tint: 'text-emerald-500' },
  list_added: { icon: ListPlus, tint: 'text-muted-foreground' },
  ai: { icon: Sparkles, tint: 'text-primary' },
  other: { icon: FilePen, tint: 'text-muted-foreground' },
}

export function TimelineIcon({ type, className }: { type: string; className?: string }) {
  const meta = ACTIVITY_META[type] || ACTIVITY_META.other
  const Icon = meta.icon
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.tint, className)} />
}

/** System change entries render compact & gray; human content as cards (§6.4). */
export function isSystemActivity(type: string): boolean {
  return ['created', 'field_change', 'stage_change', 'task_created', 'task_completed', 'list_added'].includes(type)
}
