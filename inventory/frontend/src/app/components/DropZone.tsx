/** Drop files here or click to choose: a dashed sand panel. */
import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';

export function DropZone({
  icon: Icon,
  title,
  hint,
  accept,
  multiple = false,
  busy = false,
  onFiles,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  busy?: boolean;
  onFiles: (files: File[]) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        'flex w-full flex-col items-center gap-3 rounded-[24px] border-2 border-dashed px-6 py-10 text-center transition-colors disabled:opacity-60',
        over ? 'border-[var(--iv-ink)] bg-[var(--iv-sand)]' : 'border-[var(--iv-sand)] bg-[var(--iv-sand-2)]/60 hover:border-[var(--iv-ink-2)]',
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)]">
        <Icon size={20} aria-hidden />
      </span>
      <span className="text-[15px] font-bold">{busy ? 'Working' : title}</span>
      <span className="text-[13px] text-[var(--iv-ink-2)]">{hint}</span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </button>
  );
}
