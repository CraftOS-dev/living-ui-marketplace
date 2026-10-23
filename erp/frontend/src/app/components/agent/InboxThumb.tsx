/**
 * A picture of an Inbox file: images are fetched with the session (an <img>
 * cannot send it) and shown small; PDFs and other files show their kind.
 */
import { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, File as FileIcon } from 'lucide-react';
import { cn, getPbClient } from '../../../kit/index.ts';

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const SHEET = /\.(csv|xlsx?|ofx|qif|txt)$/i;

export function isImageName(name: string): boolean {
  return IMAGE.test(name);
}

/** An inbox file's image as an object URL (null until loaded, or when it is not an image). */
export function useInboxImage(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (id === null) return;
    let gone = false;
    let made: string | null = null;
    const pb = getPbClient().pb;
    const u = new URL(pb.buildURL('/api/ops/inbox/get'));
    u.searchParams.set('file', id);
    fetch(u.toString(), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {}, credentials: 'include' })
      .then(async (res) => {
        if (!res.ok || gone) return;
        made = URL.createObjectURL(await res.blob());
        if (gone) URL.revokeObjectURL(made);
        else setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [id]);
  return url;
}

export function InboxThumb({ id, name, isPdf, size = 56, className }: { id: string; name: string; isPdf: boolean; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const url = useInboxImage(isImageName(name) ? id : null);
  if (url !== null) return <img src={url} alt="" style={{ width: size, height: size }} className={cn('shrink-0 rounded-[14px] bg-[var(--erp-card)] object-cover ring-1 ring-[var(--erp-line)]', className)} />;
  const Icon = isPdf ? FileText : SHEET.test(name) ? FileSpreadsheet : FileIcon;
  return (
    <span style={{ width: size, height: size }} className={cn('flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-[14px] bg-[var(--erp-card)] text-[var(--erp-ink-2)]', className)}>
      <Icon size={Math.round(size * 0.36)} aria-hidden />
      <span className="text-[12px] font-bold uppercase leading-none">{(name.split('.').pop() ?? '').slice(0, 4)}</span>
    </span>
  );
}
