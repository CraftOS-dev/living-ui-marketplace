/**
 * Lays the stockroom map out from map.get. Pure geometry, no three.js.
 *
 * One map unit is about a metre; y is up and the floor is y = 0. The view is
 * a fixed isometric one from the +x, +z side, so walls stand on the far (-x,
 * -z) edges and never hide what is in front of them.
 *
 * Each top-level place is a base on the floor. Spaces (site, room, area,
 * container, vehicle) are a base with the places inside them standing on it:
 * a warehouse floor with walls, a room with two walls, a marked floor area, a
 * shipping container, a van. Spaces nest: a room in a site is drawn as a room
 * standing in the site, with its own shelves and racks in it, at any depth.
 * Furniture (rack, shelf, cabinet, fridge, drawer, pallet, bin, box, other)
 * is drawn as itself (on a low plinth when it stands on its own) and holds
 * everything stored inside it, a box on a shelf or a drawer in a cabinet
 * included. Stock kept loose in a space sits on a pallet.
 *
 * Every place can carry a saved layout (map.get `map`, set in arrange mode):
 * the centre of its footprint (top level: on the floor; inside a space: from
 * that space's far corner) and its size. Places without one fill the free
 * floor around those that have one. A space is as big as its saved size, or
 * as its contents need; furniture made wider or deeper gets more columns.
 *
 * Each item stored in a place takes one spot: one to three of its shape
 * (shapes.ts) for how full it is against its target level. An item that is
 * out of stock leaves an empty spot at its home place.
 */
import type { LocationKind, MapData, MapItem, MapPlace } from '../../lib/types.ts';
import { shapeFor, stackHeight } from './shapes.ts';
import type { ItemShape } from './shapes.ts';

/** The floor space one spot takes. */
export const FOOT = { w: 0.36, d: 0.32 };
const PX = 0.42;
const PZ = 0.4;
export const PLATFORM_H = 0.22;
export const VAN_BED = 0.62;
export const BOARD_T = 0.05;
/** Space kept between places laid out automatically. */
const UNIT_GAP = 0.45;
const ZONE_PAD = 0.55;
/** Room kept around what is laid out automatically: on a base, and in a space inside one. */
export const PAD = { zone: ZONE_PAD, space: 0.3 };
/** Room for the walls on the far edges of a building, room or container. */
const WALL_ROOM = 0.35;
export const ZONE_GAP = 1.2;
/** The arrange grid. */
export const GRID = 0.25;

/** How a place inside a space is drawn. */
export type Model = 'shelf' | 'rack' | 'cabinet' | 'fridge' | 'drawer' | 'pallet' | 'tub' | 'carton' | 'deck' | 'room' | 'container' | 'van' | 'plinth';
/** How a top-level place's base is drawn. */
export type Base = 'warehouse' | 'room' | 'area' | 'container' | 'van' | 'plinth';

const SPACES: LocationKind[] = ['site', 'room', 'area', 'container', 'vehicle'];

export function modelOf(kind: LocationKind): Model {
  const m: Record<LocationKind, Model> = {
    site: 'room',
    room: 'room',
    area: 'deck',
    container: 'container',
    vehicle: 'van',
    rack: 'rack',
    shelf: 'shelf',
    cabinet: 'cabinet',
    fridge: 'fridge',
    drawer: 'drawer',
    pallet: 'pallet',
    bin: 'tub',
    box: 'carton',
    other: 'plinth',
  };
  return m[kind];
}

function baseOf(kind: LocationKind): Base {
  if (kind === 'site') return 'warehouse';
  if (kind === 'room') return 'room';
  if (kind === 'area') return 'area';
  if (kind === 'container') return 'container';
  if (kind === 'vehicle') return 'van';
  return 'plinth';
}

/** Floor height of a base: where the units on it stand. */
export const BASE_TOP: Record<Base, number> = { warehouse: 0.16, room: 0.12, area: 0.04, container: 0.12, van: VAN_BED, plinth: PLATFORM_H };
/** Height of a base's walls (or cab), for framing. */
const BASE_TALL: Record<Base, number> = { warehouse: 1.75, room: 1.05, area: 0.04, container: 1.2, van: 1.25, plinth: PLATFORM_H };
/** A space inside another: where what stands in it stands, and how tall its walls are (models.ts draws them). */
const NESTED_FLOOR: Partial<Record<Model, number>> = { room: 0.06, deck: 0.03, container: 0.1, van: VAN_BED };
const NESTED_TALL: Partial<Record<Model, number>> = { room: 0.75, deck: 0.05, container: 1.05, van: 1.25 };

/** A floor rectangle: min corner and size. */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Slot {
  /** item id + ':' + the place the stock is in */
  key: string;
  item: MapItem;
  /** Where the stock actually is (may be a place inside the unit). */
  place: string;
  /** The unit it is drawn on. */
  unit: string;
  qty: number;
  /** How many of its shape stand there: 1 to 3, or 0 for the empty spot of an item that is out of stock. */
  boxes: number;
  shape: ItemShape;
  /** How tall the spot's stack stands. */
  h: number;
  /** Centre of the spot's foot. */
  x: number;
  y: number;
  z: number;
}

export interface Unit {
  /** The place it stands for, `<space id>:floor` for stock kept loose in a space, or `<zone id>:self` for furniture at the top level. */
  id: string;
  place: MapPlace;
  zone: string;
  /** The space unit it stands in (null: directly on its base). */
  parent: string | null;
  model: Model;
  rect: Rect;
  /** A space's usable floor (inside its walls); null for furniture. */
  inner: Rect | null;
  /** The smallest it can be made in arrange mode (furniture; spaces: what is in them). */
  minW: number;
  minD: number;
  /** y of its foot. */
  base: number;
  height: number;
  /** y of each surface things stand on, from the bottom (relative to base). */
  levels: number[];
  /** Places whose stock it shows: itself and every place inside it. */
  holds: string[];
  slots: Slot[];
  /** Stocked items beyond what it can draw. */
  hidden: number;
  /** Stock kept loose in a space (selecting it selects the space). */
  floor: boolean;
  /** Furniture standing for the top-level place itself (selecting it selects that place). */
  self: boolean;
}

export interface Zone {
  id: string;
  place: MapPlace;
  rect: Rect;
  /** The usable floor (inside its walls, without a van's cab). */
  inner: Rect;
  base: Base;
  /** y of the floor its units stand on. */
  top: number;
  units: Unit[];
  holds: string[];
  /** Tallest point, for framing. */
  height: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

export interface World {
  zones: Zone[];
  units: Map<string, Unit>;
  slots: Slot[];
  items: Map<string, MapItem>;
  places: Map<string, MapPlace>;
  /** place id -> its top-level place */
  zoneOf: Map<string, string>;
  bounds: Bounds;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const snapUp = (v: number): number => Math.ceil(v / GRID - 1e-6) * GRID;
/** Round up to the arrange grid. */
export const snapUpGrid = snapUp;

/** How many of an item's shape stand for a quantity: how full it is against the item's target. */
function boxesFor(item: MapItem, qty: number): number {
  if (qty <= 0) return 0;
  const ref = item.max_qty > 0 ? item.max_qty : item.min_qty > 0 ? item.min_qty * 2 : Math.max(item.on_hand, qty);
  const fill = ref > 0 ? qty / ref : 1;
  return fill < 0.34 ? 1 : fill < 0.67 ? 2 : 3;
}

const STATUS_ORDER: Record<string, number> = { out: 0, low: 1, ok: 2, over: 3, archived: 4 };

interface Pending {
  item: MapItem;
  place: string;
  qty: number;
  boxes: number;
}

/** A saved size, or null for automatic. */
interface Size {
  w: number | null;
  d: number | null;
}

/** A model's size, the surfaces things stand on, how its spots are laid out, and how small it may get. */
interface Frame {
  w: number;
  d: number;
  minW: number;
  minD: number;
  height: number;
  levels: number[];
  cols: number;
  rows: number;
  /** Where the spot grid starts (min corner, within the unit). */
  x0: number;
  z0: number;
}

/**
 * Size a piece of furniture for n spots, or to a saved size: wider means more
 * columns, deeper more rows where the model has them.
 */
function frame(model: Model, n: number, size: Size | null): Frame {
  // mx, mz: the room around the spots; dRows: rows when the depth is not free.
  const build = (opts: {
    mx: number;
    mz: number;
    cols: number;
    rows: number;
    fixedD?: number;
    /** The depth never changes (a drawer unit is as deep as its pulled-out drawer). */
    lockD?: boolean;
    levels: (cols: number, rows: number) => number[];
    top: (levels: number[]) => number;
    z0?: number;
  }): Frame => {
    const minW = snapUp(opts.mx + PX);
    // A model with its own depth may stay that deep (a 0.62 shelf), or be made deeper.
    const minD = opts.fixedD ?? snapUp(opts.mz + PZ);
    const w = size?.w != null ? Math.max(minW, size.w) : opts.cols * PX + opts.mx;
    const cols = size?.w != null ? Math.max(1, Math.floor((w - opts.mx) / PX)) : opts.cols;
    const d =
      opts.fixedD !== undefined ? (opts.lockD === true ? opts.fixedD : Math.max(opts.fixedD, size?.d ?? 0)) : size?.d != null ? Math.max(minD, size.d) : opts.rows * PZ + opts.mz;
    const rows = opts.fixedD !== undefined ? opts.rows : size?.d != null ? Math.max(1, Math.floor((d - opts.mz) / PZ)) : opts.rows;
    const levels = opts.levels(cols, rows);
    return { w, d, minW, minD, height: opts.top(levels), levels, cols, rows, x0: (w - cols * PX) / 2, z0: opts.z0 ?? (d - rows * PZ) / 2 };
  };
  if (model === 'shelf') {
    return build({
      mx: 0.22,
      mz: 0.22,
      cols: clamp(Math.ceil(n / 3), 2, 6),
      rows: 1,
      fixedD: 0.62,
      levels: (cols) => Array.from({ length: clamp(Math.ceil(n / cols), 3, 5) }, (_, i) => 0.06 + i * 0.5 + BOARD_T),
      top: (l) => (l[l.length - 1] ?? 1) + 0.42,
    });
  }
  if (model === 'rack') {
    return build({
      mx: 0.34,
      mz: 0.24,
      cols: clamp(Math.ceil(n / 6), 2, 5),
      rows: 2,
      levels: (cols, rows) => [0.12, 0.88, 1.64].slice(0, clamp(Math.ceil(n / (cols * rows)), 2, 3)),
      top: (l) => (l[l.length - 1] ?? 1) + 0.62,
    });
  }
  if (model === 'cabinet') {
    return build({
      mx: 0.2,
      mz: 0.2,
      cols: clamp(Math.ceil(n / 3), 2, 4),
      rows: 1,
      fixedD: 0.6,
      levels: (cols) => [0.07, 0.48, 0.89].slice(0, clamp(Math.ceil(n / cols), 2, 3)),
      top: (l) => (l[l.length - 1] ?? 1) + 0.44,
    });
  }
  if (model === 'fridge') {
    return build({
      mx: 0.24,
      mz: 0.24,
      cols: clamp(Math.ceil(n / 4), 2, 3),
      rows: 1,
      fixedD: 0.66,
      levels: (cols) => [0.14, 0.52, 0.9, 1.28].slice(0, clamp(Math.ceil(n / cols), 3, 4)),
      top: (l) => (l[l.length - 1] ?? 1) + 0.46,
    });
  }
  if (model === 'drawer') {
    // The top drawer is pulled out toward the viewer; its spots are in it.
    return build({ mx: 0.16, mz: 0, cols: clamp(n, 2, 5), rows: 1, fixedD: 0.94, lockD: true, levels: () => [0.54], top: () => 0.8, z0: 0.56 + (0.38 - PZ) / 2 });
  }
  if (model === 'tub' || model === 'carton') {
    const cols = clamp(Math.ceil(Math.sqrt(n)), 2, 4);
    return build({ mx: 0.24, mz: 0.24, cols, rows: clamp(Math.ceil(n / cols), 2, 4), levels: () => [0.05], top: () => (model === 'tub' ? 0.38 : 0.42) });
  }
  // pallet, deck, plinth: a flat surface with spots in a grid.
  const cols = clamp(Math.ceil(Math.sqrt(n * 1.5)), 2, 6);
  const top = model === 'pallet' ? 0.15 : model === 'plinth' ? 0.12 : 0.03;
  return build({ mx: 0.3, mz: 0.3, cols, rows: clamp(Math.ceil(n / cols), model === 'pallet' ? 2 : 1, 6), levels: () => [top], top: () => top });
}

/** A piece of furniture (or a pallet of loose stock) with its spots. */
function buildUnit(
  id: string,
  place: MapPlace,
  zone: string,
  model: Model,
  holds: string[],
  pending: Pending[],
  flags: { floor: boolean; self: boolean },
  size: Size | null,
): Unit {
  const f = frame(model, pending.length, size);
  const perLevel = f.cols * f.rows;
  const capacity = perLevel * f.levels.length;
  const drawn = pending.slice(0, capacity);
  const slots: Slot[] = drawn.map((p, i) => {
    const level = Math.floor(i / perLevel);
    const k = i % perLevel;
    const shape = shapeFor(p.item.unit, p.item.icon);
    return {
      key: `${p.item.id}:${p.place}`,
      item: p.item,
      place: p.place,
      unit: id,
      qty: p.qty,
      boxes: p.boxes,
      shape,
      h: stackHeight(shape, Math.max(1, p.boxes)),
      x: f.x0 + (k % f.cols) * PX + PX / 2,
      y: f.levels[level] ?? 0,
      z: f.z0 + Math.floor(k / f.cols) * PZ + PZ / 2,
    };
  });
  return {
    id,
    place,
    zone,
    parent: null,
    model,
    rect: { x: 0, z: 0, w: f.w, d: f.d },
    inner: null,
    minW: f.minW,
    minD: f.minD,
    base: 0,
    height: Math.max(f.height, ...slots.map((s) => s.y + s.h)),
    levels: f.levels,
    holds,
    slots,
    hidden: Math.max(0, pending.filter((p) => p.boxes > 0).length - drawn.filter((p) => p.boxes > 0).length),
    floor: flags.floor,
    self: flags.self,
  };
}

/** Do two rectangles overlap, keeping `gap` between them? */
export function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.z < b.z + b.d + gap && b.z < a.z + a.d + gap;
}

/** Is `a` inside `b` (with `margin` to spare)? */
export function inside(a: Rect, b: Rect, margin = 0): boolean {
  return a.x >= b.x + margin - 1e-6 && a.z >= b.z + margin - 1e-6 && a.x + a.w <= b.x + b.w - margin + 1e-6 && a.z + a.d <= b.z + b.d - margin + 1e-6;
}

/** The first free spot for a rectangle, scanning rows from the origin. */
function freeSpot(w: number, d: number, taken: Rect[], rowWidth: number): { x: number; z: number } {
  for (let z = 0; z < 400; z += 0.5) {
    for (let x = 0; x + w <= Math.max(rowWidth, w); x += 0.5) {
      const r = { x, z, w, d };
      if (taken.every((t) => !overlaps(r, t, ZONE_GAP))) return { x, z };
    }
  }
  return { x: 0, z: 400 };
}

/** A piece of a layout: its units (relative to the block's own corner and floor), its footprint and height. */
interface Block {
  units: Unit[];
  w: number;
  d: number;
  height: number;
  /** The place it stands for (null: a space's loose stock), whose saved layout places it. */
  place: MapPlace | null;
}

/**
 * Where blocks stand in a space: saved ones at their saved centres, the rest
 * in the first free spot scanning rows from the far corner (a van: along its
 * bed). Returns each block's corner (relative to the space's corner) and the
 * size the space needs.
 */
function arrangeIn(blocks: Block[], o: { lead: number; pad: number; cab: number; fixedW: number | null; oneRow: boolean }): { at: Rect[]; needW: number; needD: number } {
  const at: (Rect | null)[] = blocks.map(() => null);
  const placed: Rect[] = [];
  const start = o.lead + o.pad;
  blocks.forEach((b, i) => {
    const m = b.place?.map;
    if (m === undefined || m === null) return;
    // Never into the walls.
    const r = { x: Math.max(o.lead, m.x - b.w / 2), z: Math.max(o.lead, m.z - b.d / 2), w: b.w, d: b.d };
    if (placed.some((p) => overlaps(r, p, 0.01))) return;
    at[i] = r;
    placed.push(r);
  });
  const area = blocks.reduce((a, b) => a + (b.w + UNIT_GAP) * (b.d + UNIT_GAP), 0);
  const limit = o.fixedW !== null ? o.fixedW - o.pad - o.cab : start + Math.max(3.2, Math.sqrt(area) * 1.5);
  blocks.forEach((b, i) => {
    if (at[i] !== null) return;
    let spot: Rect | null = null;
    for (let z = start; z < start + 400 && spot === null; z += GRID) {
      for (let x = start; spot === null; x += GRID) {
        if (!o.oneRow && x > start && x + b.w > limit) break;
        const r = { x, z, w: b.w, d: b.d };
        if (placed.every((p) => !overlaps(r, p, UNIT_GAP))) spot = r;
        if (x > start + 400) break;
      }
      if (o.oneRow) break;
    }
    const r = spot ?? { x: start, z: start + 400, w: b.w, d: b.d };
    at[i] = r;
    placed.push(r);
  });
  const rects = at.map((r) => r ?? { x: start, z: start, w: 0, d: 0 });
  // Places laid out automatically keep some room around them; ones placed by hand may stand at the edge.
  const own = (b: Block): boolean => b.place?.map !== undefined && b.place.map !== null;
  const maxX = Math.max(start, ...rects.map((r, i) => r.x + r.w + (own(blocks[i] as Block) ? 0 : o.pad)));
  const maxZ = Math.max(start, ...rects.map((r, i) => r.z + r.d + (own(blocks[i] as Block) ? 0 : o.pad)));
  return { at: rects, needW: maxX + o.cab, needD: maxZ };
}

export function layoutWorld(data: MapData): World {
  const places = new Map(data.places.map((p) => [p.id, p]));
  const items = new Map(data.items.map((i) => [i.id, i]));
  const children = new Map<string, MapPlace[]>();
  for (const p of data.places) {
    if (p.parent === null) continue;
    const list = children.get(p.parent) ?? [];
    list.push(p);
    children.set(p.parent, list);
  }
  const bySort = (a: MapPlace, b: MapPlace): number => a.sort - b.sort || a.name.localeCompare(b.name);
  for (const list of children.values()) list.sort(bySort);
  const below = (id: string): string[] => {
    const out: string[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length > 0) {
      const p = stack.pop();
      if (p === undefined) break;
      out.push(p.id);
      stack.push(...(children.get(p.id) ?? []));
    }
    return out;
  };
  const sizeOf = (p: MapPlace): Size | null => (p.map !== null && (p.map.w !== null || p.map.d !== null) ? { w: p.map.w, d: p.map.d } : null);

  // Which unit draws each place's stock. A space draws the places inside it,
  // at any depth; its own stock sits on a pallet in it. Furniture draws
  // everything inside it.
  const roots = data.places.filter((p) => p.parent === null).sort(bySort);
  const drawnBy = new Map<string, string>();
  const zoneOf = new Map<string, string>();
  const mapPlace = (place: MapPlace, root: string): void => {
    zoneOf.set(place.id, root);
    if (SPACES.includes(place.kind)) {
      drawnBy.set(place.id, `${place.id}:floor`);
      for (const child of children.get(place.id) ?? []) mapPlace(child, root);
      return;
    }
    const unit = place.id === root ? `${root}:self` : place.id;
    drawnBy.set(place.id, unit);
    for (const deep of below(place.id)) {
      drawnBy.set(deep, unit);
      zoneOf.set(deep, root);
    }
  };
  for (const root of roots) mapPlace(root, root.id);

  // What each unit holds: stock, then empty spots at home places.
  const pendingBy = new Map<string, Pending[]>();
  const push = (unit: string, p: Pending): void => {
    const list = pendingBy.get(unit) ?? [];
    list.push(p);
    pendingBy.set(unit, list);
  };
  for (const s of data.stock) {
    const item = items.get(s.item);
    const unit = drawnBy.get(s.location);
    if (item === undefined || unit === undefined || s.qty <= 0) continue;
    push(unit, { item, place: s.location, qty: s.qty, boxes: boxesFor(item, s.qty) });
  }
  for (const item of data.items) {
    if (item.status !== 'out' || item.home === null) continue;
    const unit = drawnBy.get(item.home);
    if (unit === undefined) continue;
    // Out overall but still some at home (negative elsewhere): that stock already has its spot there.
    if ((pendingBy.get(unit) ?? []).some((p) => p.item.id === item.id && p.place === item.home)) continue;
    push(unit, { item, place: item.home, qty: 0, boxes: 0 });
  }
  for (const list of pendingBy.values()) {
    list.sort((a, b) => (a.boxes === 0 ? 1 : 0) - (b.boxes === 0 ? 1 : 0) || (STATUS_ORDER[a.item.status] ?? 9) - (STATUS_ORDER[b.item.status] ?? 9) || a.item.name.localeCompare(b.item.name));
  }

  const single = (u: Unit, place: MapPlace | null): Block => ({ units: [u], w: u.rect.w, d: u.rect.d, height: u.height, place });

  /** Move a block's units by (x, z) and up by y. */
  const shift = (b: Block, x: number, z: number, y: number): void => {
    for (const u of b.units) {
      u.rect.x += x;
      u.rect.z += z;
      if (u.inner !== null) {
        u.inner.x += x;
        u.inner.z += z;
      }
      u.base += y;
    }
  };

  /** What stands in a space: the places inside it and, when it holds stock itself, a pallet of that stock. */
  const contents = (space: MapPlace, root: string, looseModel: Model, always: boolean): Block[] => {
    const blocks = (children.get(space.id) ?? []).map((child) =>
      SPACES.includes(child.kind)
        ? spaceBlock(child, root)
        : single(buildUnit(child.id, child, root, modelOf(child.kind), [child.id, ...below(child.id)], pendingBy.get(child.id) ?? [], { floor: false, self: false }, sizeOf(child)), child),
    );
    const loose = pendingBy.get(`${space.id}:floor`) ?? [];
    if (loose.length > 0 || (always && blocks.length === 0)) {
      blocks.push(single(buildUnit(`${space.id}:floor`, space, root, looseModel, [space.id], loose, { floor: true, self: false }, null), null));
    }
    return blocks;
  };

  /** A space inside another one: its model (room, marked area, container, van) around what stands in it. */
  const spaceBlock = (place: MapPlace, root: string): Block => {
    const model = modelOf(place.kind);
    const van = model === 'van';
    const blocks = contents(place, root, van || model === 'container' ? 'deck' : 'pallet', false);
    // Walls take the far edges (a van's bed walls a little, so furniture never stands in them).
    const lead = model === 'room' ? 0.22 : model === 'container' ? 0.14 : van ? 0.06 : 0;
    const pad = blocks.length > 0 ? 0.3 : 0;
    const cab = van ? 0.95 : 0;
    const size = sizeOf(place);
    const placed = arrangeIn(blocks, { lead, pad, cab, fixedW: size?.w ?? null, oneRow: van });
    // The smallest a space may be made; what stands in it can make it bigger.
    const minW = van ? 2.6 : 1.5;
    const minD = van ? 1.2 : 1.5;
    const w = Math.max(minW, snapUp(placed.needW), size?.w ?? 0);
    const d = Math.max(minD, snapUp(placed.needD), size?.d ?? 0);
    const floor = NESTED_FLOOR[model] ?? 0.03;
    let height = NESTED_TALL[model] ?? 0.05;
    const units: Unit[] = [];
    blocks.forEach((b, i) => {
      const at = placed.at[i] ?? { x: lead + pad, z: lead + pad, w: 0, d: 0 };
      shift(b, at.x, at.z, floor);
      const first = b.units[0];
      if (first !== undefined) first.parent = place.id;
      height = Math.max(height, floor + b.height);
      units.push(...b.units);
    });
    const self: Unit = {
      id: place.id,
      place,
      zone: root,
      parent: null,
      model,
      rect: { x: 0, z: 0, w, d },
      inner: { x: lead, z: lead, w: w - lead - cab, d: d - lead },
      minW,
      minD,
      base: 0,
      height,
      levels: [floor],
      holds: [place.id, ...below(place.id)],
      slots: [],
      hidden: 0,
      floor: false,
      self: false,
    };
    return { units: [self, ...units], w, d, height, place };
  };

  const units = new Map<string, Unit>();
  const zones: Zone[] = [];
  for (const root of roots) {
    const base = baseOf(root.kind);
    const size = sizeOf(root);
    const furniture = base === 'plinth';
    const blocks = furniture
      ? [
          single(
            buildUnit(`${root.id}:self`, root, root.id, modelOf(root.kind), [root.id, ...below(root.id)], pendingBy.get(`${root.id}:self`) ?? [], { floor: false, self: true }, sizeOf(root)),
            null,
          ),
        ]
      : contents(root, root.id, base === 'van' || base === 'container' ? 'deck' : 'pallet', true);
    const van = base === 'van';
    const cab = van ? 1.1 : 0;
    // Walls take the far edges of a building, room or container.
    const lead = base === 'warehouse' || base === 'room' || base === 'container' ? WALL_ROOM : van ? 0.06 : 0;
    const pad = furniture ? 0.35 : ZONE_PAD;
    const placed = arrangeIn(blocks, { lead, pad, cab, fixedW: furniture ? null : (size?.w ?? null), oneRow: van });
    // Whole-unit sizes when automatic keep every corner on the arrange grid. A
    // piece of furniture's saved size is its own; its plinth follows it.
    const plinth = furniture ? plinthSize(blocks[0]?.w ?? 0, blocks[0]?.d ?? 0) : null;
    const autoW = plinth?.w ?? Math.ceil(Math.max(van ? 3.4 : 2.6, placed.needW));
    const autoD = plinth?.d ?? Math.ceil(Math.max(2.2, placed.needD));
    const w = furniture || size?.w == null ? autoW : Math.max(snapUp(placed.needW), size.w);
    const d = furniture || size?.d == null ? autoD : Math.max(snapUp(placed.needD), size.d);
    const top = BASE_TOP[base];
    const inner: Unit[] = [];
    blocks.forEach((b, i) => {
      const at = placed.at[i] ?? { x: lead + pad, z: lead + pad, w: 0, d: 0 };
      // Furniture standing on its own sits in the middle of its plinth.
      const x = furniture ? (w - b.w) / 2 : at.x;
      const z = furniture ? (d - b.d) / 2 : at.z;
      shift(b, x, z, top);
      inner.push(...b.units);
    });
    zones.push({
      id: root.id,
      place: root,
      rect: { x: 0, z: 0, w, d },
      inner: { x: lead, z: lead, w: w - lead - cab, d: d - lead },
      base,
      top,
      units: inner,
      holds: [root.id, ...below(root.id)],
      height: Math.max(BASE_TALL[base], ...blocks.map((b) => top + b.height), top + 0.4),
    });
    for (const u of inner) units.set(u.id, u);
  }

  // Place the bases: saved centres first (a clash moves the later one), then
  // the rest in rows from the origin.
  const taken: Rect[] = [];
  const auto: Zone[] = [];
  for (const z of zones) {
    if (z.place.map === null) {
      auto.push(z);
      continue;
    }
    const r = { x: z.place.map.x - z.rect.w / 2, z: z.place.map.z - z.rect.d / 2, w: z.rect.w, d: z.rect.d };
    if (taken.some((t) => overlaps(r, t, 0.01))) {
      auto.push(z);
      continue;
    }
    z.rect = r;
    taken.push(r);
  }
  const totalArea = zones.reduce((a, z) => a + (z.rect.w + ZONE_GAP) * (z.rect.d + ZONE_GAP), 0);
  const rowWidth = Math.max(10, Math.sqrt(totalArea) * 1.7);
  for (const z of auto) {
    const spot = freeSpot(z.rect.w, z.rect.d, taken, rowWidth);
    z.rect = { x: spot.x, z: spot.z, w: z.rect.w, d: z.rect.d };
    taken.push(z.rect);
  }

  // World coordinates for units, their floors and spots.
  const slots: Slot[] = [];
  for (const z of zones) {
    z.inner.x += z.rect.x;
    z.inner.z += z.rect.z;
    for (const u of z.units) {
      u.rect.x += z.rect.x;
      u.rect.z += z.rect.z;
      if (u.inner !== null) {
        u.inner.x += z.rect.x;
        u.inner.z += z.rect.z;
      }
      for (const s of u.slots) {
        s.x += u.rect.x;
        s.z += u.rect.z;
        s.y += u.base;
        slots.push(s);
      }
    }
  }

  const bounds: Bounds = zones.length === 0 ? { minX: -2, maxX: 2, minZ: -2, maxZ: 2, maxY: 1 } : { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 0 };
  for (const z of zones) {
    bounds.minX = Math.min(bounds.minX, z.rect.x);
    bounds.maxX = Math.max(bounds.maxX, z.rect.x + z.rect.w);
    bounds.minZ = Math.min(bounds.minZ, z.rect.z);
    bounds.maxZ = Math.max(bounds.maxZ, z.rect.z + z.rect.d);
    bounds.maxY = Math.max(bounds.maxY, z.height);
  }
  return { zones, units, slots, items, places, zoneOf, bounds };
}

/** The plinth under a piece of furniture standing on its own (it sits in the middle). */
export function plinthSize(w: number, d: number): { w: number; d: number } {
  return { w: Math.ceil(Math.max(1.5, w + 0.7) - 1e-6), d: Math.ceil(Math.max(1.5, d + 0.7) - 1e-6) };
}

/** The smallest a top-level space may be made. */
export function zoneMin(base: Base): { w: number; d: number } {
  return { w: base === 'van' ? 3.4 : 1.5, d: 1.5 };
}

/** The centre of a rectangle. */
export function centre(r: Rect): { x: number; z: number } {
  return { x: r.x + r.w / 2, z: r.z + r.d / 2 };
}

/** Snap to the arrange grid. */
export function snapGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}
