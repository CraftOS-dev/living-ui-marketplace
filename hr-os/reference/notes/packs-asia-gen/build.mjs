// Build every packs-asia pack and country file: node gen/build.mjs [jp sg in my countries]
const want = process.argv.slice(2);
const all = ['jp', 'sg', 'in', 'my', 'countries']; // jp-yea, in-epf, in-esi, in-pt-gj are maintained in APP since the packs-verify round
const list = want.length ? want : all;
for (const name of list) {
  const mod = await import('./' + name + '.mjs');
  const files = mod.build();
  for (const f of files) console.log('wrote', f);
}
