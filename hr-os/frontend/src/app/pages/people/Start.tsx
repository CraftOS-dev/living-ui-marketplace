/**
 * First steps the kernel offers every page:
 *
 *   <FirstPeople />  "Add your first people": Hire and Import a spreadsheet.
 *                    The empty People page leads with it; Home's setup guide
 *                    and any module page with nobody to show use it too.
 *   <NotLinked />    A sign-in with no employee record. An administrator can
 *                    link themselves to a person or add themselves as one;
 *                    anyone else is told who links it.
 *   <HiredNext />    On a new person's profile after the hire: invite them,
 *                    start onboarding, add the bank account, set the pay.
 */
import { useState } from 'react';
import { FileSpreadsheet, Landmark, Link2, ListChecks, Mail, UserPlus, UserRound, Wallet, X } from 'lucide-react';
import { Button, Empty, IconButton, Panel, Picker } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, can, refreshMe, useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { changed } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { usePeopleItems } from './RecordDialogs.tsx';

/** "Add your first people" with the two ways in. `inline` draws it as a panel row instead of a centred empty state. */
export function FirstPeople({ inline, className }: { inline?: boolean | undefined; className?: string | undefined }): React.JSX.Element | null {
  const me = useMe();
  if (!can(me, 'people', 'edit')) return null;
  const actions = (
    <>
      <Button variant="primary" icon={UserPlus} onClick={() => navigate('/people/new')}>
        {t('start.hire')}
      </Button>
      <Button icon={FileSpreadsheet} onClick={() => navigate('/settings/data', { kind: 'people' })}>
        {t('start.import')}
      </Button>
    </>
  );
  if (inline === true)
    return (
      <div className={className}>
        <div className="text-[14px] font-semibold">{t('start.first_people')}</div>
        <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{t('start.first_people_text')}</p>
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      </div>
    );
  return (
    <Empty icon={UserPlus} title={t('start.first_people')} action={actions} className={className}>
      {t('start.first_people_text')}
    </Empty>
  );
}

/** The signed-in person has no employee record: link it, add it, or say who can. */
export function NotLinked({ className }: { className?: string | undefined }): React.JSX.Element {
  const me = useMe();
  const admin = can(me, 'admin', 'edit');
  const hire = can(me, 'people', 'edit');
  const people = usePeopleItems('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  if (!admin)
    return (
      <Empty icon={UserRound} title={t('start.not_linked')} className={className}>
        {t('start.not_linked_ask')}
      </Empty>
    );
  const link = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('members.update', { member: me.member.id, employee: pick }, { pin: { title: t('start.link_me') } });
      await refreshMe();
      changed('members', 'employees');
      toast.success(t('start.linked'));
    } catch {
      /* the toast says why */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Empty
      icon={UserRound}
      title={t('start.not_linked')}
      className={className}
      action={
        <div className="flex w-full max-w-sm flex-col gap-2">
          {people.length > 0 && (
            <div className="flex items-center gap-2">
              <Picker value={pick} onChange={setPick} items={people} label={t('start.link_who')} placeholder={t('start.link_who')} className="min-w-0 flex-1" />
              <Button icon={Link2} busy={busy} disabled={pick === ''} onClick={() => void link()}>
                {t('start.link_me')}
              </Button>
            </div>
          )}
          {hire && (
            <Button variant={people.length > 0 ? 'default' : 'primary'} icon={UserPlus} onClick={() => navigate('/people/new', { self: '1' })}>
              {t('start.add_me')}
            </Button>
          )}
        </div>
      }
    >
      {t('start.not_linked_admin')}
    </Empty>
  );
}

/** After a hire: what is left to do for the new person, each one step away. */
export function HiredNext({ employee, name, email, hasPay, onPay }: { employee: string; name: string; email: string; hasPay: boolean; onPay: () => void }): React.JSX.Element {
  const me = useMe();
  const steps: { key: string; icon: typeof Mail; label: string; run: () => void }[] = [];
  if (can(me, 'admin', 'edit')) steps.push({ key: 'invite', icon: Mail, label: t('start.next_invite', { name }), run: () => navigate('/settings/members', { invite: '1', name, email, employee }) });
  if (allowed(me, 'people:view|team')) steps.push({ key: 'onboard', icon: ListChecks, label: t('start.next_onboard'), run: () => navigate('/lifecycle/checklists') });
  steps.push({ key: 'bank', icon: Landmark, label: t('start.next_bank'), run: () => setQuery({ tab: 'bank', hired: undefined }) });
  if (!hasPay && can(me, 'payroll', 'edit')) steps.push({ key: 'pay', icon: Wallet, label: t('start.next_pay'), run: onPay });
  return (
    <Panel label={t('start.next_title')} className="mb-3" aside={<IconButton icon={X} label={t('ui.close')} size={26} onClick={() => setQuery({ hired: undefined })} />}>
      <div className="flex flex-wrap gap-2 pt-1">
        {steps.map((s) => (
          <Button key={s.key} icon={s.icon} onClick={s.run}>
            {s.label}
          </Button>
        ))}
      </div>
    </Panel>
  );
}
