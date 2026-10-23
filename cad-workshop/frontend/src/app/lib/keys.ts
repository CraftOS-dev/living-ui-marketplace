/**
 * Names on screen. Features have automatic names (`ext3`, `fil2`) that read
 * as "Extrude 3" and "Fillet 2"; faces and edges have structured keys
 * (`<feature>.<role>[.<more>]`, `@<feature>.<n>` for copies, `~<n>` for
 * pieces of a split face, two face keys joined by `|` for an edge) that read
 * as "Side face of Extrude 1". These helpers read that structure, never free
 * text; the raw keys stay available for copying and for your AI agent.
 */

let LABELS: Record<string, string> = {};

/** The prefix labels from the feature schema (set once the schema loads). */
export function setNameLabels(labels: Record<string, string>): void {
  LABELS = labels;
}

const AUTO = /^([a-z]+)(\d+)$/;

/** A feature's name as people read it: "Extrude 3" for ext3, a custom name as is. */
export function featureTitle(name: string): string {
  const m = AUTO.exec(name);
  if (m !== null) {
    const label = LABELS[m[1] ?? ''];
    if (label !== undefined) return label + ' ' + (m[2] ?? '');
  }
  return name;
}

const ROLES: Record<string, string> = {
  cap_start: 'Start face',
  cap_end: 'End face',
  cap: 'Face',
  base: 'Base face',
  side: 'Side face',
  start: 'Start face',
  end: 'End face',
  blend: 'Fillet face',
  corner: 'Fillet corner',
  bevel: 'Chamfer face',
  bore: 'Hole wall',
  floor: 'Hole floor',
  cbore: 'Counterbore wall',
  cbore_floor: 'Counterbore floor',
  csink: 'Countersink',
  inner: 'Inner face',
  top: 'Top face',
  bottom: 'Bottom face',
  front: 'Front face',
  back: 'Back face',
  left: 'Left face',
  right: 'Right face',
  surface: 'Surface',
  face: 'Face',
};

export interface KeyParts {
  feature: string;
  role: string;
  rest: string[];
  copies: string[];
  piece: string;
}

export function split(key: string): KeyParts {
  const tilde = key.indexOf('~');
  const head = tilde < 0 ? key : key.slice(0, tilde);
  const piece = tilde < 0 ? '' : key.slice(tilde + 1);
  const [main = '', ...copies] = head.split('@');
  const parts = main.split('.');
  return { feature: parts[0] ?? '', role: parts[1] ?? '', rest: parts.slice(2), copies, piece };
}

export function isEdgeKey(key: string): boolean {
  return key.includes('|');
}

/** "Side face of Extrude 1", "Fillet face of Fillet 2", "Inner face of Shell 1". */
export function faceLabel(key: string): string {
  const k = split(key);
  const role = ROLES[k.role] ?? 'Face';
  let out = role + ' of ' + featureTitle(k.feature);
  if (k.copies.length) out += ' (copy)';
  return out;
}

/** A compact face label: "Extrude 1 side". */
export function shortLabel(key: string): string {
  const k = split(key);
  const role = (ROLES[k.role] ?? 'Face').replace(/ face$/, '').toLowerCase();
  return featureTitle(k.feature) + ' ' + role + (k.copies.length ? ' (copy)' : '');
}

/** "Edge of Extrude 1", or "Edge between Extrude 1 and Fillet 2". */
export function edgeLabel(key: string): string {
  const [a = '', b = ''] = key.split('|');
  const fa = featureTitle(split(a).feature);
  const fb = featureTitle(split(b).feature);
  return fa === fb ? 'Edge of ' + fa : 'Edge between ' + fa + ' and ' + fb;
}

export function keyLabel(key: string): string {
  return isEdgeKey(key) ? edgeLabel(key) : faceLabel(key);
}

/** The features a key mentions (both faces of an edge, and copies). */
export function keyFeatures(key: string): string[] {
  const out: string[] = [];
  for (const part of key.split('|')) {
    const k = split(part);
    if (!out.includes(k.feature)) out.push(k.feature);
    for (const c of k.copies) {
      const f = c.split('.')[0] ?? '';
      if (f !== '' && !out.includes(f)) out.push(f);
    }
  }
  return out;
}

/** The feature that made a face (its base key's feature). */
export function creatorOf(key: string): string {
  return split(isEdgeKey(key) ? (key.split('|')[0] ?? '') : key).feature;
}
