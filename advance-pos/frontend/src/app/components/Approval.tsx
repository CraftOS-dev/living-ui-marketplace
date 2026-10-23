/**
 * Manager approval: when the person at the register may not do something
 * (a bigger discount, a refund, opening the drawer), anyone who may enters
 * their PIN here and the action goes through once, recorded with their
 * name. The prompt stays open until the approved action is done, so a wrong
 * PIN or someone without the right is answered in place.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { setApprover } from '../lib/api.ts';
import type { ApprovalAsk } from '../lib/api.ts';
import { PinPad } from './pads.tsx';
import { Modal } from './ui.tsx';

export function ApprovalProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ask, setAsk] = useState<ApprovalAsk | null>(null);
  const [pending, setPending] = useState(false);
  const [round, setRound] = useState(0);
  const resolver = useRef<((pin: string | null) => void) | null>(null);

  useEffect(() => {
    setApprover({
      ask: (a) =>
        new Promise<string | null>((resolve) => {
          resolver.current = resolve;
          setPending(false);
          setAsk(a);
          setRound((r) => r + 1);
        }),
      settle: () => {
        resolver.current = null;
        setPending(false);
        setAsk(null);
      },
    });
    return () => setApprover(null);
  }, []);

  const cancel = (): void => {
    resolver.current?.(null);
    resolver.current = null;
    setPending(false);
    setAsk(null);
  };

  return (
    <>
      {children}
      <Modal touch open={ask !== null} onClose={cancel} title="Manager approval" description={ask !== null && !ask.wrong ? ask.message : undefined}>
        {ask !== null && (
          <div className="flex flex-col items-center gap-3 pb-1">
            <div className="flex items-center gap-2 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 text-[12px] text-[var(--ps-ink-2)]">
              <ShieldCheck size={15} className="shrink-0" />
              <span>
                Someone who may <b className="font-semibold text-[var(--ps-ink)]">{ask.label !== '' ? ask.label : 'do this'}</b> enters their PIN. It is recorded with the action.
              </span>
            </div>
            <PinPad
              key={round}
              busy={pending}
              submitLabel="Approve"
              error={ask.wrong ? ask.message : null}
              onSubmit={(pin) => {
                setPending(true);
                const r = resolver.current;
                resolver.current = null;
                r?.(pin);
                return Promise.resolve(null);
              }}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
