/**
 * A company's logo, the one component every screen uses for it:
 *
 *   1. the company's own logo (`logoUrl`, the logo_url company reads carry:
 *      an uploaded image, served as a protected file, lib/images.ts);
 *   2. else the public favicon of its domain (Google's favicon service,
 *      128 px), shown only when a real icon loads (the service answers an
 *      unknown domain with a 16 px globe, which counts as no logo);
 *   3. else the letter avatar.
 *
 * Results are remembered per url and per domain for the session, so lists
 * and pages never flash between them. `LogoPicker` is the same logo as a
 * button: click to choose an image or drop one on it (people who may edit).
 */
import { useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { LOGO_ACCEPT, useImage } from '../../lib/images.ts';
import { Avatar } from '../ui.tsx';

const known = new Map<string, boolean>();

function srcOf(domain: string): string {
  return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=128';
}

function radiusOf(size: number): number {
  return size >= 40 ? 10 : 6;
}

function Favicon({ name, domain, size, className }: { name: string; domain: string; size: number; className?: string | undefined }): React.JSX.Element {
  const d = domain.trim().toLowerCase();
  const [ok, setOk] = useState<boolean | undefined>(() => (d === '' ? false : known.get(d)));
  if (d === '' || ok === false) return <Avatar name={name} size={size} square />;
  return (
    <span aria-hidden className={cn('relative block shrink-0 overflow-hidden border border-[var(--vo-line)] bg-white', className)} style={{ width: size, height: size, borderRadius: radiusOf(size) }}>
      {ok !== true && (
        <span className="absolute inset-[-1px]">
          <Avatar name={name} size={size} square />
        </span>
      )}
      <img
        src={srcOf(d)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={(e) => {
          const real = e.currentTarget.naturalWidth >= 32;
          known.set(d, real);
          setOk(real);
        }}
        onError={() => {
          known.set(d, false);
          setOk(false);
        }}
        className={cn('block size-full object-contain p-[12%] transition-opacity duration-150', ok === true ? 'opacity-100' : 'opacity-0')}
      />
    </span>
  );
}

export function CompanyLogo({ name, domain, logoUrl = '', size = 40, className }: { name: string; domain: string; logoUrl?: string | undefined; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const own = useImage(logoUrl);
  if (logoUrl !== '' && own !== null) {
    return (
      <span aria-hidden className={cn('relative block shrink-0 overflow-hidden border border-[var(--vo-line)] bg-white', className)} style={{ width: size, height: size, borderRadius: radiusOf(size) }}>
        {own !== undefined && <img src={own} alt="" width={size} height={size} draggable={false} className="block size-full object-contain p-[8%]" />}
      </span>
    );
  }
  return <Favicon key={domain} name={name} domain={domain} size={size} className={className} />;
}

/**
 * The logo as a button for people who may change it: a click opens the file
 * chooser, an image dropped on it is taken too; `onFile` gets the image.
 */
export function LogoPicker({ name, domain, logoUrl, size = 64, onFile, label = 'Change logo', busy }: { name: string; domain: string; logoUrl: string; size?: number | undefined; onFile: (file: File) => void; label?: string | undefined; busy?: boolean | undefined }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const r = radiusOf(size);
  return (
    <>
      <button
        type="button"
        data-vo-drop=""
        title={label}
        aria-label={label}
        aria-busy={busy === true}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f !== undefined) onFile(f);
        }}
        className="vo-focus group relative block shrink-0 cursor-pointer"
        style={{ width: size, height: size, borderRadius: r }}
      >
        <CompanyLogo name={name} domain={domain} logoUrl={logoUrl} size={size} />
        <span
          aria-hidden
          className={cn('absolute inset-0 flex items-center justify-center text-[var(--vo-on-ink)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100', (over || busy === true) && 'opacity-100')}
          style={{ borderRadius: r, background: 'color-mix(in srgb, var(--vo-ink) 58%, transparent)' }}
        >
          <ImageUp size={size >= 56 ? 20 : 16} strokeWidth={1.9} className={busy === true ? 'vo-pulse' : undefined} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={LOGO_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f !== undefined) onFile(f);
        }}
      />
    </>
  );
}
