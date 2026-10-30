/// <reference path="../pb_data/types.d.ts" />
/**
 * A board as a Markdown document: the board's description, then each
 * section with the cards inside it (top to bottom, left to right), then the
 * cards outside any section, then the links written as sentences.
 */

function inside(card, section) {
  return card.x >= section.x && card.y >= section.y && card.x + card.w <= section.x + section.w && card.y + card.h <= section.y + section.h;
}

function quoteLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => '> ' + l)
    .join('\n');
}

function cardMarkdown(c) {
  const title = c.title !== '' ? c.title : 'Untitled';
  const tags = c.tags.length > 0 ? '\n\n' + c.tags.map((t) => '#' + t.replace(/\s+/g, '-')).join(' ') : '';
  const where = c.url !== '' ? c.url : c.file !== '' ? (c.meta.filename || c.file) : '';
  let out = '';
  switch (c.kind) {
    case 'note':
      out = (c.title !== '' ? '### ' + c.title + '\n\n' : '') + (c.body !== '' ? c.body : '');
      break;
    case 'quote':
      out = quoteLines(c.body) + (c.source !== '' || c.url !== '' ? '\n>\n> — ' + (c.source !== '' ? c.source : '') + (c.url !== '' ? (c.source !== '' ? ', ' : '') + c.url : '') : '');
      break;
    case 'link':
      out = '### [' + title + '](' + c.url + ')' + (c.meta.site ? '\n\n*' + c.meta.site + '*' : '') + (c.meta.description ? '\n\n' + c.meta.description : '') + (c.body !== '' ? '\n\n' + c.body : '');
      break;
    default: {
      const label = c.kind === 'youtube' ? 'YouTube' : c.kind === 'doc' ? 'Document' : c.kind === 'image' ? 'Image' : 'Video';
      out = '### ' + title + '\n\n' + label + (where !== '' ? ': ' + (c.url !== '' ? '<' + where + '>' : where) : '') + (c.body !== '' ? '\n\n' + c.body : '');
    }
  }
  if (c.digest !== '') out += '\n\n**Summary.** ' + c.digest;
  return out.trim() + tags;
}

/** How a card is named in a sentence: its title, else the start of its text. */
function nameOf(c) {
  if (c.title !== '') return c.title;
  const t = String(c.body || '').replace(/\s+/g, ' ').trim();
  if (t === '') return 'Untitled';
  return '"' + (t.length > 60 ? t.slice(0, 57).trim() + '...' : t) + '"';
}

function order(a, b) {
  return Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x;
}

function markdown(app, boardId) {
  const boards = require(`${__hooks}/lib_boards.js`);
  const linksLib = require(`${__hooks}/lib_links.js`);
  const data = boards.full(app, boards.mustGet(app, boardId), null);
  const sections = data.cards.filter((c) => c.kind === 'section').sort(order);
  const cards = data.cards.filter((c) => c.kind !== 'section');
  const placed = {};
  const parts = ['# ' + data.board.name];
  if (data.board.description !== '') parts.push(data.board.description);
  for (const s of sections) {
    const within = cards.filter((c) => !placed[c.id] && inside(c, s)).sort(order);
    parts.push('## ' + (s.title !== '' ? s.title : 'Section'));
    if (within.length === 0) parts.push('*Empty section.*');
    for (const c of within) {
      placed[c.id] = true;
      parts.push(cardMarkdown(c));
    }
  }
  const rest = cards.filter((c) => !placed[c.id]).sort(order);
  if (rest.length > 0) {
    if (sections.length > 0) parts.push('## Other cards');
    for (const c of rest) parts.push(cardMarkdown(c));
  }
  const byId = {};
  for (const c of data.cards) byId[c.id] = c;
  const confirmed = data.links.filter((l) => l.status === 'confirmed');
  if (confirmed.length > 0) {
    parts.push('## Links');
    parts.push(
      confirmed
        .map((l) => {
          const a = byId[l.source];
          const b = byId[l.target];
          if (!a || !b) return '';
          return '- ' + nameOf(a) + ' **' + linksLib.LABEL[l.kind] + '** ' + nameOf(b) + (l.label !== '' ? ' (' + l.label + ')' : '');
        })
        .filter((x) => x !== '')
        .join('\n'),
    );
  }
  const name = data.board.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'board';
  return { filename: name + '.md', content: parts.join('\n\n') + '\n', cards: cards.length };
}

module.exports = { markdown: markdown };
