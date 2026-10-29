/**
 * The workspace's tools: one per edit kind, with its shortcut, where its
 * live view comes from, and the params a new edit starts with. Quick
 * actions (rotate, flip, auto) edit without a dialog.
 */
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Circle, CircleDot, Crop, Eraser, EyeOff, FlipHorizontal2, Frame, Highlighter, Minus, MousePointer2, Pencil, RotateCcw, RotateCw, Scaling, SlidersHorizontal, Sparkles, Square, Stamp, Type, Wand2 } from 'lucide-react';
import type { Dims, EditKind, LayerType, Params } from '../../lib/types.ts';

/** The photo's own edits (layers have their own tools). */
export type PixelKind = Exclude<EditKind, 'layer'>;

/**
 * How a tool shows its work while open:
 *  - preview: the whole stack rendered with the change (a dry run)
 *  - overlay: the image as it enters the edit, with the edit drawn on top
 *    (crop box, marks, redaction boxes), so you see what you place
 */
export type ToolView = 'preview' | 'overlay';

export interface ToolDef {
  kind: PixelKind;
  label: string;
  short: string;
  key: string;
  icon: LucideIcon;
  view: ToolView;
  /** Params a new tool starts with, given the size it enters at: they change nothing (no-op), so nothing is saved until the person changes one; cut out is the exception and runs on opening. */
  start: (d: Dims) => Params;
}

export const TOOLS: Record<PixelKind, ToolDef> = {
  crop: { kind: 'crop', label: 'Crop and straighten', short: 'Crop', key: 'C', icon: Crop, view: 'overlay', start: () => ({}) },
  resize: {
    kind: 'resize',
    label: 'Resize',
    short: 'Resize',
    key: 'R',
    icon: Scaling,
    view: 'preview',
    start: ([w, h]) => ({ mode: 'longest', longest: Math.max(w, h) }),
  },
  canvas: { kind: 'canvas', label: 'Canvas and frame', short: 'Canvas', key: 'B', icon: Frame, view: 'preview', start: () => ({ padding: 0, fill: '#ffffff' }) },
  adjust: { kind: 'adjust', label: 'Adjust light and colour', short: 'Adjust', key: 'A', icon: SlidersHorizontal, view: 'preview', start: () => ({}) },
  filter: { kind: 'filter', label: 'Filter', short: 'Filter', key: 'F', icon: Wand2, view: 'preview', start: () => ({}) },
  remove_bg: { kind: 'remove_bg', label: 'Remove background', short: 'Cut out', key: 'K', icon: Eraser, view: 'preview', start: () => ({ model: 'fast', background: 'transparent', edge: 'soft' }) },
};

export type QuickId = 'rotate_left' | 'rotate_right' | 'flip' | 'auto';

export const QUICK: Record<QuickId, { label: string; short: string; key: string; icon: LucideIcon }> = {
  rotate_left: { label: 'Rotate left', short: 'Left', key: '[', icon: RotateCcw },
  rotate_right: { label: 'Rotate right', short: 'Right', key: ']', icon: RotateCw },
  flip: { label: 'Flip horizontally', short: 'Flip', key: 'H', icon: FlipHorizontal2 },
  auto: { label: 'Auto light and colour', short: 'Auto', key: 'Shift+A', icon: Sparkles },
};

/** The photo tools, grouped as in an image editor: frame, size, tone, cut out. */
export const GROUPS: (PixelKind | QuickId)[][] = [
  ['crop', 'rotate_left', 'rotate_right', 'flip'],
  ['resize', 'canvas'],
  ['adjust', 'auto', 'filter'],
  ['remove_bg'],
];

export type LayerTool = 'select' | LayerType;

/** The layer tools: pick a tool, then drag (or click) on the image. */
export const LAYER_TOOLS: { id: LayerTool; label: string; short: string; key: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'Select and move layers', short: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'text', label: 'Text', short: 'Text', key: 'T', icon: Type },
  { id: 'arrow', label: 'Arrow', short: 'Arrow', key: 'L', icon: ArrowUpRight },
  { id: 'line', label: 'Line', short: 'Line', key: 'Shift+L', icon: Minus },
  { id: 'rect', label: 'Box', short: 'Box', key: 'U', icon: Square },
  { id: 'ellipse', label: 'Ellipse', short: 'Ellipse', key: 'E', icon: Circle },
  { id: 'highlight', label: 'Highlighter', short: 'Highlight', key: 'M', icon: Highlighter },
  { id: 'step', label: 'Numbered step', short: 'Step', key: 'N', icon: CircleDot },
  { id: 'pen', label: 'Pen', short: 'Pen', key: 'P', icon: Pencil },
  { id: 'redact', label: 'Redact (solid, pixelate or blur)', short: 'Redact', key: 'X', icon: EyeOff },
  { id: 'logo', label: 'Logo or watermark', short: 'Logo', key: 'G', icon: Stamp },
];

export const RATIOS: { value: string; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '2:3', label: '2:3' },
  { value: '21:9', label: '21:9' },
];

/** Annotation colours: the accent orange first, then the usual markup set. */
export const MARK_COLORS = ['#ff4f18', '#e5243b', '#ffd60a', '#2fb36d', '#1e88e5', '#7b2ff7', '#111111', '#ffffff'];

export const FONT_LABEL: Record<string, string> = {
  sans: 'Sans',
  'sans-bold': 'Sans bold',
  serif: 'Serif',
  'serif-bold': 'Serif bold',
  mono: 'Mono',
  hand: 'Handwriting',
  impact: 'Impact',
};

