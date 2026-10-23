/**
 * pdf.js for the reader (loaded on first use; it is large). Documents are
 * kept per file so switching tabs does not download a PDF twice.
 *
 * pdf.js only draws the pages here. The text the reader lets you select is
 * the app's own stored text layer (pages.get), the same text the server
 * anchors passages in, so a selection and a passage always name the same
 * characters.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

let lib: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  if (lib === null) {
    lib = (async () => {
      const m = await import('pdfjs-dist');
      // Bundled as a worker chunk: a .js file the app's server sends as JavaScript.
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&url');
      m.GlobalWorkerOptions.workerSrc = worker.default;
      return m;
    })();
  }
  return lib;
}

const docs = new Map<string, { task: { destroy: () => Promise<void> } | null; doc: Promise<PDFDocumentProxy> }>();

export function openDocument(fileId: string, url: string): Promise<PDFDocumentProxy> {
  const known = docs.get(fileId);
  if (known !== undefined) return known.doc;
  const entry: { task: { destroy: () => Promise<void> } | null; doc: Promise<PDFDocumentProxy> } = { task: null, doc: Promise.resolve(null as unknown as PDFDocumentProxy) };
  entry.doc = pdfjs().then((m) => {
    const task = m.getDocument({ url, withCredentials: true, disableAutoFetch: false });
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

/** Draw a page into a canvas at a css scale (sharp on high-density screens). Returns a cancel function. */
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
