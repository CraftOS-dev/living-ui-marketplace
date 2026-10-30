/// <reference path="../pb_data/types.d.ts" />
/**
 * The one settings row: the workspace name (shown in the app's rail and the
 * browser tab) and whether a link added to a board gets its page's title,
 * description and preview image.
 *
 * The name chosen at install arrives in setup.json (the installer fills its
 * {{APP_TITLE}} field JSON-escaped); the first read copies it into the row.
 */

const FALLBACK_TITLE = 'Research Board';

function installTitle() {
  try {
    const raw = toString($os.readFile($filepath.join(__hooks, 'setup.json')));
    const t = String(JSON.parse(raw).title || '').trim();
    if (t === '' || t.indexOf('{{') === 0) return FALLBACK_TITLE;
    return t.slice(0, 120);
  } catch {
    return FALLBACK_TITLE;
  }
}

/** The settings row, created or completed on first use. */
function row(app) {
  const rows = app.findRecordsByFilter('settings', '', 'created', 1, 0);
  let rec = rows.length > 0 ? rows[0] : null;
  if (rec === null) {
    rec = new Record(app.findCollectionByNameOrId('settings'));
    rec.set('link_previews', true);
  }
  if (rec.getString('title') === '') {
    rec.set('title', installTitle());
    app.save(rec);
  }
  return rec;
}

function serialize(rec) {
  return {
    title: rec.getString('title'),
    link_previews: rec.getBool('link_previews'),
  };
}

module.exports = {
  FALLBACK_TITLE: FALLBACK_TITLE,
  row: row,
  serialize: serialize,
};
