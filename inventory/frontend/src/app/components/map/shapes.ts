/**
 * What an item looks like on the stockroom map. Pure data, no three.js.
 *
 * The unit it is counted in decides first: rolls are rolls, metres are a
 * cable reel, kilograms a sack, litres a bottle, a box a taped carton, a pair
 * two of a kind. Items counted in plain pieces take their look from their
 * category's icon (tools come in a case, cleaning in a spray bottle, food in
 * a can). Anything else is a crate.
 *
 * "up" shapes stack one on another (up to three for how full the item is);
 * "cluster" shapes stand side by side.
 */

export type ItemShape = 'crate' | 'carton' | 'pack' | 'case' | 'ream' | 'pair' | 'roll' | 'spool' | 'sack' | 'bottle' | 'spray' | 'can' | 'cell';

export interface ShapeMeta {
  stack: 'up' | 'cluster';
  /** Height of one. */
  h: number;
}

export const SHAPES: Record<ItemShape, ShapeMeta> = {
  crate: { stack: 'up', h: 0.26 },
  carton: { stack: 'up', h: 0.26 },
  pack: { stack: 'up', h: 0.17 },
  case: { stack: 'up', h: 0.24 },
  ream: { stack: 'up', h: 0.1 },
  pair: { stack: 'up', h: 0.12 },
  roll: { stack: 'cluster', h: 0.22 },
  spool: { stack: 'cluster', h: 0.22 },
  sack: { stack: 'cluster', h: 0.25 },
  bottle: { stack: 'cluster', h: 0.3 },
  spray: { stack: 'cluster', h: 0.3 },
  can: { stack: 'cluster', h: 0.17 },
  cell: { stack: 'cluster', h: 0.21 },
};

/** Gap between stacked ones. */
export const STACK_GAP = 0.012;

const UNIT_SHAPES: Record<string, ItemShape> = {
  box: 'carton',
  case: 'carton',
  carton: 'carton',
  crate: 'carton',
  ctn: 'carton',
  pack: 'pack',
  packet: 'pack',
  pk: 'pack',
  pouch: 'pack',
  bag: 'sack',
  sack: 'sack',
  kg: 'sack',
  g: 'sack',
  gram: 'sack',
  lb: 'sack',
  oz: 'sack',
  roll: 'roll',
  pair: 'pair',
  pr: 'pair',
  set: 'case',
  kit: 'case',
  m: 'spool',
  cm: 'spool',
  mm: 'spool',
  km: 'spool',
  ft: 'spool',
  yd: 'spool',
  meter: 'spool',
  metre: 'spool',
  foot: 'spool',
  feet: 'spool',
  l: 'bottle',
  ml: 'bottle',
  cl: 'bottle',
  litre: 'bottle',
  liter: 'bottle',
  gal: 'bottle',
  gallon: 'bottle',
  bottle: 'bottle',
  btl: 'bottle',
  can: 'can',
  tin: 'can',
  jar: 'can',
  tub: 'can',
  sheet: 'ream',
  ream: 'ream',
  pad: 'ream',
};

/** Category icons (lib/icons.tsx) for items counted in plain pieces. */
const ICON_SHAPES: Record<string, ItemShape> = {
  wrench: 'case',
  hammer: 'case',
  drill: 'case',
  ruler: 'case',
  nut: 'case',
  bolt: 'case',
  cog: 'case',
  'hard-hat': 'case',
  paintbrush: 'case',
  car: 'case',
  bike: 'case',
  truck: 'case',
  plug: 'cell',
  cpu: 'cell',
  battery: 'cell',
  lightbulb: 'cell',
  zap: 'cell',
  monitor: 'cell',
  laptop: 'cell',
  smartphone: 'cell',
  headphones: 'cell',
  camera: 'cell',
  watch: 'cell',
  'gamepad-2': 'cell',
  cable: 'spool',
  printer: 'ream',
  'file-text': 'ream',
  'pen-tool': 'ream',
  'book-open': 'ream',
  shirt: 'pack',
  glasses: 'pack',
  gem: 'pack',
  'shopping-bag': 'pack',
  baby: 'pack',
  syringe: 'pack',
  bandage: 'pack',
  'heart-pulse': 'pack',
  snowflake: 'pack',
  tag: 'pack',
  package: 'carton',
  box: 'carton',
  boxes: 'carton',
  archive: 'carton',
  container: 'carton',
  gift: 'carton',
  sofa: 'carton',
  lamp: 'carton',
  bed: 'carton',
  'toy-brick': 'carton',
  coffee: 'can',
  utensils: 'can',
  apple: 'can',
  carrot: 'can',
  cookie: 'can',
  pill: 'can',
  'paint-bucket': 'can',
  fuel: 'can',
  milk: 'bottle',
  wine: 'bottle',
  'flask-conical': 'bottle',
  droplet: 'bottle',
  sun: 'bottle',
  'spray-can': 'spray',
  leaf: 'sack',
  sprout: 'sack',
  flower: 'sack',
  'paw-print': 'sack',
};

/** The look for an item counted in `unit` whose category wears `icon`. */
export function shapeFor(unit: string, icon: string): ItemShape {
  const u = unit.trim().toLowerCase().replace(/\.$/, '');
  const single = u.length > 2 && u.endsWith('s') && !u.endsWith('ss') ? u.slice(0, -1) : u;
  return UNIT_SHAPES[u] ?? UNIT_SHAPES[single] ?? ICON_SHAPES[icon] ?? 'crate';
}

/** Cluster shapes shrink a little when two or three share a spot. */
export function clusterScale(n: number): number {
  return n <= 1 ? 1 : 0.8;
}

/** Where each of n cluster shapes stands within a spot (x, z offsets). */
export function clusterOffsets(n: number): [number, number][] {
  if (n <= 1) return [[0, 0]];
  if (n === 2) return [
    [-0.075, 0.02],
    [0.075, -0.02],
  ];
  return [
    [-0.08, -0.06],
    [0.08, -0.06],
    [0, 0.075],
  ];
}

/** How tall n of a shape stand in one spot. */
export function stackHeight(shape: ItemShape, n: number): number {
  const m = SHAPES[shape];
  if (n <= 0) return 0;
  return m.stack === 'up' ? n * (m.h + STACK_GAP) : m.h * clusterScale(n);
}
