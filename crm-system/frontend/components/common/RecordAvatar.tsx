import { useState } from 'react'
import { Building2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { faviconUrl, initials } from '@/lib/format'
import type { RecordBrief } from '@/types'

const SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-[12px]',
  lg: 'h-12 w-12 text-[16px]',
} as const

interface RecordAvatarProps {
  name: string
  color?: string
  recordType?: string
  domain?: string
  size?: keyof typeof SIZES
  className?: string
}

/**
 * Avatars everywhere (U-14): person = initials on deterministic pastel;
 * company = domain favicon with initial-letter fallback; deal = neutral tile.
 */
export function RecordAvatar({ name, color, recordType, domain, size = 'sm', className }: RecordAvatarProps) {
  const [faviconFailed, setFaviconFailed] = useState(false)
  const showFavicon = recordType === 'company' && domain && !faviconFailed

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold text-white',
        recordType === 'company' ? 'rounded-md' : 'rounded-full',
        SIZES[size],
        className
      )}
      style={{ backgroundColor: showFavicon ? 'transparent' : color || '#8b8b94' }}
      aria-hidden
    >
      {showFavicon ? (
        <img
          src={faviconUrl(domain!, 64)}
          alt=""
          className="h-full w-full rounded-md object-cover bg-muted"
          onError={() => setFaviconFailed(true)}
        />
      ) : recordType === 'deal' ? (
        <Building2 className="h-1/2 w-1/2 opacity-90" />
      ) : (
        initials(name)
      )}
    </span>
  )
}

export function BriefAvatar({ brief, size = 'sm', className }: { brief: RecordBrief; size?: keyof typeof SIZES; className?: string }) {
  return (
    <RecordAvatar
      name={brief.name}
      color={brief.avatarColor}
      recordType={brief.recordType}
      domain={brief.domain}
      size={size}
      className={className}
    />
  )
}
