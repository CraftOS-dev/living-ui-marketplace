/**
 * The world outside: the weather where the person lives and the news, read
 * through operations (the server fetches and caches them).
 */
import { useEffect, useState } from 'react';
import { op } from './api.ts';
import { useLive } from './live.ts';
import type { News, Weather } from './types.ts';

export function useWeather(): { weather: Weather | null; error: string; loading: boolean } {
  const live = useLive<{ weather: Weather | null; error: string }>((signal) => op('world.weather', {}, { quiet: true, signal }), ['settings'], []);
  // The server caches for 20 minutes; look again every 20 minutes while open.
  useEffect(() => {
    const t = setInterval(() => live.reload(), 20 * 60 * 1000);
    return () => clearInterval(t);
  }, [live.reload]);
  return { weather: live.data?.weather ?? null, error: live.data?.error ?? live.error ?? '', loading: live.loading };
}

export function useNews(topic: string, limit = 8): { news: News | null; loading: boolean } {
  const [news, setNews] = useState<News | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    void op<News>('world.news', { topic, limit }, { quiet: true, signal: ctrl.signal })
      .then((n) => setNews(n))
      .catch(() => setNews(null))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [topic, limit]);
  return { news, loading };
}

export const TOPIC_NAMES: Record<string, string> = {
  top: 'Top stories',
  world: 'World',
  nation: 'Your country',
  business: 'Business',
  technology: 'Technology',
  science: 'Science',
  health: 'Health',
  sports: 'Sports',
  entertainment: 'Culture',
};
