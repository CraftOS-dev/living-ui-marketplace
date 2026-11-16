/**
 * Employee photos are protected files: fetched once with the session
 * (people.photo) and kept as object URLs for this tab; forgotten when a new
 * one is set (people.photo-set).
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getPbClient } from '../../../kit/index.ts';
import { fetchRetry } from '../../lib/api.ts';
import { PersonChip } from '../../components/ui.tsx';

const cache = new Map<string, string | null>();
const waiting = new Map<string, Promise<string | null>>();
const subs = new Set<() => void>();

function fetchPhoto(employee: string): Promise<string | null> {
  if (cache.has(employee)) return Promise.resolve(cache.get(employee) ?? null);
  let p = waiting.get(employee);
  if (p === undefined) {
    const pb = getPbClient().pb;
    const url = new URL(pb.buildURL('/api/ops/people/photo'));
    url.searchParams.set('employee', employee);
    p = fetchRetry(url.toString(), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {} })
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : res.status === 429 || res.status >= 500 ? undefined : null))
      .catch(() => undefined)
      .then((u) => {
        waiting.delete(employee);
        // A busy or unreachable server is asked again next time; "no photo" is kept.
        if (u !== undefined) cache.set(employee, u);
        return u ?? null;
      });
    waiting.set(employee, p);
  }
  return p;
}

/** Forget a photo after it changed (every chip showing it reloads). */
export function forgetPhoto(employee: string): void {
  const old = cache.get(employee);
  if (old !== undefined && old !== null) URL.revokeObjectURL(old);
  cache.delete(employee);
  for (const fn of subs) fn();
}

/** The photo's object URL, or undefined while loading or when there is none. */
export function usePhoto(employee: string, has: boolean): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (has ? (cache.get(employee) ?? undefined) : undefined));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fn = (): void => setVersion((v) => v + 1);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  useEffect(() => {
    if (!has || employee === '') {
      setUrl(undefined);
      return;
    }
    let live = true;
    void fetchPhoto(employee).then((u) => live && setUrl(u ?? undefined));
    return () => {
      live = false;
    };
  }, [employee, has, version]);
  return url;
}

export function PersonPhoto({ employee, has, name, sub, size, href, strong }: { employee: string; has: boolean; name: string; sub?: ReactNode; size?: number | undefined; href?: string | undefined; strong?: boolean | undefined }): React.JSX.Element {
  const url = usePhoto(employee, has);
  return <PersonChip name={name} photo={url} sub={sub} size={size} href={href} strong={strong} />;
}
