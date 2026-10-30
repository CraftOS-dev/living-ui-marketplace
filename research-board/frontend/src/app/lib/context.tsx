/** App-wide live data every page needs: the settings and the list of boards. */
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { useLive } from './live.ts';
import type { Board, Settings } from './types.ts';

interface AppData {
  settings: Settings | null;
  title: string;
  boards: Board[];
  boardById: Map<string, Board>;
  ready: boolean;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive(() => api.settings(), ['settings'], []);
  const boards = useLive(() => api.boards(false), ['boards', 'cards', 'links'], []);
  const value = useMemo<AppData>(() => {
    const list = boards.data?.boards ?? [];
    return {
      settings: settings.data,
      title: settings.data?.title ?? 'Research Board',
      boards: list,
      boardById: new Map(list.map((b) => [b.id, b])),
      ready: settings.data !== null && boards.data !== null,
    };
  }, [settings.data, boards.data]);
  useEffect(() => {
    if (settings.data !== null) document.title = settings.data.title;
  }, [settings.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppDataProvider');
  return v;
}
