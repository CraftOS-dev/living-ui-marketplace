/** Lucide icons by the names the operations give (lib_kinds.js KINDS[*].icon). */
import type { LucideIcon } from 'lucide-react';
import { Crop, Eraser, Frame, Layers, Scaling, SlidersHorizontal, Square, Wand2 } from 'lucide-react';
import type { EditKind } from './types.ts';

const BY_NAME: Record<string, LucideIcon> = {
  Crop,
  Scaling,
  Frame,
  SlidersHorizontal,
  Wand2,
  Eraser,
  Layers,
};

export function iconByName(name: string): LucideIcon {
  return BY_NAME[name] ?? Square;
}

export const KIND_ICON: Record<EditKind, LucideIcon> = {
  crop: Crop,
  resize: Scaling,
  canvas: Frame,
  adjust: SlidersHorizontal,
  filter: Wand2,
  remove_bg: Eraser,
  layer: Layers,
};
