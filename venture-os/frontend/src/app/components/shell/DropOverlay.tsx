/**
 * Drop and paste anywhere (U6): a file dragged over any page shows one quiet
 * overlay; dropped, it goes to the module that takes it (registry `drops`:
 * intake makes a deck a new deal, portfolio makes an update file an update).
 * A URL or files pasted outside a field go the same way. When several
 * handlers take it, their labels show as chips; the result opens where the
 * handler says. A local FileDrop (data-vo-drop) keeps its own drops.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload } from 'lucide-react';
import { errMessage } from '../../lib/api.ts';
import type { DropHandler, DropInput } from '../../lib/contract.ts';
import { currentRoute, go } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { drops } from '../../registry.ts';
import { Button, ChipPicker, Spinner } from '../ui.tsx';

const URL_RE = /^https?:\/\/\S+$/i;

function inputFrom(files: File[], text: string): DropInput {
  const t = text.trim();
  const url = URL_RE.test(t) ? t : null;
  return { files, url, text: url === null && t !== '' ? t : null, path: currentRoute().path };
}

function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el === null) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function DropOverlay(): React.JSX.Element | null {
  const [over, setOver] = useState(false);
  const [choose, setChoose] = useState<{ input: DropInput; handlers: DropHandler[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const depth = useRef(0);

  const dispatch = useCallback(async (input: DropInput, quietWhenNone: boolean): Promise<void> => {
    const list = drops().filter((h) => {
      try {
        return h.accepts(input);
      } catch {
        return false;
      }
    });
    if (list.length === 0) {
      if (!quietWhenNone) toast.error('Nothing here takes this file.');
      return;
    }
    if (list.length > 1) {
      setChoose({ input, handlers: list });
      return;
    }
    const h = list[0];
    if (h === undefined) return;
    setBusy(true);
    try {
      const where = await h.handle(input);
      if (where !== '') go(where);
    } catch (e) {
      if ((e as { code?: string }).code !== 'aborted') toast.error(errMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const hasPayload = (e: DragEvent): boolean => {
      const types = Array.from(e.dataTransfer?.types ?? []);
      return types.includes('Files') || types.includes('text/uri-list');
    };
    const local = (e: DragEvent): boolean => e.target instanceof Element && e.target.closest('[data-vo-drop]') !== null;
    const enter = (e: DragEvent): void => {
      if (!hasPayload(e) || drops().length === 0) return;
      depth.current += 1;
      if (!local(e)) setOver(true);
    };
    const overFn = (e: DragEvent): void => {
      if (!hasPayload(e) || drops().length === 0) return;
      e.preventDefault();
      setOver(!local(e));
    };
    const leave = (): void => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const dropFn = (e: DragEvent): void => {
      depth.current = 0;
      setOver(false);
      if (local(e) || drops().length === 0) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
      if (files.length === 0 && text.trim() === '') return;
      void dispatch(inputFrom(files, text), false);
    };
    const paste = (e: ClipboardEvent): void => {
      if (typing() || document.querySelector('[role="dialog"]') !== null) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const input = inputFrom(files, text);
      if (files.length === 0 && input.url === null) return;
      e.preventDefault();
      void dispatch(input, true);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', dropFn);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', dropFn);
      window.removeEventListener('paste', paste);
    };
  }, [dispatch]);

  if (!over && choose === null && !busy) return null;
  return createPortal(
    <div className="vo-fade fixed inset-0 z-[88] flex items-center justify-center p-6" style={{ background: 'color-mix(in srgb, var(--vo-page), transparent 12%)' }} onPointerDown={(e) => e.target === e.currentTarget && choose !== null && setChoose(null)}>
      <div className="flex h-[min(360px,70vh)] w-[min(640px,92vw)] flex-col items-center justify-center gap-4 rounded-[calc(var(--vo-radius)*1.5)] border-2 border-dashed border-[var(--vo-ink-2)] bg-[var(--vo-raised)] text-center shadow-[var(--vo-shadow-lg)]">
        {busy ? (
          <Spinner size={20} className="text-[var(--vo-muted)]" />
        ) : choose !== null ? (
          <>
            <ChipPicker
              label="Add as"
              keys
              options={choose.handlers.map((h) => ({ value: h.key, label: h.label }))}
              value=""
              onChange={(k) => {
                const h = choose.handlers.find((x) => x.key === k);
                const input = choose.input;
                setChoose(null);
                if (h === undefined) return;
                setBusy(true);
                void h
                  .handle(input)
                  .then((where) => where !== '' && go(where))
                  .catch((e: unknown) => toast.error(errMessage(e)))
                  .finally(() => setBusy(false));
              }}
              className="justify-center"
            />
            <Button variant="ghost" onClick={() => setChoose(null)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-full bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]">
              <Upload size={20} aria-hidden />
            </span>
            <span className="text-[15px] font-semibold">Drop to add</span>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
