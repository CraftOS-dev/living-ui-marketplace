/** Decision context for the kernel's own approval kind: a new bank account. */
import { Fact } from '../../components/ui.tsx';
import type { ApprovalViewProps } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';

export function BankApprovalView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] ?? {}) as { bank_name?: string; number_masked?: string; label?: string; holder?: string; split?: { kind?: string; value?: number } };
  const split = p.split?.kind === 'percent' ? `${p.split.value ?? 0}%` : p.split?.kind === 'fixed' ? String(p.split.value ?? '') : t('bank.split.rest');
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Fact label={t('bank.bank_name')}>{p.bank_name ?? ''}</Fact>
      <Fact label={t('bank.number')} mono>
        {p.number_masked ?? ''}
      </Fact>
      <Fact label={t('bank.label')}>{p.label ?? ''}</Fact>
      <Fact label={t('bank.split')}>{split}</Fact>
    </div>
  );
}
