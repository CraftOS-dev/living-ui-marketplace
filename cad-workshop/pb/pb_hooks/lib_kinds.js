/// <reference path="../pb_data/types.d.ts" />
/**
 * The feature kinds: one typed schema per kind. It is served to the agent
 * (features.schema), drives the app's feature forms, and checks every write
 * before the engine sees it. The engine checks geometry; this checks shape,
 * names and order (a feature may only use parameters, sketches, features and
 * faces made before it).
 *
 * Numbers anywhere in params may be a plain number or {"expr": "wall * 2"}
 * (a parameter expression). A string in a numeric field is read as an
 * expression too, so `"distance": "wall"` works.
 */

const OPERATION = {
  key: 'operation',
  type: 'select',
  label: 'Result',
  default: 'new',
  options: [
    { value: 'new', label: 'New body' },
    { value: 'add', label: 'Add to a body' },
    { value: 'cut', label: 'Cut from a body' },
    { value: 'intersect', label: 'Keep the overlap' },
  ],
  help: 'new makes a separate body; add, cut and intersect change the target body.',
};
const TARGET = { key: 'target', type: 'body', label: 'Target body', help: 'The body to change. Leave empty when the part has one body.', when: { operation: ['add', 'cut', 'intersect'] } };
const BODY_NAME = { key: 'body_name', type: 'ident', label: 'Body name', help: 'Name of the new body (defaults to the feature name).', when: { operation: ['new'] } };

const ITEM_TYPES = {
  rectangle: {
    label: 'Rectangle',
    icon: 'RectangleHorizontal',
    segments: 'ID.bottom, ID.right, ID.top, ID.left (and ID.corner_bl/br/tr/tl when rounded)',
    fields: [
      { key: 'width', type: 'length', label: 'Width', required: true },
      { key: 'height', type: 'length', label: 'Height', required: true },
      { key: 'center', type: 'vec2', label: 'Center', default: [0, 0] },
      { key: 'corner', type: 'vec2', label: 'Corner instead of center', help: 'The lower-left corner; when given it wins over center.' },
      { key: 'corner_radius', type: 'length', label: 'Corner radius', default: 0 },
      { key: 'angle_deg', type: 'angle', label: 'Rotation', default: 0 },
    ],
  },
  circle: {
    label: 'Circle',
    icon: 'Circle',
    segments: 'ID',
    fields: [
      { key: 'diameter', type: 'length', label: 'Diameter', required: true },
      { key: 'center', type: 'vec2', label: 'Center', default: [0, 0] },
    ],
  },
  slot: {
    label: 'Slot',
    icon: 'RectangleEllipsis',
    segments: 'ID.side_a, ID.end_b, ID.side_b, ID.end_a',
    fields: [
      { key: 'length', type: 'length', label: 'Length (center to center)', required: true },
      { key: 'width', type: 'length', label: 'Width', required: true },
      { key: 'center', type: 'vec2', label: 'Center', default: [0, 0] },
      { key: 'angle_deg', type: 'angle', label: 'Rotation', default: 0 },
    ],
  },
  polygon: {
    label: 'Polygon',
    icon: 'Hexagon',
    segments: 'ID.e1 ... ID.eN',
    fields: [
      { key: 'sides', type: 'count', label: 'Sides', required: true, min: 3, max: 64 },
      { key: 'diameter', type: 'length', label: 'Diameter (across corners)' },
      { key: 'across_flats', type: 'length', label: 'Across flats', help: 'Give this or diameter (a nut is sized across flats).' },
      { key: 'center', type: 'vec2', label: 'Center', default: [0, 0] },
      { key: 'angle_deg', type: 'angle', label: 'Rotation', default: 0 },
    ],
  },
  path: {
    label: 'Outline',
    icon: 'Spline',
    segments: 'ID.s1 ... ID.sN (or the ids you give segments)',
    fields: [
      { key: 'start', type: 'vec2', label: 'Start point', required: true },
      {
        key: 'segments',
        type: 'list',
        label: 'Segments',
        required: true,
        help: 'Each segment goes to "to"; add "via" (a point on the arc) to make it an arc. The last segment must end at the start.',
        item: {
          type: 'object',
          fields: [
            { key: 'to', type: 'vec2', label: 'To', required: true },
            { key: 'via', type: 'vec2', label: 'Through (arc)' },
            { key: 'id', type: 'ident', label: 'Segment id' },
          ],
        },
      },
    ],
  },
  line: {
    label: 'Construction line',
    icon: 'Slash',
    segments: 'ID (used as a revolve axis; it makes no profile)',
    fields: [
      { key: 'from', type: 'vec2', label: 'From', required: true },
      { key: 'to', type: 'vec2', label: 'To', required: true },
    ],
  },
};

const KINDS = {
  sketch: {
    label: 'Sketch',
    icon: 'PenLine',
    summary: 'Closed profiles on a plane or a flat face: rectangles, circles, slots, polygons and outlines. Makes no solid by itself; extrude or revolve it.',
    creates: 'no faces; segment ids such as r1.top that later features use',
    fields: [
      {
        key: 'plane',
        type: 'select',
        label: 'Plane',
        default: 'XY',
        options: [
          { value: 'XY', label: 'XY (ground, normal +Z)' },
          { value: 'XZ', label: 'XZ (front, normal -Y)' },
          { value: 'YZ', label: 'YZ (right, normal +X)' },
          { value: 'face', label: 'A flat face' },
        ],
      },
      { key: 'face', type: 'face', label: 'Face', required: true, when: { plane: ['face'] }, help: 'A flat face; sketch coordinates are world coordinates seen from outside the face.' },
      { key: 'offset', type: 'length', label: 'Offset along the normal', default: 0 },
      { key: 'items', type: 'sketch_items', label: 'Items', required: true },
    ],
    example: { plane: 'XY', items: [{ type: 'rectangle', id: 'r1', width: 80, height: 60, corner_radius: 4 }, { type: 'circle', id: 'c1', diameter: 10, center: [20, 0] }] },
  },
  extrude: {
    label: 'Extrude',
    icon: 'ArrowUpFromLine',
    summary: 'Sweeps sketch profiles straight along the sketch normal.',
    creates: 'NAME.cap_start (on the sketch plane), NAME.cap_end, NAME.side.<segment>',
    fields: [
      { key: 'sketch', type: 'sketch', label: 'Sketch', required: true },
      { key: 'items', type: 'items', label: 'Profiles', help: 'Sketch item ids to use. Leave empty for every outer profile (holes inside them stay holes).' },
      {
        key: 'extent',
        type: 'object',
        label: 'Extent',
        required: true,
        fields: [
          {
            key: 'type',
            type: 'select',
            label: 'Extent',
            default: 'distance',
            options: [
              { value: 'distance', label: 'Distance' },
              { value: 'symmetric', label: 'Symmetric' },
              { value: 'two_sided', label: 'Two distances' },
              { value: 'through_all', label: 'Through all (cuts)' },
              { value: 'up_to', label: 'Up to a face' },
            ],
          },
          { key: 'distance', type: 'length', label: 'Distance', required: true, when: { type: ['distance', 'symmetric', 'two_sided'] } },
          { key: 'distance2', type: 'length', label: 'Second distance', required: true, when: { type: ['two_sided'] } },
          { key: 'both_sides', type: 'bool', label: 'Both sides', when: { type: ['through_all'] } },
          { key: 'face', type: 'face', label: 'Up to face', required: true, when: { type: ['up_to'] } },
          { key: 'offset', type: 'length', label: 'Offset past the face', default: 0, when: { type: ['up_to'] } },
        ],
      },
      {
        key: 'direction',
        type: 'select',
        label: 'Direction',
        default: 'normal',
        options: [
          { value: 'normal', label: 'Along the normal' },
          { value: 'reverse', label: 'Reversed' },
        ],
      },
      OPERATION,
      TARGET,
      BODY_NAME,
    ],
    example: { sketch: 's1', extent: { type: 'distance', distance: 10 }, operation: 'new' },
  },
  revolve: {
    label: 'Revolve',
    icon: 'Rotate3d',
    summary: 'Sweeps sketch profiles around an axis in the sketch plane.',
    creates: 'NAME.side.<segment>, and NAME.start / NAME.end when less than a full turn',
    fields: [
      { key: 'sketch', type: 'sketch', label: 'Sketch', required: true },
      { key: 'items', type: 'items', label: 'Profiles' },
      { key: 'axis', type: 'axis', label: 'Axis', required: true, help: 'X, Y or Z through the origin, {"segment": "l1"} (a sketch line or segment), or {"edge": reference}.' },
      { key: 'angle_deg', type: 'angle', label: 'Angle', default: 360 },
      {
        key: 'direction',
        type: 'select',
        label: 'Direction',
        default: 'normal',
        options: [
          { value: 'normal', label: 'Counterclockwise' },
          { value: 'reverse', label: 'Clockwise' },
        ],
      },
      OPERATION,
      TARGET,
      BODY_NAME,
    ],
    example: { sketch: 's2', axis: 'Z', angle_deg: 360 },
  },
  primitive: {
    label: 'Primitive',
    icon: 'Box',
    summary: 'A box, cylinder, sphere, cone or torus placed by numbers.',
    creates: 'box: NAME.top, bottom, front (-Y), back, left (-X), right; cylinder and cone: NAME.side, cap_start, cap_end; sphere and torus: NAME.surface',
    fields: [
      {
        key: 'shape',
        type: 'select',
        label: 'Shape',
        default: 'box',
        options: [
          { value: 'box', label: 'Box' },
          { value: 'cylinder', label: 'Cylinder' },
          { value: 'sphere', label: 'Sphere' },
          { value: 'cone', label: 'Cone' },
          { value: 'torus', label: 'Torus' },
        ],
      },
      { key: 'size', type: 'vec3', label: 'Size (X, Y, Z)', required: true, when: { shape: ['box'] } },
      { key: 'diameter', type: 'length', label: 'Diameter', required: true, when: { shape: ['cylinder', 'sphere'] } },
      { key: 'diameter_start', type: 'length', label: 'Diameter at the base', required: true, when: { shape: ['cone'] } },
      { key: 'diameter_end', type: 'length', label: 'Diameter at the tip', required: true, when: { shape: ['cone'] } },
      { key: 'height', type: 'length', label: 'Height', required: true, when: { shape: ['cylinder', 'cone'] } },
      { key: 'major_diameter', type: 'length', label: 'Ring diameter', required: true, when: { shape: ['torus'] } },
      { key: 'minor_diameter', type: 'length', label: 'Tube diameter', required: true, when: { shape: ['torus'] } },
      {
        key: 'axis',
        type: 'select',
        label: 'Axis',
        default: 'Z',
        when: { shape: ['cylinder', 'cone', 'torus'] },
        options: [
          { value: 'X', label: 'X' },
          { value: 'Y', label: 'Y' },
          { value: 'Z', label: 'Z' },
        ],
      },
      { key: 'position', type: 'vec3', label: 'Position', default: [0, 0, 0] },
      {
        key: 'anchor',
        type: 'select',
        label: 'Position is the',
        default: 'bottom',
        when: { shape: ['box', 'cylinder', 'cone'] },
        options: [
          { value: 'bottom', label: 'Center of the bottom' },
          { value: 'center', label: 'Center' },
          { value: 'corner', label: 'Lowest corner (box)' },
        ],
      },
      OPERATION,
      TARGET,
      BODY_NAME,
    ],
    example: { shape: 'box', size: [40, 30, 10], position: [0, 0, 0], operation: 'new' },
  },
  hole: {
    label: 'Hole',
    icon: 'CircleDot',
    summary: 'Drilled holes on a flat face: plain, counterbored or countersunk, with ISO metric sizes (clearance, close, tap drill, heat-set insert).',
    creates: 'NAME.bore.<i>, NAME.floor.<i> (blind), NAME.cbore.<i>, NAME.cbore_floor.<i>, NAME.csink.<i>; i counts the positions from 1',
    fields: [
      { key: 'face', type: 'face', label: 'Face', required: true },
      { key: 'positions', type: 'points2', label: 'Positions on the face', help: 'Face coordinates: for faces square to an axis they are world coordinates seen from outside (top face: x, y).' },
      { key: 'points', type: 'points3', label: 'World points', help: 'Alternatively world points; each is dropped onto the face.' },
      {
        key: 'size',
        type: 'select',
        label: 'Metric size',
        options: ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'].map((v) => ({ value: v, label: v })),
      },
      {
        key: 'fit',
        type: 'select',
        label: 'Fit',
        default: 'clearance',
        when: { size: ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'] },
        options: [
          { value: 'clearance', label: 'Clearance (ISO 273 medium)' },
          { value: 'close', label: 'Close (ISO 273 fine)' },
          { value: 'tap', label: 'Tap drill (coarse thread)' },
          { value: 'insert', label: 'Heat-set insert' },
        ],
      },
      { key: 'diameter', type: 'length', label: 'Diameter', help: 'Leave empty to use the metric size.' },
      { key: 'through', type: 'bool', label: 'Through all' },
      { key: 'depth', type: 'length', label: 'Depth', when: { through: [false, null] } },
      {
        key: 'head',
        type: 'select',
        label: 'Head',
        default: 'none',
        options: [
          { value: 'none', label: 'Plain' },
          { value: 'counterbore', label: 'Counterbore' },
          { value: 'countersink', label: 'Countersink' },
        ],
      },
      {
        key: 'counterbore',
        type: 'object',
        label: 'Counterbore',
        when: { head: ['counterbore'] },
        fields: [
          { key: 'diameter', type: 'length', label: 'Diameter' },
          { key: 'depth', type: 'length', label: 'Depth' },
        ],
      },
      {
        key: 'countersink',
        type: 'object',
        label: 'Countersink',
        when: { head: ['countersink'] },
        fields: [
          { key: 'diameter', type: 'length', label: 'Diameter' },
          { key: 'angle_deg', type: 'angle', label: 'Angle', default: 90 },
        ],
      },
    ],
    example: { face: { faces: { keys: ['ext1.cap_end'] }, expect: 1 }, positions: [[30, 20], [-30, 20]], size: 'M3', fit: 'clearance', head: 'counterbore', through: true },
  },
  fillet: {
    label: 'Fillet',
    icon: 'Radius',
    summary: 'Rounds edges with a radius.',
    creates: 'NAME.blend.<i> per edge (in key order), NAME.corner.<j> where three or more blends meet',
    fields: [
      { key: 'edges', type: 'edges', label: 'Edges', required: true },
      { key: 'radius', type: 'length', label: 'Radius', required: true },
    ],
    example: { edges: { edges: { created_by: 'ext1', type: 'line', parallel_to: 'Z' }, expect: 4 }, radius: 3 },
  },
  chamfer: {
    label: 'Chamfer',
    icon: 'Triangle',
    summary: 'Bevels edges by a distance (or two distances, or a distance and an angle).',
    creates: 'NAME.bevel.<i> per edge',
    fields: [
      { key: 'edges', type: 'edges', label: 'Edges', required: true },
      { key: 'distance', type: 'length', label: 'Distance', required: true },
      { key: 'distance2', type: 'length', label: 'Second distance' },
      { key: 'angle_deg', type: 'angle', label: 'Angle' },
    ],
    example: { edges: { edges: { keys: ['ext1.cap_end|ext1.side.r1.top'] }, expect: 1 }, distance: 1 },
  },
  shell: {
    label: 'Shell',
    icon: 'Container',
    summary: 'Hollows a body to a wall thickness, opening the faces you remove.',
    creates: 'NAME.inner.<key of the outer face> for each inside wall; a removed face leaves its rim with its own key',
    fields: [
      { key: 'remove', type: 'faces', label: 'Open faces', help: 'Faces to remove (leave empty for a closed hollow body).' },
      { key: 'thickness', type: 'length', label: 'Wall thickness', required: true },
      {
        key: 'direction',
        type: 'select',
        label: 'Walls grow',
        default: 'inside',
        options: [
          { value: 'inside', label: 'Inward' },
          { value: 'outside', label: 'Outward' },
        ],
      },
      { key: 'target', type: 'body', label: 'Body', help: 'Only needed with no open faces and several bodies.' },
    ],
    example: { remove: { faces: { keys: ['ext1.cap_end'] }, expect: 1 }, thickness: 2 },
  },
  pattern_linear: {
    label: 'Linear pattern',
    icon: 'Columns3',
    summary: 'Repeats features (their added or removed material) or whole bodies along one or two directions.',
    creates: 'copies of the source keys with @NAME.<n> appended (n = 2 ... count)',
    fields: [
      { key: 'source', type: 'source', label: 'Repeat', required: true },
      { key: 'direction', type: 'direction', label: 'Direction', required: true },
      { key: 'count', type: 'count', label: 'Count', required: true, min: 1, max: 500 },
      { key: 'spacing', type: 'length', label: 'Spacing', required: true },
      { key: 'direction2', type: 'direction', label: 'Second direction' },
      { key: 'count2', type: 'count', label: 'Second count', min: 1, max: 500 },
      { key: 'spacing2', type: 'length', label: 'Second spacing' },
      { key: 'merge', type: 'bool', label: 'Merge body copies into the source body' },
    ],
    example: { source: { features: ['hole1'] }, direction: 'X', count: 4, spacing: 15 },
  },
  pattern_circular: {
    label: 'Circular pattern',
    icon: 'RotateCw',
    summary: 'Repeats features or bodies around an axis.',
    creates: 'copies of the source keys with @NAME.<n> appended',
    fields: [
      { key: 'source', type: 'source', label: 'Repeat', required: true },
      { key: 'axis', type: 'axis', label: 'Axis', required: true },
      { key: 'count', type: 'count', label: 'Count', required: true, min: 2, max: 500 },
      { key: 'angle_deg', type: 'angle', label: 'Total angle', default: 360 },
      { key: 'merge', type: 'bool', label: 'Merge body copies into the source body' },
    ],
    example: { source: { features: ['hole1'] }, axis: 'Z', count: 6 },
  },
  mirror: {
    label: 'Mirror',
    icon: 'FlipHorizontal2',
    summary: 'Mirrors features or bodies across a plane.',
    creates: 'copies of the source keys with @NAME.m appended',
    fields: [
      { key: 'source', type: 'source', label: 'Mirror', required: true },
      { key: 'plane', type: 'plane', label: 'Plane', required: true },
      { key: 'offset', type: 'length', label: 'Plane offset', default: 0 },
      { key: 'merge', type: 'bool', label: 'Merge body copies into the source body' },
    ],
    example: { source: { features: ['ext2'] }, plane: 'YZ' },
  },
  boolean: {
    label: 'Combine',
    icon: 'Combine',
    summary: 'Joins, subtracts or intersects bodies.',
    creates: 'keeps the keys of both bodies',
    fields: [
      { key: 'target', type: 'body', label: 'Target body', required: true },
      { key: 'tools', type: 'bodies', label: 'Tool bodies', required: true },
      {
        key: 'operation',
        type: 'select',
        label: 'Operation',
        default: 'add',
        options: [
          { value: 'add', label: 'Join' },
          { value: 'cut', label: 'Subtract' },
          { value: 'intersect', label: 'Keep the overlap' },
        ],
      },
      { key: 'keep_tools', type: 'bool', label: 'Keep the tool bodies' },
    ],
    example: { target: 'base', tools: ['boss'], operation: 'add' },
  },
  transform: {
    label: 'Move',
    icon: 'Move3d',
    summary: 'Moves and rotates bodies (rotation first, then translation).',
    creates: 'keeps the keys',
    fields: [
      { key: 'bodies', type: 'bodies', label: 'Bodies', required: true },
      { key: 'translate', type: 'vec3', label: 'Move by', default: [0, 0, 0] },
      {
        key: 'rotate',
        type: 'object',
        label: 'Rotate',
        fields: [
          { key: 'axis', type: 'direction', label: 'Axis', default: 'Z' },
          { key: 'angle_deg', type: 'angle', label: 'Angle', required: true },
          { key: 'origin', type: 'vec3', label: 'About point', default: [0, 0, 0] },
        ],
      },
    ],
    example: { bodies: ['lid'], translate: [0, 0, 25] },
  },
  import_step: {
    label: 'Import STEP',
    icon: 'FileInput',
    summary: 'Brings a STEP file (added with assets.add) in as a body.',
    creates: 'NAME.f<n> in file order (renamed if the file changes)',
    fields: [
      { key: 'asset', type: 'asset', label: 'File', required: true },
      { key: 'scale', type: 'ratio', label: 'Scale', default: 1 },
      { key: 'translate', type: 'vec3', label: 'Move by', default: [0, 0, 0] },
      {
        key: 'rotate',
        type: 'object',
        label: 'Rotate',
        fields: [
          { key: 'axis', type: 'direction', label: 'Axis', default: 'Z' },
          { key: 'angle_deg', type: 'angle', label: 'Angle', required: true },
          { key: 'origin', type: 'vec3', label: 'About point', default: [0, 0, 0] },
        ],
      },
      OPERATION,
      TARGET,
      BODY_NAME,
    ],
    example: { asset: '<asset id>', operation: 'new' },
  },
  push_pull: {
    label: 'Push/pull',
    icon: 'MoveVertical',
    summary: 'Moves a flat face along its normal: outward adds material, inward cuts.',
    creates: 'NAME.cap (the face in its new place), NAME.side.<i> per edge of the face',
    fields: [
      { key: 'face', type: 'face', label: 'Face', required: true },
      { key: 'distance', type: 'length', label: 'Distance', required: true, help: 'Positive pulls the face out (adds material); negative pushes it in (cuts).' },
    ],
    example: { face: { faces: { keys: ['ext1.cap_end'] }, expect: 1 }, distance: 5 },
  },
};

/** What the automatic names stand for: "ext3" reads "Extrude 3" on screen. */
const NAME_LABELS = {
  s: 'Sketch',
  ext: 'Extrude',
  rev: 'Revolve',
  hole: 'Hole',
  fil: 'Fillet',
  cha: 'Chamfer',
  shell: 'Shell',
  lpat: 'Pattern',
  cpat: 'Circular pattern',
  mir: 'Mirror',
  comb: 'Combine',
  move: 'Move',
  imp: 'Import',
  pp: 'Push/pull',
  prim: 'Primitive',
  box: 'Box',
  cyl: 'Cylinder',
  sph: 'Sphere',
  cone: 'Cone',
  tor: 'Torus',
};

const KIND_NAMES = Object.keys(KINDS);
const NUMERIC = ['length', 'angle', 'count', 'ratio', 'number'];
const IDENT = /^[a-z][a-z0-9_]{0,31}$/;

/* ------------------------------------------------------------ validation */

function fail(path, message) {
  return require(`${__hooks}/lib_util.js`).fail(400, (path ? path + ': ' : '') + message);
}

/** The feature name a key starts with ("ext1.cap_end" -> "ext1"; edges use both faces). */
function keyFeatures(key) {
  const out = [];
  for (const part of String(key).split('|')) {
    const head = part.split('~')[0];
    out.push(head.split('.')[0]);
    const at = head.split('@');
    for (let i = 1; i < at.length; i++) out.push(at[i].split('.')[0]);
  }
  return out;
}

/** True when the field is shown for these values (its `when` condition). */
function visible(field, values) {
  if (!field.when) return true;
  for (const k of Object.keys(field.when)) {
    const v = values[k] === undefined ? null : values[k];
    if (field.when[k].indexOf(v) < 0) return false;
  }
  return true;
}

/** A numeric value: number, {"expr": "..."}, or an expression string. */
function numeric(v, path, ctx, field) {
  const expr = require(`${__hooks}/lib_expr.js`);
  if (typeof v === 'number') {
    if (!isFinite(v)) throw fail(path, 'must be a finite number');
    if (field && field.min !== undefined && v < field.min) throw fail(path, 'must be at least ' + field.min);
    if (field && field.max !== undefined && v > field.max) throw fail(path, 'must be at most ' + field.max);
    return v;
  }
  let text = null;
  if (typeof v === 'string') text = v;
  else if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.expr === 'string' && Object.keys(v).length === 1) text = v.expr;
  if (text === null) throw fail(path, 'must be a number or {"expr": "..."}');
  text = text.trim();
  if (text === '') throw fail(path, 'must not be empty');
  let names;
  try {
    names = expr.names(text);
  } catch (err) {
    throw fail(path, 'the expression "' + text + '" is not valid: ' + err.message);
  }
  for (const n of names) {
    if (ctx.params.indexOf(n) < 0) {
      throw fail(path, 'the expression uses "' + n + '", which is not a parameter of this part' + (ctx.params.length ? ' (parameters: ' + ctx.params.join(', ') + ')' : ' (it has none yet; add one with params.set)'));
    }
  }
  if (expr.isPlain(text)) return Number(text);
  return { expr: text };
}

function ref(v, path, ctx, kinds) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw fail(path, 'must be a reference like {"faces": {"keys": ["ext1.cap_end"]}, "expect": 1}');
  }
  const present = ['faces', 'edges', 'bodies'].filter((k) => v[k] !== undefined);
  if (present.length !== 1 || kinds.indexOf(present[0]) < 0) throw fail(path, 'must select ' + kinds.join(' or '));
  for (const k of Object.keys(v)) {
    if (['faces', 'edges', 'bodies', 'expect'].indexOf(k) < 0) throw fail(path, 'unknown field "' + k + '" (use ' + kinds.join('/') + ' and expect)');
  }
  if (v.expect !== undefined) {
    const e = v.expect;
    const okInt = typeof e === 'number' && Number.isInteger(e) && e >= 1;
    const okRange = e !== null && typeof e === 'object' && !Array.isArray(e);
    if (!okInt && !okRange) throw fail(path + '.expect', 'must be a count like 1, or {"min": 1, "max": 4}');
  }
  checkSelectorOrder(v[present[0]], path + '.' + present[0], ctx);
  return v;
}

/** Keys and created_by inside a selector must name features before this one. */
function checkSelectorOrder(sel, path, ctx) {
  if (sel === null || typeof sel !== 'object') return;
  if (Array.isArray(sel)) {
    for (const s of sel) checkSelectorOrder(s, path, ctx);
    return;
  }
  const names = [];
  for (const k of ['keys', 'not_keys']) {
    const list = sel[k];
    if (Array.isArray(list)) for (const key of list) if (typeof key === 'string') names.push.apply(names, keyFeatures(key));
  }
  if (typeof sel.created_by === 'string') names.push(sel.created_by);
  if (Array.isArray(sel.created_by)) for (const c of sel.created_by) if (typeof c === 'string') names.push(c);
  for (const n of names) {
    if (ctx.before.indexOf(n) < 0) {
      if (ctx.all.indexOf(n) >= 0) throw fail(path, 'uses ' + n + ', which comes after this feature in the tree (move this feature below it, or the reference above it)');
      throw fail(path, 'uses ' + n + ', which is not a feature of this part');
    }
  }
  for (const k of ['of_faces', 'any', 'between']) if (sel[k] !== undefined) checkSelectorOrder(sel[k], path + '.' + k, ctx);
}

function vecOf(v, n, path, ctx) {
  if (!Array.isArray(v) || v.length !== n) throw fail(path, 'must be a list of ' + n + ' numbers, e.g. ' + JSON.stringify(n === 2 ? [0, 0] : [0, 0, 0]));
  return v.map((x, i) => numeric(x, path + '[' + i + ']', ctx));
}

function names(v, path, allowStar) {
  if (allowStar && (v === '*' || (Array.isArray(v) && v.length === 1 && v[0] === '*'))) return ['*'];
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' && x !== '')) throw fail(path, 'must be a list of names');
  return v;
}

function value(field, v, path, ctx, siblings) {
  const t = field.type;
  if (NUMERIC.indexOf(t) >= 0) return numeric(v, path, ctx, field);
  switch (t) {
    case 'select':
      if (field.options.map((o) => o.value).indexOf(v) < 0) throw fail(path, 'must be one of: ' + field.options.map((o) => o.value).join(', '));
      return v;
    case 'bool':
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (typeof v !== 'boolean') throw fail(path, 'must be true or false');
      return v;
    case 'text':
      if (typeof v !== 'string') throw fail(path, 'must be text');
      return v;
    case 'ident':
      if (typeof v !== 'string' || !IDENT.test(v)) throw fail(path, 'must be a short lower-case name (letters, digits, _), e.g. lid');
      return v;
    case 'sketch': {
      if (typeof v !== 'string') throw fail(path, 'must be the name of a sketch feature');
      const k = ctx.kinds[v];
      if (k === undefined || ctx.before.indexOf(v) < 0) {
        if (ctx.all.indexOf(v) >= 0) throw fail(path, v + ' comes after this feature; a feature can only use sketches before it');
        throw fail(path, 'there is no sketch named ' + v + (ctx.sketches.length ? ' (sketches: ' + ctx.sketches.join(', ') + ')' : ''));
      }
      if (k !== 'sketch') throw fail(path, v + ' is a ' + k + ', not a sketch');
      return v;
    }
    case 'items':
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && IDENT.test(x))) throw fail(path, 'must be a list of sketch item ids, e.g. ["r1"]');
      return v;
    case 'face':
      return ref(v, path, ctx, ['faces']);
    case 'faces':
      return ref(v, path, ctx, ['faces']);
    case 'edges':
      return ref(v, path, ctx, ['edges']);
    case 'body':
      if (typeof v !== 'string' || v === '') throw fail(path, 'must be a body name');
      return v;
    case 'bodies':
      return names(v, path, true);
    case 'vec2':
      return vecOf(v, 2, path, ctx);
    case 'vec3':
      return vecOf(v, 3, path, ctx);
    case 'points2':
    case 'points3': {
      const n = t === 'points2' ? 2 : 3;
      if (!Array.isArray(v) || v.length === 0) throw fail(path, 'must be a list of points, e.g. ' + JSON.stringify(n === 2 ? [[10, 10]] : [[10, 10, 0]]));
      if (v.length > 500) throw fail(path, 'at most 500 points');
      return v.map((p, i) => vecOf(p, n, path + '[' + i + ']', ctx));
    }
    case 'object':
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw fail(path, 'must be an object');
      return fields(field.fields, v, path, ctx);
    case 'list':
      if (!Array.isArray(v) || v.length === 0) throw fail(path, 'must be a non-empty list');
      return v.map((x, i) => value(field.item, x, path + '[' + i + ']', ctx, siblings));
    case 'sketch_items':
      return sketchItems(v, path, ctx);
    case 'axis':
      if (typeof v === 'string') {
        if (['X', 'Y', 'Z'].indexOf(v) < 0) throw fail(path, 'must be X, Y or Z, {"segment": "..."}, {"edge": reference} or {"origin": [...], "direction": [...]}');
        return v;
      }
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.segment === 'string') return { segment: v.segment };
        if (v.edge !== undefined) return { edge: ref(v.edge, path + '.edge', ctx, ['edges']) };
        if (v.direction !== undefined) return { origin: vecOf(v.origin === undefined ? [0, 0, 0] : v.origin, 3, path + '.origin', ctx), direction: vecOf(v.direction, 3, path + '.direction', ctx) };
      }
      throw fail(path, 'must be X, Y or Z, {"segment": "..."}, {"edge": reference} or {"origin": [...], "direction": [...]}');
    case 'direction':
      if (typeof v === 'string') {
        if (['X', 'Y', 'Z', '+X', '-X', '+Y', '-Y', '+Z', '-Z'].indexOf(v) < 0) throw fail(path, 'must be X, Y, Z, +X ... -Z, a vector [x, y, z] or {"edge": reference}');
        return v;
      }
      if (Array.isArray(v)) return vecOf(v, 3, path, ctx);
      if (v !== null && typeof v === 'object' && v.edge !== undefined) return { edge: ref(v.edge, path + '.edge', ctx, ['edges']) };
      throw fail(path, 'must be X, Y, Z, +X ... -Z, a vector [x, y, z] or {"edge": reference}');
    case 'plane':
      if (typeof v === 'string') {
        if (['XY', 'XZ', 'YZ'].indexOf(v) < 0) throw fail(path, 'must be XY, XZ or YZ, or {"face": reference}');
        return v;
      }
      if (v !== null && typeof v === 'object' && v.face !== undefined) return { face: ref(v.face, path + '.face', ctx, ['faces']) };
      throw fail(path, 'must be XY, XZ or YZ, or {"face": reference}');
    case 'source': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw fail(path, 'must be {"features": [...]} or {"bodies": [...]}');
      if (v.features !== undefined) {
        const list = names(v.features, path + '.features', false);
        for (const n of list) {
          if (ctx.before.indexOf(n) < 0) throw fail(path + '.features', n + (ctx.all.indexOf(n) >= 0 ? ' comes after this feature' : ' is not a feature of this part'));
        }
        return { features: list };
      }
      if (v.bodies !== undefined) return { bodies: names(v.bodies, path + '.bodies', false) };
      throw fail(path, 'must be {"features": [...]} or {"bodies": [...]}');
    }
    case 'asset':
      if (typeof v !== 'string' || ctx.assets.indexOf(v) < 0) throw fail(path, 'must be the id of a file added with assets.add' + (ctx.assets.length ? ' (files: ' + ctx.assets.join(', ') + ')' : ''));
      return v;
    default:
      throw fail(path, 'unknown field type ' + t);
  }
}

function fields(defs, params, path, ctx) {
  const out = {};
  const known = defs.map((f) => f.key);
  for (const k of Object.keys(params)) {
    if (known.indexOf(k) < 0) throw fail(path ? path + '.' + k : k, 'unknown field. Fields: ' + known.join(', '));
  }
  // Selects decide which other fields apply, so read them first.
  const values = {};
  for (const f of defs) {
    if (f.type === 'select' || f.type === 'bool') {
      const v = params[f.key];
      if (v !== undefined && v !== null) values[f.key] = value(f, v, (path ? path + '.' : '') + f.key, ctx, values);
      else if (f.default !== undefined) values[f.key] = f.default;
      else values[f.key] = null;
    }
  }
  for (const f of defs) {
    const p = (path ? path + '.' : '') + f.key;
    const v = params[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.required && visible(f, values)) throw fail(p, 'is required');
      continue;
    }
    out[f.key] = f.type === 'select' || f.type === 'bool' ? values[f.key] : value(f, v, p, ctx, values);
  }
  return out;
}

function sketchItems(v, path, ctx) {
  if (!Array.isArray(v) || v.length === 0) throw fail(path, 'must be a non-empty list of sketch items');
  const ids = [];
  return v.map((item, i) => {
    const p = path + '[' + i + ']';
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw fail(p, 'must be an object with type and id');
    const def = ITEM_TYPES[item.type];
    if (def === undefined) throw fail(p + '.type', 'must be one of: ' + Object.keys(ITEM_TYPES).join(', '));
    if (typeof item.id !== 'string' || !IDENT.test(item.id)) throw fail(p + '.id', 'must be a short lower-case id like r1');
    if (ids.indexOf(item.id) >= 0) throw fail(p + '.id', item.id + ' is used twice in this sketch');
    ids.push(item.id);
    const rest = {};
    for (const k of Object.keys(item)) if (k !== 'type' && k !== 'id') rest[k] = item[k];
    const out = fields(def.fields, rest, p, ctx);
    return Object.assign({ type: item.type, id: item.id }, out);
  });
}

/**
 * Check and normalize one feature's params. ctx: { before: names of
 * earlier features, all: every feature name, kinds: name -> kind, sketches,
 * params: parameter names, assets: asset ids }.
 */
function normalize(kind, params, ctx) {
  const def = KINDS[kind];
  if (def === undefined) throw fail('kind', 'must be one of: ' + KIND_NAMES.join(', '));
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw fail('params', 'must be an object');
  return fields(def.fields, params, '', ctx);
}

/** The schema as served to the agent and the UI. */
function describe(kind) {
  if (kind !== undefined && kind !== '') {
    const def = KINDS[kind];
    if (def === undefined) throw require(`${__hooks}/lib_util.js`).fail(400, 'kind must be one of: ' + KIND_NAMES.join(', '));
    const out = Object.assign({ kind: kind }, def);
    if (kind === 'sketch') out.item_types = ITEM_TYPES;
    return out;
  }
  return {
    kinds: KIND_NAMES.map((k) => ({ kind: k, label: KINDS[k].label, icon: KINDS[k].icon, summary: KINDS[k].summary, creates: KINDS[k].creates })),
    numbers: 'Any number may be a plain number or {"expr": "wall * 2"}; expressions use this part\'s parameters, + - * / ^, parentheses, pi, and min max abs round floor ceil sqrt sin cos tan asin acos atan (degrees).',
  };
}

function full() {
  const out = {};
  for (const k of KIND_NAMES) out[k] = Object.assign({ kind: k }, KINDS[k]);
  return { kinds: out, item_types: ITEM_TYPES, order: KIND_NAMES, name_labels: NAME_LABELS };
}

module.exports = { KINDS: KINDS, KIND_NAMES: KIND_NAMES, ITEM_TYPES: ITEM_TYPES, normalize: normalize, describe: describe, full: full, keyFeatures: keyFeatures };
