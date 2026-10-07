/**
 * Category icons: the curated line-icon set the backend accepts
 * (pb_hooks/lib_icons.js). Keep both lists in step.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Baby,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Coffee,
  Droplet,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandHeart,
  HeartPulse,
  House,
  Landmark,
  Lightbulb,
  Music,
  Package,
  PawPrint,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  Tag,
  TrainFront,
  Utensils,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from '../../kit/index.ts';

export const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  coffee: Coffee,
  pizza: Pizza,
  wine: Wine,
  'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  bus: Bus,
  car: Car,
  fuel: Fuel,
  'train-front': TrainFront,
  plane: Plane,
  home: House,
  sofa: Sofa,
  wrench: Wrench,
  zap: Zap,
  lightbulb: Lightbulb,
  droplet: Droplet,
  wifi: Wifi,
  smartphone: Smartphone,
  'heart-pulse': HeartPulse,
  pill: Pill,
  dumbbell: Dumbbell,
  scissors: Scissors,
  film: Film,
  music: Music,
  'gamepad-2': Gamepad2,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  gift: Gift,
  'hand-heart': HandHeart,
  repeat: Repeat,
  baby: Baby,
  'paw-print': PawPrint,
  briefcase: Briefcase,
  landmark: Landmark,
  'piggy-bank': PiggyBank,
  receipt: Receipt,
  package: Package,
  tag: Tag,
};

export const ICON_NAMES = Object.keys(ICONS);

export function iconOf(name: string | null | undefined): LucideIcon {
  return (name !== null && name !== undefined && ICONS[name]) || Tag;
}

/** A category's icon in a round badge. tone: light (on cards), dark (selected), plain. */
export function CategoryBadge({
  icon,
  size = 40,
  tone = 'light',
  className,
}: {
  icon: string | null | undefined;
  size?: number;
  tone?: 'light' | 'dark' | 'white' | 'none';
  className?: string;
}): React.JSX.Element {
  const Icon = icon === null || icon === undefined || icon === '' ? Tag : iconOf(icon);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        tone === 'light' && 'bg-[var(--et-card)] text-[var(--et-ink)]',
        tone === 'white' && 'bg-[var(--et-row)] text-[var(--et-ink)]',
        tone === 'dark' && 'bg-[var(--et-solid)] text-[var(--et-on-solid)]',
        icon === null || icon === undefined || icon === '' ? 'text-[var(--et-muted)]' : '',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={1.8} />
    </span>
  );
}
