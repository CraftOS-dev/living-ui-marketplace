/// <reference path="../pb_data/types.d.ts" />
/**
 * The icons a category can wear: a curated set of line icons (the frontend
 * draws each name with the matching lucide-react icon). The same list lives
 * in frontend/src/app/lib/icons.tsx; keep them in step.
 */

const ICONS = [
  'coffee', 'cup-soda', 'beer', 'wine', 'martini', 'glass-water', 'milk',
  'utensils', 'pizza', 'sandwich', 'salad', 'soup', 'beef', 'drumstick', 'ham', 'fish', 'egg',
  'croissant', 'cake-slice', 'cookie', 'donut', 'dessert', 'ice-cream-cone', 'candy', 'lollipop', 'popcorn',
  'apple', 'cherry', 'citrus', 'grape', 'carrot', 'wheat', 'bean', 'flame', 'snowflake', 'star',
  'shopping-bag', 'shopping-basket', 'tag', 'package', 'gift', 'shirt', 'footprints', 'gem', 'watch', 'glasses',
  'sparkles', 'scissors', 'palette', 'brush', 'spray-can', 'bath', 'pill', 'baby', 'paw-print', 'flower', 'leaf',
  'book', 'gamepad-2', 'headphones', 'smartphone', 'plug', 'wrench', 'hammer', 'dumbbell', 'bike', 'store',
];

const DEFAULT_ICON = 'tag';

function isIcon(name) {
  return ICONS.indexOf(name) >= 0;
}

module.exports = { ICONS: ICONS, DEFAULT_ICON: DEFAULT_ICON, isIcon: isIcon };
