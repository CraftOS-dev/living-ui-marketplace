/**
 * A platform's mark: the brand's published mark from Simple Icons, in its own
 * color, where one exists; otherwise the platform's initial (never a drawn
 * logo). Direct (your own sales: chat, social, in person) is a shopping
 * bag, on the same tile as the platforms.
 */
import { siEbay, siEtsy, siRakuten, siShopee, siShopify, siTiktok, siWoocommerce } from 'simple-icons';
import { ShoppingBag, Store } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import type { PlatformId } from '../lib/types.ts';

interface Mark {
  path: string;
  hex: string;
}

const MARKS: Partial<Record<PlatformId, Mark>> = {
  shopify: siShopify,
  woocommerce: siWoocommerce,
  shopee: siShopee,
  tiktok_shop: siTiktok,
  ebay: siEbay,
  etsy: siEtsy,
  rakuten: siRakuten,
};

export const PLATFORM_NAME: Record<PlatformId, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  shopee: 'Shopee',
  lazada: 'Lazada',
  tiktok_shop: 'TikTok Shop',
  amazon: 'Amazon',
  ebay: 'eBay',
  etsy: 'Etsy',
  tokopedia: 'Tokopedia',
  zalora: 'Zalora',
  rakuten: 'Rakuten Ichiba',
  yahoo_shopping: 'Yahoo! Shopping',
  walmart: 'Walmart',
  mercado_libre: 'Mercado Libre',
  direct: 'Direct',
  other: 'Other',
};

function dark(hex: string): boolean {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
}

/** The mark on a round tile. */
export function PlatformMark({ platform, size = 28, className, onCard = true }: { platform: PlatformId | string; size?: number; className?: string; onCard?: boolean }): React.JSX.Element {
  const id = platform as PlatformId;
  const mark = MARKS[id];
  const glyph = Math.round(size * 0.56);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', onCard ? 'bg-[var(--so-tile)]' : 'bg-[var(--so-card)]', className)}
    >
      {mark !== undefined ? (
        <svg viewBox="0 0 24 24" width={glyph} height={glyph} fill={dark(mark.hex) ? 'var(--so-ink)' : '#' + mark.hex}>
          <path d={mark.path} />
        </svg>
      ) : id === 'direct' ? (
        <ShoppingBag size={glyph} strokeWidth={2} className="text-[var(--so-ink)]" />
      ) : id === 'other' ? (
        <Store size={glyph} strokeWidth={2} className="text-[var(--so-ink)]" />
      ) : (
        <span className="text-[12px] font-bold leading-none text-[var(--so-ink)]" style={{ fontSize: Math.max(10, Math.round(size * 0.42)) }}>
          {(PLATFORM_NAME[id] ?? String(platform)).charAt(0)}
        </span>
      )}
    </span>
  );
}

/** A shop chip: mark and name, as in a table's Platform column. */
export function ShopChip({ name, platform, className }: { name: string; platform: PlatformId | string; className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-[var(--so-tile)] pl-1 pr-2.5 text-[12px] font-semibold text-[var(--so-ink)]', className)}>
      <PlatformMark platform={platform} size={20} onCard={false} />
      <span className="truncate">{name}</span>
    </span>
  );
}
