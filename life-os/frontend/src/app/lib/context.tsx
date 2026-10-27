/**
 * What every screen shares: the app status (counts for badges, the sidebar
 * trees, today's date and season), kept live.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { op } from './api.ts';
import { READS, useLive } from './live.ts';
import type { Live } from './live.ts';
import type { Status } from './types.ts';

const Ctx = createContext<Live<Status> | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const status = useLive<Status>((signal) => op<Status>('app.status', {}, { quiet: true, signal }), READS.frame, [], 250);
  return <Ctx.Provider value={status}>{children}</Ctx.Provider>;
}

export function useStatus(): Live<Status> {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useStatus outside AppDataProvider');
  return v;
}
