/** A switch with its words beside it (the kernel Toggle is the bare switch); tapping the words flips it too. */
import { Toggle } from '../ui.tsx';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="flex min-h-8 min-w-0 items-center gap-2.5">
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <button type="button" tabIndex={-1} disabled={disabled} onClick={() => onChange(!checked)} className="hr-wrap min-w-0 text-left text-[13px] leading-5 text-[var(--hr-ink)] disabled:cursor-default disabled:opacity-50">
        {label}
      </button>
    </div>
  );
}
