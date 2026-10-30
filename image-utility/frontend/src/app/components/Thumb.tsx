/** An image thumbnail on the transparency checkerboard, fitted inside its box. */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { fileUrl } from '../lib/api.ts';
import type { ImageRec } from '../lib/types.ts';

export function Thumb({ image, className, fit = 'contain' }: { image: Pick<ImageRec, 'thumb_url' | 'preview_url' | 'name' | 'status'>; className?: string; fit?: 'contain' | 'cover' }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const src = image.thumb_url !== '' ? image.thumb_url : image.preview_url;
  return (
    <div className={cn('iu-checker iu-checker-sm relative flex items-center justify-center overflow-hidden', className)}>
      {src !== '' && !broken ? (
        <img src={fileUrl(src)} alt={image.name} loading="lazy" draggable={false} onError={() => setBroken(true)} className={cn('size-full', fit === 'cover' ? 'object-cover' : 'object-contain')} />
      ) : (
        <span className="flex flex-col items-center gap-1 text-[12px] text-[var(--iu-muted)]">
          <ImageOff size={16} aria-hidden />
          {image.status === 'pending' ? 'Waiting for the engine' : 'No preview'}
        </span>
      )}
    </div>
  );
}
