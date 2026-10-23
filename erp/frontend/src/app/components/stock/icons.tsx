/**
 * The line icons an item category can wear. The server accepts exactly these
 * names (pb_hooks/lib_items.js ICONS; keep both lists in step), and the item
 * thumbnail built on them: the photo when there is one, else the category
 * icon on a soft tile.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Apple,
  Baby,
  Bike,
  Book,
  Box,
  Boxes,
  Briefcase,
  Cable,
  Camera,
  Car,
  Coffee,
  Cog,
  Cpu,
  Dog,
  Droplet,
  Flame,
  FlaskConical,
  Flower,
  Gamepad,
  Gem,
  Gift,
  GraduationCap,
  Hammer,
  Headphones,
  HeartPulse,
  Layers,
  Leaf,
  Lightbulb,
  Monitor,
  Music,
  Package,
  Paintbrush,
  Pencil,
  Pill,
  Plug,
  Printer,
  Scissors,
  Shield,
  Shirt,
  ShoppingBag,
  Smartphone,
  Snowflake,
  Sofa,
  Sparkles,
  Tag,
  Tags,
  Truck,
  Utensils,
  Watch,
  Wrench,
} from 'lucide-react';
import { cn, getPbClient } from '../../../kit/index.ts';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  package: Package,
  box: Box,
  boxes: Boxes,
  briefcase: Briefcase,
  shirt: Shirt,
  coffee: Coffee,
  utensils: Utensils,
  apple: Apple,
  wrench: Wrench,
  hammer: Hammer,
  cpu: Cpu,
  monitor: Monitor,
  smartphone: Smartphone,
  cable: Cable,
  plug: Plug,
  lightbulb: Lightbulb,
  paintbrush: Paintbrush,
  scissors: Scissors,
  book: Book,
  pencil: Pencil,
  printer: Printer,
  sofa: Sofa,
  car: Car,
  truck: Truck,
  bike: Bike,
  pill: Pill,
  'heart-pulse': HeartPulse,
  'flask-conical': FlaskConical,
  leaf: Leaf,
  flower: Flower,
  gem: Gem,
  watch: Watch,
  camera: Camera,
  headphones: Headphones,
  gamepad: Gamepad,
  gift: Gift,
  'shopping-bag': ShoppingBag,
  tag: Tag,
  tags: Tags,
  layers: Layers,
  cog: Cog,
  droplet: Droplet,
  flame: Flame,
  snowflake: Snowflake,
  sparkles: Sparkles,
  shield: Shield,
  'graduation-cap': GraduationCap,
  music: Music,
  baby: Baby,
  dog: Dog,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

export function iconOf(name: string | null | undefined): LucideIcon {
  return (name !== null && name !== undefined ? CATEGORY_ICONS[name] : undefined) ?? Package;
}

/**
 * An item photo's address. The server gives a path ('/api/files/items/...');
 * `thumb` asks for one of the sizes it keeps ('96x96', '480x480').
 */
export function photoSrc(path: string, thumb?: '96x96' | '480x480' | undefined): string | null {
  if (path === '') return null;
  const url = getPbClient().pb.buildURL(path);
  return thumb !== undefined ? `${url}?thumb=${thumb}` : url;
}

/** An item's photo, or its category icon on a soft tile. */
export function ItemThumb({
  photo,
  icon,
  size = 44,
  rounded = 'rounded-[14px]',
  tone = 'row',
  className,
}: {
  photo: string | null | undefined;
  icon: string | null | undefined;
  size?: number | undefined;
  rounded?: string | undefined;
  tone?: 'row' | 'card' | 'sand' | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const Icon = iconOf(icon);
  const src = photo !== null && photo !== undefined ? photoSrc(photo, size > 96 ? '480x480' : '96x96') : null;
  if (src !== null) {
    return <img src={src} alt="" loading="lazy" style={{ width: size, height: size }} className={cn('shrink-0 object-cover', rounded, className)} />;
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center',
        rounded,
        tone === 'row' && 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
        tone === 'card' && 'bg-[var(--erp-card)] text-[var(--erp-ink-2)]',
        tone === 'sand' && 'erp-on-sand bg-[var(--erp-sand)] text-[var(--erp-ink)]',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.44)} strokeWidth={1.7} />
    </span>
  );
}
