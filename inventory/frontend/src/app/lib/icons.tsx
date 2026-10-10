/**
 * Icons: the curated line-icon set a category can wear (the backend accepts
 * exactly these names, pb_hooks/lib_icons.js; keep both lists in step), the
 * icon of each kind of location, and the badges and thumbnails built on them.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Apple,
  Archive,
  Baby,
  Bandage,
  Battery,
  Bed,
  Bike,
  Bolt,
  BookOpen,
  Box,
  Boxes,
  Cable,
  Camera,
  Car,
  Carrot,
  Cog,
  Coffee,
  Container,
  Cookie,
  Cpu,
  DoorClosed,
  DoorOpen,
  Drill,
  Droplet,
  FileText,
  FlaskConical,
  Flower,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  Hammer,
  HardHat,
  Headphones,
  HeartPulse,
  Inbox,
  Lamp,
  Laptop,
  Layers,
  LayoutGrid,
  Leaf,
  Lightbulb,
  MapPin,
  Milk,
  Monitor,
  Nut,
  Package,
  PaintBucket,
  Paintbrush,
  PawPrint,
  PenTool,
  Pill,
  Plug,
  Printer,
  Refrigerator,
  Rows3,
  Ruler,
  Server,
  Shield,
  Shirt,
  ShoppingBag,
  Smartphone,
  Snowflake,
  Sofa,
  SprayCan,
  Sprout,
  Sun,
  Syringe,
  Tag,
  ToyBrick,
  Truck,
  Utensils,
  Warehouse,
  Watch,
  Wine,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from '../../kit/index.ts';
import type { LocationKind } from './types.ts';

export const ICONS: Record<string, LucideIcon> = {
  package: Package,
  box: Box,
  boxes: Boxes,
  archive: Archive,
  container: Container,
  tag: Tag,
  wrench: Wrench,
  hammer: Hammer,
  drill: Drill,
  ruler: Ruler,
  nut: Nut,
  bolt: Bolt,
  cog: Cog,
  'paint-bucket': PaintBucket,
  paintbrush: Paintbrush,
  plug: Plug,
  cable: Cable,
  cpu: Cpu,
  battery: Battery,
  lightbulb: Lightbulb,
  zap: Zap,
  monitor: Monitor,
  laptop: Laptop,
  smartphone: Smartphone,
  headphones: Headphones,
  camera: Camera,
  printer: Printer,
  'file-text': FileText,
  'pen-tool': PenTool,
  'book-open': BookOpen,
  shirt: Shirt,
  glasses: Glasses,
  watch: Watch,
  gem: Gem,
  'shopping-bag': ShoppingBag,
  gift: Gift,
  coffee: Coffee,
  utensils: Utensils,
  apple: Apple,
  carrot: Carrot,
  milk: Milk,
  wine: Wine,
  cookie: Cookie,
  pill: Pill,
  syringe: Syringe,
  bandage: Bandage,
  'heart-pulse': HeartPulse,
  'flask-conical': FlaskConical,
  'spray-can': SprayCan,
  droplet: Droplet,
  leaf: Leaf,
  sprout: Sprout,
  flower: Flower,
  sofa: Sofa,
  lamp: Lamp,
  bed: Bed,
  car: Car,
  bike: Bike,
  truck: Truck,
  fuel: Fuel,
  'hard-hat': HardHat,
  shield: Shield,
  baby: Baby,
  'paw-print': PawPrint,
  'gamepad-2': Gamepad2,
  'toy-brick': ToyBrick,
  snowflake: Snowflake,
  sun: Sun,
};

export const ICON_NAMES = Object.keys(ICONS);

export function iconOf(name: string | null | undefined): LucideIcon {
  return (name !== null && name !== undefined && ICONS[name]) || Package;
}

export const KIND_ICONS: Record<LocationKind, LucideIcon> = {
  site: Warehouse,
  room: DoorOpen,
  area: LayoutGrid,
  container: Container,
  vehicle: Truck,
  rack: Server,
  shelf: Rows3,
  cabinet: DoorClosed,
  fridge: Refrigerator,
  drawer: Inbox,
  pallet: Layers,
  bin: Archive,
  box: Box,
  other: MapPin,
};

export const KIND_LABELS: Record<LocationKind, string> = {
  site: 'Site or building',
  room: 'Room',
  area: 'Area or zone',
  container: 'Container or storage unit',
  vehicle: 'Vehicle',
  rack: 'Pallet rack',
  shelf: 'Shelf',
  cabinet: 'Cabinet or cupboard',
  fridge: 'Fridge or freezer',
  drawer: 'Drawer',
  pallet: 'Pallet',
  bin: 'Bin',
  box: 'Box',
  other: 'Other place',
};

/** One word for a kind, for tight spots like the kind picker. */
export const KIND_SHORT: Record<LocationKind, string> = {
  site: 'Site',
  room: 'Room',
  area: 'Area',
  container: 'Container',
  vehicle: 'Vehicle',
  rack: 'Rack',
  shelf: 'Shelf',
  cabinet: 'Cabinet',
  fridge: 'Fridge',
  drawer: 'Drawer',
  pallet: 'Pallet',
  bin: 'Bin',
  box: 'Box',
  other: 'Other',
};

export const KINDS: LocationKind[] = ['site', 'room', 'area', 'container', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'];

/**
 * What each kind of place can hold: places nest by size, so a vehicle never
 * goes inside a box. Mirrors HOLDS in pb_hooks/lib_locations.js, which
 * enforces it; here it guides the place form.
 */
export const PLACE_HOLDS: Record<LocationKind, LocationKind[]> = {
  site: ['room', 'area', 'container', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  room: ['area', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  area: ['container', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  container: ['rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  vehicle: ['shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  rack: ['pallet', 'bin', 'box', 'other'],
  shelf: ['bin', 'box', 'other'],
  cabinet: ['shelf', 'drawer', 'bin', 'box', 'other'],
  fridge: ['shelf', 'drawer', 'bin', 'box', 'other'],
  drawer: ['bin', 'box', 'other'],
  pallet: ['bin', 'box', 'other'],
  bin: [],
  box: [],
  other: ['shelf', 'drawer', 'pallet', 'bin', 'box', 'other'],
};

/** "a shelf", "an area or zone", "another place". */
export function aKind(kind: LocationKind): string {
  if (kind === 'other') return 'another place';
  const label = KIND_LABELS[kind].toLowerCase();
  return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
}

/** Can a place of this kind stand inside one of that kind? */
export function placeFits(kind: LocationKind, parent: LocationKind): boolean {
  return PLACE_HOLDS[parent].includes(kind);
}

const KIND_PLURAL: Record<LocationKind, string> = {
  site: 'sites',
  room: 'rooms',
  area: 'areas',
  container: 'containers',
  vehicle: 'vehicles',
  rack: 'pallet racks',
  shelf: 'shelves',
  cabinet: 'cabinets',
  fridge: 'fridges',
  drawer: 'drawers',
  pallet: 'pallets',
  bin: 'bins',
  box: 'boxes',
  other: 'other places',
};

/** "It holds bins, boxes and other places." */
export function holdsText(kind: LocationKind): string {
  const list = PLACE_HOLDS[kind].map((k) => KIND_PLURAL[k]);
  if (list.length === 0) return 'It holds no other places.';
  return `It holds ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`}.`;
}

/** The kind a new place inside `parent` starts as (null: it holds nothing). */
export function defaultChildKind(parent: LocationKind | null): LocationKind | null {
  if (parent === null) return 'room';
  return (['shelf', 'bin', 'box', 'pallet', 'drawer', 'other'] as LocationKind[]).find((k) => placeFits(k, parent)) ?? null;
}

export function kindIcon(kind: string | undefined): LucideIcon {
  return KIND_ICONS[(kind ?? 'other') as LocationKind] ?? MapPin;
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
  size?: number;
  rounded?: string;
  tone?: 'row' | 'card' | 'sand';
  className?: string;
}): React.JSX.Element {
  const Icon = iconOf(icon);
  if (photo !== null && photo !== undefined && photo !== '') {
    return (
      <img
        src={photo}
        alt=""
        loading="lazy"
        style={{ width: size, height: size }}
        className={cn('shrink-0 object-cover', rounded, className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center',
        rounded,
        tone === 'row' && 'bg-[var(--iv-row)] text-[var(--iv-ink-2)]',
        tone === 'card' && 'bg-[var(--iv-card)] text-[var(--iv-ink-2)]',
        tone === 'sand' && 'bg-[var(--iv-sand)] text-[var(--iv-ink)]',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.44)} strokeWidth={1.7} />
    </span>
  );
}
