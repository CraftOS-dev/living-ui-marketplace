/**
 * Add or change an account in the chart: what kind it is (in plain words,
 * the accounting word beside it), its code and name, the report line it
 * falls under, an optional parent, and a description.
 */
import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { errMessage, op } from '../../lib/api.ts';
import type { Account, AccountType } from '../../lib/types/books.ts';
import { TYPE_WORDS, subtypeLabel } from '../money/labels.ts';
import { MoreOptions } from '../money/Step.tsx';
import { Field, Modal, PillButton, PillSelect, ToggleRow, softArea, softInput } from '../ui.tsx';

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export function AccountModal({
  open,
  onClose,
  account,
  accounts,
  subtypes,
  initialType,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  account?: Account | undefined;
  accounts: Account[];
  subtypes: Record<AccountType, string[]>;
  initialType?: AccountType | undefined;
  onDone: (a: Account) => void;
}): React.JSX.Element {
  const editing = account !== undefined;
  const [type, setType] = useState<AccountType>('expense');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState('');
  const [parent, setParent] = useState('');
  const [description, setDescription] = useState('');
  const [archived, setArchived] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = account?.type ?? initialType ?? 'expense';
    setType(t);
    setCode(account?.code ?? '');
    setName(account?.name ?? '');
    setSubtype(account?.subtype ?? subtypes[t]?.[t === 'asset' ? 4 : t === 'liability' ? 1 : t === 'expense' ? 1 : 0] ?? '');
    setParent(account?.parent ?? '');
    setDescription(account?.description ?? '');
    setArchived(account?.archived ?? false);
    setMore(account !== undefined && (account.parent !== '' || account.description !== ''));
    setError(null);
  }, [open, account, initialType, subtypes]);

  const changeType = (t: AccountType): void => {
    setType(t);
    const list = subtypes[t] ?? [];
    if (!list.includes(subtype)) setSubtype(list[t === 'asset' ? 4 : t === 'liability' ? 1 : t === 'expense' ? 1 : 0] ?? list[0] ?? '');
    setParent('');
  };

  // A sensible next code: one after the highest code of that type.
  useEffect(() => {
    if (!open || editing || code !== '') return;
    const codes = accounts.filter((a) => a.type === type && /^\d+$/.test(a.code)).map((a) => Number(a.code));
    if (codes.length === 0) return;
    let next = Math.max(...codes) + 10;
    while (accounts.some((a) => a.code === String(next))) next += 1;
    setCode(String(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const params = { code: code.trim(), name: name.trim(), type, subtype, parent, description: description.trim() };
      const a = editing ? await op<Account>('accounts.update', { account: account.id, ...params, ...(account.type === type ? { type: undefined } : {}), archived }, { quiet: true }) : await op<Account>('accounts.add', params, { quiet: true });
      toast.success(editing ? 'Saved' : `${a.code} ${a.name} added`);
      onClose();
      onDone(a);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const parents = accounts.filter((a) => a.type === type && a.id !== account?.id && !a.archived);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Change ${account.code} ${account.name}` : 'Add an account'}
      description={editing ? undefined : 'A new place in the books to post to.'}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={editing ? Check : Plus} dot loading={busy} disabled={code.trim() === '' || name.trim() === ''} onClick={() => void save()}>
            {editing ? 'Save' : 'Add account'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <PillSelect
          soft
          label="Kind"
          value={type}
          onChange={(v) => changeType(v as AccountType)}
          disabled={editing && account.system_key !== ''}
          options={TYPES.map((t) => ({ value: t, label: `${TYPE_WORDS[t]?.plain ?? t} (${TYPE_WORDS[t]?.term ?? t})` }))}
        />
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
          <Field label="Code">
            <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} aria-label="Code" className={`${softInput} num`} />
          </Field>
          <Field label="Name" error={error}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Name" className={softInput} autoFocus={!editing} />
          </Field>
        </div>
        <PillSelect soft label="Shows in the reports as" value={subtype} onChange={setSubtype} options={(subtypes[type] ?? []).map((s) => ({ value: s, label: subtypeLabel(s) }))} />
        <MoreOptions open={more} onToggle={() => setMore((m) => !m)}>
          <PillSelect soft label="Under another account" value={parent} onChange={setParent} options={[{ value: '', label: 'None' }, ...parents.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))]} />
          <Field label="Description" optional>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} aria-label="Description" className={softArea} />
          </Field>
        </MoreOptions>
        {editing && account.system_key === '' && <ToggleRow title="Archived" text="Only an account with a zero balance can be archived" checked={archived} onChange={setArchived} />}
      </div>
    </Modal>
  );
}
