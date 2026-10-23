/**
 * Maths on screen with KaTeX (loaded on first use; it is large). The PDF is
 * typeset by LaTeX itself, so what KaTeX cannot draw (a macro from the
 * preamble, a package's command) may still build: the preview says so
 * rather than refusing it.
 */
import { useEffect, useState } from 'react';

type Katex = typeof import('katex').default;

let lib: Katex | null = null;
let loading: Promise<Katex> | null = null;
const waiting = new Set<() => void>();

export function loadMath(): Promise<Katex> {
  if (lib !== null) return Promise.resolve(lib);
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
    lib = m.default;
    for (const fn of waiting) fn();
    waiting.clear();
    return lib;
  });
  return loading;
}

/** True once KaTeX is here (the component draws again then). */
export function useMath(): boolean {
  const [ready, setReady] = useState(lib !== null);
  useEffect(() => {
    if (lib !== null) return;
    let live = true;
    void loadMath().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

/** Draw maths into an element; returns KaTeX's complaint, or '' when it drew. Before KaTeX loads the source shows. */
export function paintMath(el: HTMLElement, src: string, display: boolean): string {
  if (lib === null) {
    el.textContent = src;
    el.dataset['pending'] = '1';
    waiting.add(() => {
      if (el.isConnected && el.dataset['pending'] === '1') paintMath(el, el.dataset['math'] ?? src, display);
    });
    void loadMath();
    return '';
  }
  delete el.dataset['pending'];
  try {
    lib.render(src, el, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, output: 'html' });
    return '';
  } catch (err) {
    el.textContent = src;
    return err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : String(err);
  }
}

/** The complaint KaTeX would have about some maths ('' when it is fine). */
export function mathProblem(src: string): string {
  if (lib === null || src.trim() === '') return '';
  try {
    lib.renderToString(src, { throwOnError: true, strict: 'ignore', trust: false });
    return '';
  } catch (err) {
    return err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : String(err);
  }
}
