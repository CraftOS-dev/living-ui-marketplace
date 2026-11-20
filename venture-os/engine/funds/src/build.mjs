/**
 * Builds the funds PDF engine: bundles render.src.mjs with pdf-lib and
 * @pdf-lib/fontkit into ../render.mjs (no node_modules needed at run time),
 * and copies the Noto WOFF slices with their Unicode ranges into ../fonts.
 * WOFF (zlib), not WOFF2: fontkit cannot subset composite glyphs from a
 * WOFF2 transformed glyf table.
 *
 *   mkdir t && cd t && npm init -y && npm i pdf-lib@1.17.1 @pdf-lib/fontkit@1.1.1 esbuild \
 *     @fontsource/noto-sans@5 @fontsource/noto-sans-jp@5 @fontsource/noto-sans-sc@5 @fontsource/noto-sans-kr@5
 *   node <app>/engine/funds/src/build.mjs <that folder>
 *
 * Fonts: Noto Sans 400 and 700 (Latin, Latin extended, Greek, Cyrillic,
 * Vietnamese) and Noto Sans JP, SC, KR 400, SIL Open Font License 1.1.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '..');
const TOOLS = process.argv[2];
if (!TOOLS) throw new Error('usage: node build.mjs <folder with node_modules>');
const NM = join(TOOLS, 'node_modules');
const require = createRequire(join(TOOLS, 'package.json'));
const esbuild = require('esbuild');

await esbuild.build({
  entryPoints: [join(HERE, 'render.src.mjs')],
  outfile: join(ENGINE, 'render.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'eof',
  nodePaths: [NM],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

const FONTS = join(ENGINE, 'fonts');
rmSync(FONTS, { recursive: true, force: true });
mkdirSync(FONTS, { recursive: true });
const SKIP = ['devanagari'];
// The CJK packages repeat Latin, Greek, Cyrillic and Vietnamese slices that Noto Sans already covers.
const CJK_SKIP = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'];

/** The slices of one package and weight: [{ file, weight, ranges }] from its CSS. */
function slices(pkg, weight) {
  const css = readFileSync(join(NM, '@fontsource', pkg, weight + '.css'), 'utf8');
  const out = [];
  for (const m of css.matchAll(/url\(\.\/files\/([^)]+\.woff)\)[^;]*;\s*unicode-range: ([^;]+);/g)) {
    if (SKIP.some((s) => m[1].indexOf('-' + s + '-') >= 0)) continue;
    if (pkg !== 'noto-sans' && CJK_SKIP.some((s) => m[1] === pkg + '-' + s + '-' + weight + '-normal.woff')) continue;
    const ranges = m[2].split(',').map((r) => {
      const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
      return [parseInt(a, 16), parseInt(b ?? a, 16)];
    });
    copyFileSync(join(NM, '@fontsource', pkg, 'files', m[1]), join(FONTS, m[1]));
    out.push({ file: m[1], weight, ranges });
  }
  return out;
}

const catalog = {
  latin: slices('noto-sans', 400).concat(slices('noto-sans', 700)),
  jp: slices('noto-sans-jp', 400),
  sc: slices('noto-sans-sc', 400),
  kr: slices('noto-sans-kr', 400),
};
writeFileSync(join(FONTS, 'fonts.json'), JSON.stringify(catalog));
copyFileSync(join(NM, '@fontsource', 'noto-sans', 'LICENSE'), join(FONTS, 'OFL.txt'));

let bytes = 0;
for (const f of readdirSync(FONTS)) bytes += statSync(join(FONTS, f)).size;
console.log('render.mjs', statSync(join(ENGINE, 'render.mjs')).size, 'bytes; fonts', readdirSync(FONTS).length, 'files,', bytes, 'bytes');
