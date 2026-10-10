/// <reference path="../pb_data/types.d.ts" />
/**
 * The icons a category can wear: a curated set of line icons (the frontend
 * draws each name with the matching lucide-react icon). The same list lives
 * in frontend/src/app/lib/icons.tsx; keep them in step.
 */

const ICONS = [
  'package',
  'box',
  'boxes',
  'archive',
  'container',
  'tag',
  'wrench',
  'hammer',
  'drill',
  'ruler',
  'nut',
  'bolt',
  'cog',
  'paint-bucket',
  'paintbrush',
  'plug',
  'cable',
  'cpu',
  'battery',
  'lightbulb',
  'zap',
  'monitor',
  'laptop',
  'smartphone',
  'headphones',
  'camera',
  'printer',
  'file-text',
  'pen-tool',
  'book-open',
  'shirt',
  'glasses',
  'watch',
  'gem',
  'shopping-bag',
  'gift',
  'coffee',
  'utensils',
  'apple',
  'carrot',
  'milk',
  'wine',
  'cookie',
  'pill',
  'syringe',
  'bandage',
  'heart-pulse',
  'flask-conical',
  'spray-can',
  'droplet',
  'leaf',
  'sprout',
  'flower',
  'sofa',
  'lamp',
  'bed',
  'car',
  'bike',
  'truck',
  'fuel',
  'hard-hat',
  'shield',
  'baby',
  'paw-print',
  'gamepad-2',
  'toy-brick',
  'snowflake',
  'sun',
];

const DEFAULT_ICON = 'package';

function isIcon(name) {
  return ICONS.indexOf(name) >= 0;
}

module.exports = { ICONS: ICONS, DEFAULT_ICON: DEFAULT_ICON, isIcon: isIcon };
