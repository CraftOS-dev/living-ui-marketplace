/**
 * Curated lucide-react icons available for habit selection.
 *
 * Imports each icon by name so Vite can tree-shake. The keys are stable
 * strings stored in the database; values are the actual React components.
 */

import {
  Activity, AlarmClock, Apple, Banana, Bath, Bed, BellRing, Bike, Book,
  Brain, Briefcase, Brush, Calendar, CheckCircle2, ChefHat, Cigarette, Circle,
  Coffee, Compass, Croissant, Crown, Dog, Droplet, Dumbbell, Edit3, Feather,
  Flame, Flower2, Footprints, Gamepad2, Gem, Gift, GlassWater, Globe2,
  GraduationCap, Guitar, Hammer, Hand, HandCoins, Headphones, Heart,
  HeartPulse, Home, IceCream, Languages, Laptop, Leaf, Lightbulb, Microscope,
  Mic, MessagesSquare, Moon, MountainSnow, Music, Notebook, Palette, Paintbrush,
  Pencil, Pizza, Plane, Plus, Salad, Scale, ScrollText, ShieldCheck, ShoppingBag,
  ShowerHead, Smile, Sofa, Sparkles, Sprout, Stethoscope, Sun, SunMedium,
  Target, Tent, Timer, ToyBrick, TreeDeciduous, Trophy, Tv, Umbrella,
  Wallet, Waves, Wifi, Wind, Wine, Zap, Ban,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const ICON_MAP: Record<string, LucideIcon> = {
  Activity, AlarmClock, Apple, Banana, Bath, Bed, BellRing, Bike, Book,
  Brain, Briefcase, Brush, Calendar, CheckCircle2, ChefHat, Cigarette, Circle,
  Coffee, Compass, Croissant, Crown, Dog, Droplet, Dumbbell, Edit3, Feather,
  Flame, Flower2, Footprints, Gamepad2, Gem, Gift, GlassWater, Globe2,
  GraduationCap, Guitar, Hammer, Hand, HandCoins, Headphones, Heart,
  HeartPulse, Home, IceCream, Languages, Laptop, Leaf, Lightbulb, Microscope,
  Mic, MessagesSquare, Moon, MountainSnow, Music, Notebook, Palette, Paintbrush,
  Pencil, Pizza, Plane, Plus, Salad, Scale, ScrollText, ShieldCheck, ShoppingBag,
  ShowerHead, Smile, Sofa, Sparkles, Sprout, Stethoscope, Sun, SunMedium,
  Target, Tent, Timer, ToyBrick, TreeDeciduous, Trophy, Tv, Umbrella,
  Wallet, Waves, Wifi, Wind, Wine, Zap, Ban,
}

export const ICON_NAMES: string[] = Object.keys(ICON_MAP).sort()

export function getIcon(name: string | undefined | null): LucideIcon {
  if (name && ICON_MAP[name]) return ICON_MAP[name]
  return Circle
}

export const HABIT_COLORS: string[] = [
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#EAB308', // yellow
  '#84CC16', // lime
  '#22C55E', // green
  '#10B981', // emerald
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#0EA5E9', // sky
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#A855F7', // purple
  '#D946EF', // fuchsia
  '#EC4899', // pink
  '#F43F5E', // rose
  '#737373', // neutral
]
