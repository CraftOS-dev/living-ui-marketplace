/**
 * Small drawings for empty states and the sidebar, in the theme's own
 * colors (lib/themeColors.ts scenePalette): a sprout in a pot, a lantern by
 * a bush, a mailbox, an open book, a mountain with a flag, a path between
 * hills, a moon over hills, a cabin, a compass, a tree. Decoration only:
 * they never carry information, so they are hidden from screen readers.
 */
import { useMemo } from 'react';
import { scenePalette, usePalette } from '../lib/themeColors.ts';

export type VignetteKind = 'sprout' | 'lantern' | 'mailbox' | 'book' | 'mountain' | 'path' | 'moon' | 'cabin' | 'compass' | 'tree' | 'grove';

export function Vignette({ kind, size = 92, className }: { kind: VignetteKind; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const pal = usePalette();
  const c = useMemo(() => scenePalette(pal, 'afternoon', 'summer'), [pal]);
  const ground = <ellipse cx="50" cy="88" rx="38" ry="6" fill={c.meadow} opacity="0.7" />;
  let art: React.JSX.Element;
  switch (kind) {
    case 'sprout':
      art = (
        <>
          {ground}
          <path d="M34 66h32l-4 20H38z" fill={c.roof} />
          <rect x="31" y="61" width="38" height="8" rx="3" fill={c.trunk} />
          <path d="M50 61V44" stroke={c.treeDark} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M50 50c-10-1-16-7-17-16 10 0 16 6 17 16Z" fill={c.tree} />
          <path d="M50 46c2-10 9-15 18-15-1 10-8 15-18 15Z" fill={c.treeLight} />
        </>
      );
      break;
    case 'lantern':
    case 'grove':
      art = (
        <>
          <ellipse cx="50" cy="90" rx="44" ry="7" fill={c.near} />
          <circle cx="26" cy="74" r="13" fill={c.tree} />
          <circle cx="37" cy="78" r="10" fill={c.treeLight} />
          <circle cx="72" cy="76" r="11" fill={c.treeDark} />
          <rect x="57" y="34" width="3" height="52" rx="1.5" fill={c.trunk} />
          <path d="M58.5 34h10" stroke={c.trunk} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="68" cy="48" r="11" fill={c.sun} opacity="0.3" />
          <rect x="63" y="40" width="10" height="14" rx="3" fill={c.window} stroke={c.trunk} strokeWidth="1.6" />
          <path d="M65 40l3-4 3 4" fill={c.trunk} />
          {kind === 'grove' && (
            <>
              <circle cx="20" cy="66" r="1.6" fill={c.blossom} />
              <circle cx="31" cy="71" r="1.6" fill={c.blossom} />
              <circle cx="76" cy="70" r="1.6" fill={c.blossom} />
            </>
          )}
        </>
      );
      break;
    case 'mailbox':
      art = (
        <>
          {ground}
          <rect x="47" y="52" width="5" height="34" rx="2" fill={c.trunk} />
          <path d="M30 44a12 12 0 0 1 12-12h20a10 10 0 0 1 10 10v16H30z" fill={c.roof} />
          <path d="M30 44a12 12 0 0 1 24 0v14H30z" fill={c.wall} opacity="0.35" />
          <rect x="66" y="30" width="3" height="16" rx="1" fill={c.trunk} />
          <path d="M69 30h8v6h-8z" fill={c.blossom} />
          <path d="M36 48h12" stroke={c.trunk} strokeWidth="2" strokeLinecap="round" />
          <circle cx="24" cy="80" r="7" fill={c.tree} />
          <circle cx="78" cy="82" r="5" fill={c.treeLight} />
        </>
      );
      break;
    case 'book':
      art = (
        <>
          {ground}
          <path d="M50 40c-8-6-18-7-28-5v42c10-2 20-1 28 5Z" fill={c.wall} stroke={c.trunk} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M50 40c8-6 18-7 28-5v42c-10-2-20-1-28 5Z" fill={c.wall} stroke={c.trunk} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M28 46h16M28 53h16M28 60h12M56 46h16M56 53h16M56 60h10" stroke={c.path} strokeWidth="2" strokeLinecap="round" />
          <path d="M66 35v18l4-3 4 3V35" fill={c.roof} />
          <path d="M60 30c4-6 10-8 16-6-3 5-9 8-16 6Z" fill={c.treeLight} />
        </>
      );
      break;
    case 'mountain':
      art = (
        <>
          <path d="M8 88l26-38 12 14 16-30 30 54Z" fill={c.mid} />
          <path d="M62 34l8 16-6-3-5 5-4-6Z" fill={c.snow} />
          <path d="M8 88l26-38 10 12-14 26Z" fill={c.far} opacity="0.8" />
          <path d="M62 34V16" stroke={c.trunk} strokeWidth="2" strokeLinecap="round" />
          <path d="M62 16h12l-3 4 3 4H62z" fill={c.roof} />
          {ground}
        </>
      );
      break;
    case 'path':
      art = (
        <>
          <path d="M0 70c20-12 40-12 56-4s30 6 44-2v26H0z" fill={c.mid} />
          <path d="M0 80c24-8 48-6 64 2s26 4 36 0v18H0z" fill={c.near} />
          <path d="M38 96c4-10 10-16 22-22 8-4 12-8 14-14" stroke={c.path} strokeWidth="7" strokeLinecap="round" fill="none" />
          <path d="M20 64l6-14 6 14z" fill={c.treeDark} />
          <path d="M80 58l5-12 5 12z" fill={c.tree} />
          <circle cx="72" cy="30" r="9" fill={c.sun} />
        </>
      );
      break;
    case 'moon':
      art = (
        <>
          <circle cx="62" cy="32" r="14" fill={c.sun} />
          <circle cx="68" cy="27" r="12" fill={c.skyTop} />
          <circle cx="26" cy="22" r="1.6" fill={c.sun} />
          <circle cx="40" cy="36" r="1.2" fill={c.sun} />
          <circle cx="82" cy="52" r="1.3" fill={c.sun} />
          <path d="M0 78c18-14 36-14 52-6s32 4 48-6v32H0z" fill={c.mid} />
          <path d="M0 86c26-8 46-6 62 0s26 4 38-2v20H0z" fill={c.near} />
        </>
      );
      break;
    case 'cabin':
      art = (
        <>
          {ground}
          <rect x="30" y="52" width="40" height="32" rx="2" fill={c.wall} />
          <path d="M24 54l26-22 26 22Z" fill={c.roof} />
          <rect x="45" y="66" width="10" height="18" rx="1.5" fill={c.trunk} />
          <rect x="34" y="60" width="8" height="8" rx="1.5" fill={c.window} />
          <rect x="58" y="60" width="8" height="8" rx="1.5" fill={c.window} />
          <rect x="60" y="34" width="6" height="12" fill={c.trunk} />
          <circle cx="18" cy="76" r="9" fill={c.tree} />
          <circle cx="84" cy="78" r="7" fill={c.treeLight} />
        </>
      );
      break;
    case 'compass':
      art = (
        <>
          {ground}
          <circle cx="50" cy="52" r="26" fill={c.wall} stroke={c.trunk} strokeWidth="2" />
          <circle cx="50" cy="52" r="20" fill="none" stroke={c.path} strokeWidth="1.4" strokeDasharray="2 4" />
          <path d="M50 32l6 20-6 20-6-20Z" fill={c.roof} />
          <path d="M50 52l6 0-6 20-6-20Z" fill={c.treeDark} />
          <circle cx="50" cy="52" r="3" fill={c.trunk} />
        </>
      );
      break;
    default:
      art = (
        <>
          <path d="M0 84c22-10 40-10 54-4s30 6 46-2v22H0z" fill={c.near} />
          <rect x="47" y="52" width="6" height="30" rx="2" fill={c.trunk} />
          <circle cx="50" cy="42" r="18" fill={c.tree} />
          <circle cx="38" cy="50" r="12" fill={c.treeDark} />
          <circle cx="62" cy="50" r="12" fill={c.treeLight} />
        </>
      );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={className}>
      {art}
    </svg>
  );
}
