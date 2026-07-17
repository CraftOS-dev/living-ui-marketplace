import { cn } from '@/lib/utils'
import { pillStyle } from '@/lib/format'

interface PillProps {
  label: string
  color: string
  className?: string
  onClick?: () => void
}

/** Soft pastel-background pill with strong same-hue text (U-13). */
export function Pill({ label, color, className, onClick }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center truncate rounded-full px-2 py-px text-[11px] font-semibold leading-[18px]',
        onClick && 'cursor-pointer hover:opacity-80',
        className
      )}
      style={pillStyle(color)}
      onClick={onClick}
    >
      {label}
    </span>
  )
}

const STATUS_COLORS: Record<string, string> = {
  open: '#7c9ce8',
  won: '#4caf7d',
  lost: '#e08e8e',
}

export function DealStatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <Pill
      label={status.charAt(0).toUpperCase() + status.slice(1)}
      color={STATUS_COLORS[status] || '#8b8b94'}
      className={className}
    />
  )
}
