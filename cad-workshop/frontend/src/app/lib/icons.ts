/**
 * The icons the feature schema names (curated lucide line icons, stored by
 * name, validated here). An unknown name falls back to the box.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpFromLine,
  Box,
  Circle,
  CircleDot,
  Columns3,
  Combine,
  Container,
  FileInput,
  FlipHorizontal2,
  Hexagon,
  Move3d,
  MoveVertical,
  PenLine,
  Radius,
  RectangleEllipsis,
  RectangleHorizontal,
  Rotate3d,
  RotateCw,
  Slash,
  Spline,
  Triangle,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  MoveVertical,
  ArrowUpFromLine,
  Box,
  Circle,
  CircleDot,
  Columns3,
  Combine,
  Container,
  FileInput,
  FlipHorizontal2,
  Hexagon,
  Move3d,
  PenLine,
  Radius,
  RectangleEllipsis,
  RectangleHorizontal,
  Rotate3d,
  RotateCw,
  Slash,
  Spline,
  Triangle,
};

export function iconByName(name: string): LucideIcon {
  return ICONS[name] ?? Box;
}
