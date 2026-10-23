/**
 * Modules switched on and off. A module that is off vanishes from the menu,
 * Home and search for everyone; its records stay. Accounting, Banking and
 * Reports always run. Manufacturing needs Inventory; Payroll needs People.
 */
import { useState } from 'react';
import { toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { refreshMe } from '../../lib/session.ts';
import type { CompanySettings } from '../../lib/types/settings.ts';
import type { Module } from '../../lib/types.ts';
import { MODULES } from '../../lib/types.ts';
import { cn } from '../../../kit/index.ts';
import { Card, Notice, Toggle } from '../ui.tsx';
import { MODULE_INFO } from './shared.tsx';

const ALWAYS: Module[] = ['accounting', 'banking', 'reports'];
const NEEDS: Partial<Record<Module, Module>> = { manufacturing: 'inventory', payroll: 'people' };

export function ModulesSection({ s, onSaved }: { s: CompanySettings; onSaved: (s: CompanySettings) => void }): React.JSX.Element {
  const [busy, setBusy] = useState<Module | null>(null);
  const isOn = (m: Module): boolean => ALWAYS.includes(m) || s.modules[m] !== false;

  const flip = async (m: Module, on: boolean): Promise<void> => {
    const change: Partial<Record<Module, boolean>> = { [m]: on };
    let also = '';
    if (on && NEEDS[m] !== undefined && !isOn(NEEDS[m])) {
      change[NEEDS[m]] = true;
      also = ` and ${MODULE_INFO[NEEDS[m]].label}`;
    }
    if (!on) {
      for (const [child, parent] of Object.entries(NEEDS) as [Module, Module][]) {
        if (parent === m && isOn(child)) {
          change[child] = false;
          also = ` and ${MODULE_INFO[child].label}`;
        }
      }
    }
    setBusy(m);
    try {
      const next = await op<CompanySettings>('settings.modules', { modules: change });
      onSaved(next);
      toast.success(`${MODULE_INFO[m].label}${also} switched ${on ? 'on' : 'off'}`);
      void refreshMe();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="neutral">A module that is off disappears from the menu, Home and search for everyone. Its records stay and come back when it is on again.</Notice>
      <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2 @min-[1300px]:grid-cols-3">
        {MODULES.map((m, i) => {
          const info = MODULE_INFO[m];
          const Icon = info.icon;
          const always = ALWAYS.includes(m);
          const on = isOn(m);
          const need = NEEDS[m];
          return (
            <Card key={m} delay={Math.min(5, i + 1)} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <span className={cn('flex size-11 items-center justify-center rounded-full', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-accent)]' : 'bg-[var(--erp-row)] text-[var(--erp-muted)]')}>
                  <Icon size={20} aria-hidden />
                </span>
                {always ? (
                  <span className="rounded-full bg-[var(--erp-row)] px-3 py-1 text-[12px] font-semibold text-[var(--erp-ink-2)]">Always on</span>
                ) : (
                  <Toggle checked={on} label={`${info.label} ${on ? 'on' : 'off'}`} disabled={busy !== null} onChange={(v) => void flip(m, v)} />
                )}
              </div>
              <p className="mt-4 text-[15px] font-bold">{info.label}</p>
              <p className="mt-1 text-[13px] leading-5 text-[var(--erp-muted)]">{info.text}</p>
              {need !== undefined && <p className="mt-2 text-[12px] font-semibold text-[var(--erp-ink-2)]">Needs {MODULE_INFO[need].label}</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
