/**
 * A page's frame: a landscape banner with the title on the sky (and the
 * page's main actions at its right), then the page's body on paper.
 */
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useStatus } from '../lib/context.tsx';
import type { DayPart, Season } from '../lib/themeColors.ts';
import { back } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { Scene } from './Scene.tsx';

export function partOf(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** The time of day and season for the pictures. */
export function useSky(): { part: DayPart; season: Season } {
  const s = useStatus().data;
  const hour = s?.now.hour ?? new Date().getHours();
  return { part: partOf(hour), season: s?.season ?? 'autumn' };
}

export function PageBanner({ title, subtitle, seed, actions, backTo, height, eyebrow }: { title: ReactNode; subtitle?: ReactNode | undefined; seed: string; actions?: ReactNode | undefined; backTo?: Page | undefined; height?: number | undefined; eyebrow?: ReactNode | undefined }): React.JSX.Element {
  const sky = useSky();
  return (
    <Scene height={height ?? (backTo !== undefined && eyebrow !== undefined && subtitle !== undefined ? 164 : 136)} seed={seed} part={sky.part} season={sky.season} variant="page" className="border-b border-[var(--lo-hair)]">
      <div className="mx-auto flex h-full max-w-[1320px] flex-col items-start gap-2 px-5 pt-5 sm:flex-row sm:justify-between sm:gap-4 md:px-8 md:pt-6">
        <div className="min-w-0 max-w-full">
          {backTo !== undefined && (
            <button type="button" onClick={() => back(backTo)} className="mb-1 inline-flex items-center gap-1 rounded-full text-[13px] font-bold text-[var(--lo-on-sky-muted)] hover:text-[var(--lo-on-sky)]">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          {eyebrow !== undefined && <div className="mb-0.5 text-[13px] font-bold text-[var(--lo-on-sky-muted)]">{eyebrow}</div>}
          <h1 className="serif truncate text-[26px] font-semibold leading-9 text-[var(--lo-on-sky)]">{title}</h1>
          {subtitle !== undefined && <div className="mt-0.5 truncate text-[14px] font-semibold text-[var(--lo-on-sky-muted)]">{subtitle}</div>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
    </Scene>
  );
}

export function PageBody({ children, className, narrow = false }: { children: ReactNode; className?: string | undefined; narrow?: boolean | undefined }): React.JSX.Element {
  return <div className={cn('mx-auto w-full px-4 pb-10 pt-5 md:px-8 md:pt-6', narrow ? 'max-w-[920px]' : 'max-w-[1320px]', className)}>{children}</div>;
}
