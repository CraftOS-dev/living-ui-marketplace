/**
 * The kit's Switch shows its label as plain text, so screen readers hear an unnamed switch. This
 * wraps it (the kit is system-owned) with a real <label> tied to the switch, which names it and keeps
 * click-the-words working.
 */
import { useId } from 'react';
import { Switch } from '../../kit/index.ts';

export function NamedSwitch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean }): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled ?? false} />
      <label htmlFor={id} className="cursor-pointer select-none text-sm font-medium">
        {label}
      </label>
    </div>
  );
}
