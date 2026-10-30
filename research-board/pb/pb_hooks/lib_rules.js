/// <reference path="../pb_data/types.d.ts" />
/**
 * Record rules shared by the record hooks (hooks.pb.js), so they hold for
 * every writer: the UI, the agent's ops, and raw `agent-app data` writes.
 */

const COLORS = ['plain', 'amber', 'green', 'blue', 'violet', 'red', 'teal', 'accent'];

/** A link joins two different cards of its own board. */
function checkLink(app, r) {
  const source = r.getString('source');
  const target = r.getString('target');
  if (source === target) throw new BadRequestError('A card cannot link to itself');
  const a = app.findRecordById('cards', source);
  const b = app.findRecordById('cards', target);
  if (a.getString('board') !== r.getString('board') || b.getString('board') !== r.getString('board')) {
    throw new BadRequestError('Both cards of a link must be on its board');
  }
}

/** Tags are always a list; a color is one of the palette. */
function checkCard(r) {
  const raw = r.getString('tags');
  if (raw === '' || raw === 'null') r.set('tags', []);
  else {
    let tags = null;
    try {
      tags = JSON.parse(raw);
    } catch {
      tags = null;
    }
    if (!Array.isArray(tags)) throw new BadRequestError('tags must be a list of words, e.g. ["climate","method"]');
  }
  const color = r.getString('color');
  if (color !== '' && COLORS.indexOf(color) < 0) throw new BadRequestError('color must be one of: ' + COLORS.join(', '));
}

module.exports = { checkLink: checkLink, checkCard: checkCard };
