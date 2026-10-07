/// <reference path="../pb_data/types.d.ts" />
/**
 * The icons a category can wear: a curated set of line icons (the frontend
 * draws each name with the matching lucide-react icon). The same list lives
 * in frontend/src/app/lib/icons.tsx; keep them in step.
 */

const ICONS = [
  'utensils',
  'coffee',
  'pizza',
  'wine',
  'shopping-cart',
  'shopping-bag',
  'shirt',
  'bus',
  'car',
  'fuel',
  'train-front',
  'plane',
  'home',
  'sofa',
  'wrench',
  'zap',
  'lightbulb',
  'droplet',
  'wifi',
  'smartphone',
  'heart-pulse',
  'pill',
  'dumbbell',
  'scissors',
  'film',
  'music',
  'gamepad-2',
  'book-open',
  'graduation-cap',
  'gift',
  'hand-heart',
  'repeat',
  'baby',
  'paw-print',
  'briefcase',
  'landmark',
  'piggy-bank',
  'receipt',
  'package',
  'tag',
];

const DEFAULT_ICON = 'tag';

function isIcon(name) {
  return ICONS.indexOf(name) >= 0;
}

module.exports = { ICONS: ICONS, DEFAULT_ICON: DEFAULT_ICON, isIcon: isIcon };
