/**
 * pdf.js for readers (diligence's page view, a deck preview), loaded on
 * first use (it is large). The worker is bundled as a chunk with
 * `?worker&url`, so PocketBase serves it as JavaScript (it serves .mjs as
 * text/plain on Windows). Documents are kept per file so switching tabs does
 * not download a PDF twice.
 *
 *   const doc = await openDocument(fileId, url);
 *   const page = await doc.getPage(4);
 *   const cancel = drawPage(page, canvas, 1.25);
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

let lib: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  if (lib === null) {
    lib = (async () => {
      const m = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&url');
      m.GlobalWorkerOptions.workerSrc = worker.default;
      return m;
    })();
  }
  return lib;
}

const docs = new Map<string, { task: { destroy: () => Promise<void> } | null; doc: Promise<PDFDocumentProxy> }>();

/** Open a PDF by a stable id (the file record) and a URL the session may fetch. */
export function openDocument(fileId: string, url: string, headers?: Record<string, string>): Promise<PDFDocumentProxy> {
  const known = docs.get(fileId);
  if (known !== undefined) return known.doc;
  const entry: { task: { destroy: () => Promise<void> } | null; doc: Promise<PDFDocumentProxy> } = { task: null, doc: Promise.resolve(null as unknown as PDFDocumentProxy) };
  entry.doc = pdfjs().then((m) => {
    const task = m.getDocument({ url, withCredentials: true, httpHeaders: headers });
    entry.task = task;
    return task.promise;
  });
  entry.doc.catch(() => docs.delete(fileId));
  docs.set(fileId, entry);
  if (docs.size > 6) {
    const first = docs.keys().next().value as string;
    if (first !== fileId) {
      void docs.get(first)?.task?.destroy();
      docs.delete(first);
    }
  }
  return entry.doc;
}

/** Draw a page into a canvas at a css scale (sharp on dense screens). Returns a cancel function. */
export function drawPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, onDone?: () => void): () => void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx === null) return () => undefined;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, viewport: vp, canvas });
  task.promise.then(() => onDone?.()).catch(() => undefined);
  return () => task.cancel();
}

export type { PDFDocumentProxy, PDFPageProxy };
