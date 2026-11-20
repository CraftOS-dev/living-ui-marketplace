/**
 * A source as a chip that opens it in a new tab (the link where a
 * candidate or a tile was found), with its own hover.
 */
import type { LucideIcon } from 'lucide-react';
import { ExternalLink } from 'lucide-react';
import { Tag } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { cn } from '../../../kit/index.ts';

export function SourceLink({ href, children, icon = ExternalLink, tone, title, className }: { href: string; children: React.ReactNode; icon?: LucideIcon | undefined; tone?: Tone | undefined; title?: string | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={title ?? 'Open the source'} onClick={(e) => e.stopPropagation()} className={cn('vo-focus group inline-flex min-w-0 shrink-0 rounded-[4px]', className)}>
      <Tag icon={icon} tone={tone} className="max-w-[260px] transition-colors duration-150 group-hover:border-[var(--vo-line-2)] group-hover:bg-[var(--vo-active)] group-hover:text-[var(--vo-ink)]">
        <span className="truncate">{children}</span>
      </Tag>
    </a>
  );
}
