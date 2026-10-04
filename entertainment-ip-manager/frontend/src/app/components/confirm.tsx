/**
 * Confirmation dialog with translated buttons. Same call shape as the kit's
 * useConfirm (which has English-only buttons): `const [el, confirm] = useConfirm()`,
 * then `if (await confirm(message, title)) ...`. Use this one in the app.
 */
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '../../kit/index.ts';
import { t } from '../lib/i18n.ts';

export function useConfirm(): [ReactNode, (message: string, title?: string) => Promise<boolean>] {
  const [state, setState] = useState<{ message: string; title?: string | undefined } | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (message: string, title?: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setState({ message, title });
      }),
    [],
  );

  const settle = (ok: boolean): void => {
    resolveRef.current?.(ok);
    setState(null);
  };

  const element =
    state !== null ? (
      <ConfirmDialog
        open
        title={state.title ?? t('Are you sure?')}
        message={state.message}
        confirmLabel={t('Confirm')}
        cancelLabel={t('Cancel')}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    ) : null;

  return [element, confirm];
}
