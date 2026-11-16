/**
 * Protected images in <img> tags (fix 5: company and firm logos).
 *
 * Logos are protected files: the server streams them only through an
 * operation (companies.logo, settings.logo, lib_files.serve), for a signed-in
 * session. An <img> sends no sign-in header, so the image is fetched like
 * every other protected file (with the session, as `download` does) and
 * shown from an object URL. Each URL is fetched once per page load and
 * kept; the url carries a version that changes with the image, so a new
 * logo is a new url. A failed fetch is forgotten (asked again next time).
 *
 *   const src = useImage(company.logo_url);   // undefined while loading, null when there is none
 *
 * After an upload, `primeImage(answer.logo_url, localObjectUrl)` makes the
 * new url show the chosen file at once, with no second download.
 */
import { useEffect, useState } from 'react';
import { getPbClient } from '../../kit/index.ts';

const ready = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();

function local(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

/** The object URL of a protected image (null when it is missing or refused). */
export function loadImage(url: string): Promise<string | null> {
  if (url === '') return Promise.resolve(null);
  if (local(url)) return Promise.resolve(url);
  const hit = ready.get(url);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = loading.get(url);
  if (p === undefined) {
    const pb = getPbClient().pb;
    const headers: Record<string, string> = pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {};
    p = fetch(pb.buildURL(url), { headers, credentials: 'same-origin' })
      .then((res) => (res.ok ? res.blob() : null))
      .then((b) => (b !== null && b.size > 0 ? URL.createObjectURL(b) : null))
      .catch(() => null)
      .then((src) => {
        loading.delete(url);
        if (src !== null) ready.set(url, src);
        return src;
      });
    loading.set(url, p);
  }
  return p;
}

/** The image a person just chose stands for the url the server answered with (no flash, no second download). */
export function primeImage(url: string, src: string): void {
  if (url !== '' && !local(url)) ready.set(url, src);
}

/** The image of a protected url: undefined while it loads, null when there is none. Keeps the last image until the next one is in. */
export function useImage(url: string): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(() => (url === '' ? null : local(url) ? url : ready.get(url)));
  useEffect(() => {
    if (url === '') {
      setSrc(null);
      return;
    }
    if (local(url)) {
      setSrc(url);
      return;
    }
    const hit = ready.get(url);
    if (hit !== undefined) {
      setSrc(hit);
      return;
    }
    let live = true;
    void loadImage(url).then((v) => {
      if (live) setSrc(v);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return src;
}

/** A logo file a person picked: refused with a reason when it is not one (the server checks again). */
export function logoProblem(file: File): string | null {
  const ok = /\.(png|jpe?g|webp|svg)$/i.test(file.name) || ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type);
  if (!ok) return 'A logo is a PNG, JPG, WebP or SVG image.';
  if (file.size > 2 * 1024 * 1024) return 'A logo is 2 MB at most; this image is ' + (file.size / 1048576).toFixed(1) + ' MB.';
  if (file.size === 0) return 'This image is empty.';
  return null;
}

/** The file types the logo pickers accept. */
export const LOGO_ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';
