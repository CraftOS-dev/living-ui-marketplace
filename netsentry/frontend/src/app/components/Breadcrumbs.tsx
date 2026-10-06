/**
 * Where you are and how you got here: Home › vaccum › Programs accepting
 * connections › Technical details. Every step but the last is a link; going
 * deeper is always a row you tap ("DrillRow"), never a mode switch.
 */
import { href } from '../lib/nav.ts';
import { ChevronRightIcon } from './icons.tsx';

export interface Crumb {
  label: string;
  /** Hash path; the last crumb (where you are) has none. */
  to?: string | undefined;
}

export function Breadcrumbs({ trail }: { trail: Crumb[] }): React.JSX.Element {
  const back = [...trail].reverse().find((c) => c.to);
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-[13px]">
      {/* phones: one step back */}
      {back?.to && (
        <a href={href(back.to)} className="inline-flex min-h-[40px] items-center gap-1 text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] sm:hidden">
          ← {back.label}
        </a>
      )}
      <ol className="hidden flex-wrap items-center gap-1 sm:flex">
        {trail.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && (
              <span className="text-[var(--agent-app-muted)]" aria-hidden>
                <ChevronRightIcon size={12} />
              </span>
            )}
            {c.to ? (
              <a href={href(c.to)} className="max-w-[16rem] truncate text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] hover:underline">
                {c.label}
              </a>
            ) : (
              <span className="max-w-[20rem] truncate font-medium" aria-current="page">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A row that takes you one level deeper: icon, what is there, a short hint, and ›. */
export function DrillRow({
  to,
  icon,
  label,
  hint,
}: {
  to: string;
  icon?: React.ReactNode;
  label: string;
  hint?: string | undefined;
}): React.JSX.Element {
  return (
    <a
      href={href(to)}
      className="flex min-h-[52px] items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--agent-app-surface-2)]"
    >
      {icon && <span className="shrink-0 text-[var(--agent-app-muted)]">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px]">{label}</span>
        {hint && <span className="block truncate text-[12px] text-[var(--agent-app-muted)]">{hint}</span>}
      </span>
      <span className="shrink-0 text-[var(--agent-app-muted)]">
        <ChevronRightIcon size={16} />
      </span>
    </a>
  );
}

/** A group of DrillRows in one card. */
export function DrillList({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="overflow-hidden rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">{children}</div>;
}
