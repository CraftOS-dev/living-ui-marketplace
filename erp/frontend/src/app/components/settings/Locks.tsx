/**
 * Lock dates: "closed through" (only full Accounting rights still post on
 * or before it) and "locked through" (nobody posts; only an owner moves it
 * back). Postings dated in a locked period move to the first open day.
 */
import { useEffect, useState } from 'react';
import { Lock, LockKeyhole } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { useMe } from '../../lib/me.ts';
import type { CompanySettings } from '../../lib/types/settings.ts';
import { DateField } from '../pickers.tsx';
import { Card, Notice } from '../ui.tsx';
import { SaveBar } from './shared.tsx';

export function LocksSection({ s, onSaved }: { s: CompanySettings; onSaved: (s: CompanySettings) => void }): React.JSX.Element {
  const me = useMe();
  const [soft, setSoft] = useState(s.soft_lock_date);
  const [hard, setHard] = useState(s.hard_lock_date);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setSoft(s.soft_lock_date);
    setHard(s.hard_lock_date);
  }, [s.soft_lock_date, s.hard_lock_date]);
  const dirty = soft !== s.soft_lock_date || hard !== s.hard_lock_date;
  const hardBack = s.hard_lock_date !== '' && (hard === '' || hard < s.hard_lock_date);
  const blocked = hardBack && !me.owner;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const p: Record<string, string> = {};
      if (soft !== s.soft_lock_date) p['soft_lock_date'] = soft;
      if (hard !== s.hard_lock_date) p['hard_lock_date'] = hard;
      const next = await op<CompanySettings>('settings.locks', p);
      onSaved(next);
      toast.success('Lock dates saved');
    } catch {
      /* shown */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[1100px]:grid-cols-2">
        <LockCard
          icon={Lock}
          title="Closed through"
          text="On and before this day, only people with full Accounting rights post. Use it when a month is reviewed."
          value={soft}
          onChange={setSoft}
          saved={s.soft_lock_date}
          delay={1}
        />
        <LockCard
          icon={LockKeyhole}
          title="Locked through"
          text="Nobody posts on or before this day, not even administrators. Use it once a period is filed."
          value={hard}
          onChange={setHard}
          saved={s.hard_lock_date}
          delay={2}
          dark
        />
      </div>
      {blocked && <Notice tone="warn">Only an owner moves the locked-through date back.</Notice>}
      <Notice>Something dated in a locked period is posted on the first open day instead, with its own date kept on the document.</Notice>
      <SaveBar dirty={dirty} saving={saving} onSave={() => (blocked ? undefined : void save())} onDiscard={() => {
        setSoft(s.soft_lock_date);
        setHard(s.hard_lock_date);
      }} label="Save lock dates" />
    </div>
  );
}

function LockCard({ icon: Icon, title, text, value, onChange, saved, delay, dark = false }: { icon: typeof Lock; title: string; text: string; value: string; onChange: (v: string) => void; saved: string; delay: number; dark?: boolean | undefined }): React.JSX.Element {
  return (
    <Card delay={delay} tone={dark ? 'sand' : 'white'}>
      <div className="flex items-start gap-3">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', saved !== '' ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-accent)]' : 'bg-[var(--erp-row)] text-[var(--erp-muted)]')}>
          <Icon size={19} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold">{title}</p>
          <p className="num text-[13px] font-semibold text-[var(--erp-ink-2)]">{saved !== '' ? dayLabel(saved) : 'Not set'}</p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-[var(--erp-muted)]">{text}</p>
      <div className="mt-4">
        <DateField value={value} onChange={onChange} ariaLabel={title} optional placeholder="Not set" />
      </div>
    </Card>
  );
}
