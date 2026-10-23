/// <reference path="../pb_data/types.d.ts" />
/**
 * Citations: in-text citations and bibliography entries in seven styles
 * (APA 7, Chicago author-date, Harvard, IEEE, Vancouver, MLA 9, Nature),
 * and the BibTeX, RIS and CSL-JSON writers.
 *
 * Every entry is built from the paper's stored fields; a field the paper
 * lacks is left out, never filled in. Output comes as html (italics and
 * bold), text (plain) and md (Markdown emphasis).
 */

const STYLES = ['apa', 'chicago', 'harvard', 'ieee', 'vancouver', 'mla', 'nature'];
const NUMERIC = { ieee: true, vancouver: true, nature: true };

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

/* ------------------------------------------------------------- the data */

function dataOf(w) {
  const util = u();
  const g = (f) => w.getString(f);
  const extra = util.jsonOf(w, 'extra') || {};
  return {
    id: w.id,
    citekey: g('citekey') || w.id,
    type: g('type'),
    title: g('title'),
    subtitle: g('subtitle'),
    authors: util.jsonOf(w, 'authors') || [],
    editors: util.jsonOf(w, 'editors') || [],
    year: w.getInt('year'),
    issued: g('issued'),
    container: g('container'),
    container_short: g('container_short'),
    volume: g('volume'),
    issue: g('issue'),
    pages: g('pages'),
    article_number: g('article_number'),
    publisher: g('publisher'),
    place: g('place'),
    edition: g('edition'),
    isbn: g('isbn'),
    issn: g('issn'),
    doi: g('doi'),
    arxiv_id: g('arxiv_id'),
    pmid: g('pmid'),
    url: g('url'),
    abstract: g('abstract'),
    language: g('language'),
    keywords: util.jsonOf(w, 'keywords') || [],
    note: String(extra.note || ''),
  };
}

/* ------------------------------------------------------------- names */

function initials(given, dots, spaced) {
  const parts = String(given || '')
    .split(/\s+/)
    .filter((x) => x !== '');
  return parts
    .map((part) =>
      part
        .split('-')
        .map((h) => (h.length > 0 ? h.charAt(0).toUpperCase() + (dots ? '.' : '') : ''))
        .join('-'),
    )
    .join(spaced ? ' ' : '');
}

function fam(a) {
  return core().familyOf(a);
}

function givenOf(a) {
  return a.given ? String(a.given) : '';
}

/** An organization (a literal name with no family name) is cited by its whole name. */
function isOrg(a) {
  return !a.family && !!a.literal;
}

/** "Vaswani, A." (APA, Harvard), "A. Vaswani" (IEEE), "Vaswani A" (Vancouver), "Vaswani, A." (Nature). */
function nameAs(a, form) {
  const f = fam(a);
  const g = givenOf(a);
  if (g === '' || isOrg(a)) return f;
  if (form === 'apa' || form === 'nature') return f + ', ' + initials(g, true, true);
  if (form === 'harvard') return f + ', ' + initials(g, true, false);
  if (form === 'ieee') return initials(g, true, true) + ' ' + f;
  if (form === 'vancouver') return f + ' ' + initials(g, false, false);
  if (form === 'full') return f + ', ' + g;
  if (form === 'full_fwd') return g + ' ' + f;
  return f;
}

function join(list, sep, last) {
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return list[0] + last + list[1];
  return list.slice(0, -1).join(sep) + sep.replace(/\s+$/, '') + last + list[list.length - 1];
}

function authorList(d, style) {
  const a = d.authors;
  if (a.length === 0) return '';
  if (style === 'apa') {
    const names = a.slice(0, 20).map((x) => nameAs(x, 'apa'));
    if (a.length > 20) return a.slice(0, 19).map((x) => nameAs(x, 'apa')).join(', ') + ', . . . ' + nameAs(a[a.length - 1], 'apa');
    return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1];
  }
  if (style === 'chicago') {
    const names = a.slice(0, 10).map((x, i) => nameAs(x, i === 0 ? 'full' : 'full_fwd'));
    if (a.length > 10) return names.slice(0, 7).join(', ') + ', et al.';
    return names.length === 1 ? names[0] : names.length === 2 ? names[0] + ', and ' + names[1] : names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }
  if (style === 'harvard') {
    const names = a.map((x) => nameAs(x, 'harvard'));
    if (names.length > 3) return names[0] + ' et al.';
    return join(names, ', ', ' and ');
  }
  if (style === 'ieee') {
    const names = a.map((x) => nameAs(x, 'ieee'));
    if (names.length > 6) return names[0] + ' et al.';
    return names.length === 2 ? names[0] + ' and ' + names[1] : join(names, ', ', ', and ');
  }
  if (style === 'vancouver') {
    const names = a.map((x) => nameAs(x, 'vancouver'));
    return names.length > 6 ? names.slice(0, 6).join(', ') + ', et al' : names.join(', ');
  }
  if (style === 'mla') {
    if (a.length === 1) return nameAs(a[0], 'full');
    if (a.length === 2) return nameAs(a[0], 'full') + ', and ' + nameAs(a[1], 'full_fwd');
    return nameAs(a[0], 'full') + ', et al';
  }
  if (style === 'nature') {
    const names = a.map((x) => nameAs(x, 'nature'));
    if (names.length > 5) return names[0] + ' et al.';
    return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  }
  return a.map(fam).join(', ');
}

/* ----------------------------------------------------------- formatting */

function seg() {
  const parts = [];
  return {
    t: (s) => parts.push({ k: 't', s: String(s) }),
    i: (s) => parts.push({ k: 'i', s: String(s) }),
    b: (s) => parts.push({ k: 'b', s: String(s) }),
    out: () => {
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let html = '';
      let text = '';
      let md = '';
      for (const p of parts) {
        text += p.s;
        if (p.k === 'i') {
          html += '<i>' + esc(p.s) + '</i>';
          md += p.s === '' ? '' : '*' + p.s + '*';
        } else if (p.k === 'b') {
          html += '<b>' + esc(p.s) + '</b>';
          md += p.s === '' ? '' : '**' + p.s + '**';
        } else {
          html += esc(p.s);
          md += p.s;
        }
      }
      const tidy = (s) => s.replace(/\s+([,.])/g, '$1').replace(/\.\./g, '.').replace(/\s{2,}/g, ' ').trim();
      return { html: tidy(html), text: tidy(text), md: tidy(md) };
    },
  };
}

function endDot(s) {
  const t = String(s).trim();
  return /[.?!]$/.test(t) ? t : t + '.';
}

function fullTitle(d) {
  return d.subtitle !== '' ? d.title + ': ' + d.subtitle : d.title;
}

function pagesText(d, dash) {
  const p = d.pages !== '' ? d.pages.replace(/\s*-+\s*/g, dash || '-') : '';
  return p !== '' ? p : d.article_number;
}

function doiUrl(d) {
  if (d.doi !== '') return 'https://doi.org/' + d.doi;
  if (d.arxiv_id !== '') return 'https://arxiv.org/abs/' + d.arxiv_id;
  return d.url;
}

function yearText(d, suffix) {
  return (d.year > 0 ? String(d.year) : 'n.d.') + (suffix || '');
}

function editorsText(d, form) {
  if (d.editors.length === 0) return '';
  const names = d.editors.map((x) => (form === 'apa' ? initials(givenOf(x), true, true) + ' ' + fam(x) : nameAs(x, 'full_fwd')));
  return join(names, ', ', ', & ') + (d.editors.length > 1 ? ' (Eds.)' : ' (Ed.)');
}

/** One bibliography entry. n is the number for numeric styles; suffix disambiguates author-date (a, b). */
function entry(d, style, n, suffix) {
  const s = seg();
  const T = fullTitle(d);
  const isBook = d.type === 'book' || d.type === 'thesis' || d.type === 'report' || d.type === 'dataset' || d.type === 'software';
  const inBook = d.type === 'chapter' || d.type === 'conference';
  const pages = pagesText(d, style === 'apa' || style === 'ieee' || style === 'mla' || style === 'chicago' ? '–' : '-');
  const link = doiUrl(d);
  const authors = authorList(d, style);
  if (style === 'apa') {
    if (authors !== '') s.t(endDot(authors) + ' ');
    s.t('(' + yearText(d, suffix) + '). ');
    if (isBook || d.type === 'preprint') {
      s.i(T);
      if (d.edition !== '' && d.type === 'book') s.t(' (' + d.edition + (/^\d+$/.test(d.edition) ? ' ed.' : '') + ')');
      if (d.type === 'preprint') s.t(' [Preprint]');
      if (d.type === 'thesis') s.t(' [Doctoral dissertation' + (d.publisher !== '' ? ', ' + d.publisher : '') + ']');
      s.t('. ');
      if (d.type === 'preprint') s.t((d.container !== '' ? d.container : 'arXiv') + '. ');
      else if (d.type !== 'thesis' && d.publisher !== '') s.t(endDot(d.publisher) + ' ');
    } else if (inBook) {
      s.t(endDot(T) + ' ');
      if (d.container !== '') {
        s.t('In ');
        const ed = editorsText(d, 'apa');
        if (ed !== '') s.t(ed + ', ');
        s.i(d.container);
        if (pages !== '') s.t(' (pp. ' + pages + ')');
        s.t('. ');
      }
      if (d.publisher !== '') s.t(endDot(d.publisher) + ' ');
    } else {
      s.t(endDot(T) + ' ');
      if (d.container !== '') {
        s.i(d.container);
        if (d.volume !== '') {
          s.t(', ');
          s.i(d.volume);
        }
        if (d.issue !== '') s.t('(' + d.issue + ')');
        if (pages !== '') s.t(', ' + pages);
        s.t('. ');
      }
    }
    if (link !== '') s.t(link);
  } else if (style === 'chicago') {
    if (authors !== '') s.t(endDot(authors) + ' ');
    s.t(yearText(d, suffix) + '. ');
    if (isBook || d.type === 'preprint') {
      s.i(T);
      s.t('. ');
      if (d.type === 'preprint') s.t((d.container !== '' ? d.container : 'arXiv') + '. ');
      else {
        if (d.place !== '' && d.publisher !== '') s.t(d.place + ': ');
        if (d.publisher !== '') s.t(endDot(d.publisher) + ' ');
      }
    } else if (inBook) {
      s.t('“' + endDot(T) + '” ');
      if (d.container !== '') {
        s.t('In ');
        s.i(d.container);
        if (d.editors.length > 0) s.t(', edited by ' + join(d.editors.map((x) => nameAs(x, 'full_fwd')), ', ', ' and '));
        if (pages !== '') s.t(', ' + pages);
        s.t('. ');
      }
      if (d.publisher !== '') s.t(endDot((d.place !== '' ? d.place + ': ' : '') + d.publisher) + ' ');
    } else {
      s.t('“' + endDot(T) + '” ');
      if (d.container !== '') {
        s.i(d.container);
        if (d.volume !== '') s.t(' ' + d.volume);
        if (d.issue !== '') s.t(' (' + d.issue + ')');
        if (pages !== '') s.t(': ' + pages);
        s.t('. ');
      }
    }
    if (link !== '') s.t(link + '.');
  } else if (style === 'harvard') {
    if (authors !== '') s.t(authors + ' ');
    s.t('(' + yearText(d, suffix) + ') ');
    if (isBook || d.type === 'preprint') {
      s.i(T);
      s.t('. ');
      if (d.type === 'preprint') s.t('Preprint. ' + (d.container !== '' ? d.container : 'arXiv') + '. ');
      else if (d.publisher !== '') s.t(endDot((d.place !== '' ? d.place + ': ' : '') + d.publisher) + ' ');
    } else {
      s.t('‘' + T + '’, ');
      if (inBook && d.container !== '') s.t('in ');
      if (d.container !== '') s.i(d.container);
      if (d.volume !== '') s.t(', ' + d.volume);
      if (d.issue !== '') s.t('(' + d.issue + ')');
      if (pages !== '') s.t(', pp. ' + pages);
      s.t('. ');
    }
    if (d.doi !== '') s.t('doi:' + d.doi + '.');
    else if (link !== '') s.t('Available at: ' + link + '.');
  } else if (style === 'ieee') {
    s.t('[' + n + '] ');
    if (authors !== '') s.t(authors + ', ');
    if (isBook) {
      s.i(T);
      s.t('. ');
      if (d.place !== '') s.t(d.place + ': ');
      if (d.publisher !== '') s.t(d.publisher + ', ');
      s.t(yearText(d) + '.');
    } else {
      s.t('“' + T + ',” ');
      if (d.type === 'preprint') s.t((d.container !== '' ? d.container : 'arXiv') + (d.arxiv_id !== '' ? ':' + d.arxiv_id : '') + ', ');
      else if (d.container !== '') {
        if (inBook) s.t('in ');
        s.i(d.container);
        s.t(', ');
      }
      if (d.volume !== '') s.t('vol. ' + d.volume + ', ');
      if (d.issue !== '') s.t('no. ' + d.issue + ', ');
      if (pages !== '') s.t((d.pages !== '' ? 'pp. ' : 'Art. no. ') + pages + ', ');
      s.t(yearText(d) + (d.doi !== '' ? ', doi: ' + d.doi : '') + '.');
    }
  } else if (style === 'vancouver') {
    s.t(n + '. ');
    if (authors !== '') s.t(endDot(authors) + ' ');
    s.t(endDot(T) + ' ');
    if (isBook) {
      if (d.place !== '') s.t(d.place + ': ');
      if (d.publisher !== '') s.t(d.publisher + '; ');
      s.t(yearText(d) + '.');
    } else {
      if (d.container !== '') s.t(endDot(d.container_short !== '' ? d.container_short : d.container) + ' ');
      s.t(yearText(d));
      if (d.volume !== '') s.t(';' + d.volume);
      if (d.issue !== '') s.t('(' + d.issue + ')');
      if (pages !== '') s.t(':' + pages);
      s.t('.');
    }
    if (d.doi !== '') s.t(' doi:' + d.doi);
  } else if (style === 'mla') {
    if (authors !== '') s.t(endDot(authors) + ' ');
    if (isBook) {
      s.i(T);
      s.t('. ');
      if (d.publisher !== '') s.t(d.publisher + ', ');
      s.t(yearText(d) + '. ');
    } else {
      s.t('“' + endDot(T) + '” ');
      if (d.container !== '') {
        s.i(d.container);
        s.t(', ');
      }
      if (d.volume !== '') s.t('vol. ' + d.volume + ', ');
      if (d.issue !== '') s.t('no. ' + d.issue + ', ');
      s.t(yearText(d));
      if (pages !== '') s.t(', pp. ' + pages);
      s.t('. ');
    }
    if (link !== '') s.t(link.replace(/^https?:\/\//, '') + '.');
  } else if (style === 'nature') {
    s.t(n + '. ');
    if (authors !== '') s.t(authors + ' ');
    s.t(endDot(T) + ' ');
    if (isBook) {
      s.t('(' + (d.publisher !== '' ? d.publisher + ', ' : '') + yearText(d) + ').');
    } else {
      if (d.container !== '') {
        s.i(d.container_short !== '' ? d.container_short : d.container);
        s.t(' ');
      }
      if (d.volume !== '') {
        s.b(d.volume);
        s.t(', ');
      }
      if (pages !== '') s.t(pages + ' ');
      s.t('(' + yearText(d) + ').');
    }
    if (link !== '') s.t(' ' + link);
  }
  return s.out();
}

/** An in-text citation for one or more papers (each { d, locator, n, suffix }). */
function inText(items, style) {
  if (NUMERIC[style]) {
    const ns = items.map((x) => x.n).sort((a, b) => a - b);
    const ranges = [];
    for (const n of ns) {
      const last = ranges[ranges.length - 1];
      if (last && n === last[1] + 1) last[1] = n;
      else ranges.push([n, n]);
    }
    const inner = ranges.map((r) => (r[0] === r[1] ? String(r[0]) : r[1] === r[0] + 1 ? r[0] + ',' + r[1] : r[0] + '–' + r[1])).join(',');
    if (style === 'nature') return { text: '^' + inner, html: '<sup>' + inner + '</sup>', md: '^' + inner + '^' };
    if (style === 'vancouver') return { text: '(' + inner + ')', html: '(' + inner + ')', md: '(' + inner + ')' };
    return { text: '[' + inner + ']', html: '[' + inner + ']', md: '[' + inner + ']' };
  }
  const parts = items.map((x) => {
    const a = x.d.authors;
    let who = '';
    const amp = style === 'apa' ? ' & ' : ' and ';
    if (a.length === 0) who = x.d.title.split(/\s+/).slice(0, 4).join(' ');
    else if (a.length === 1) who = fam(a[0]);
    else if (a.length === 2) who = fam(a[0]) + amp + fam(a[1]);
    else who = fam(a[0]) + ' et al.';
    if (style === 'mla') return who.replace(/ et al\.$/, ' et al.') + (x.locator ? ' ' + x.locator : '');
    const sep = style === 'chicago' ? ' ' : ', ';
    const loc = x.locator ? (style === 'chicago' ? ', ' + x.locator : ', ' + (/^\d/.test(x.locator) ? 'p. ' + x.locator : x.locator)) : '';
    return who + sep + yearText(x.d, x.suffix) + loc;
  });
  const t = '(' + parts.join('; ') + ')';
  return { text: t, html: t.replace(/&/g, '&amp;'), md: t };
}

/**
 * A bibliography for papers in citation order: numbers for numeric styles
 * (by first citation), author-date suffixes (2017a, 2017b) otherwise.
 */
function bibliography(app, workIds, style) {
  const util = u();
  const recs = workIds.map((id) => util.byId(app, 'works', id)).filter((w) => w !== null);
  const data = recs.map(dataOf);
  const info = {};
  if (NUMERIC[style]) {
    data.forEach((d, i) => (info[d.id] = { n: i + 1, suffix: '' }));
  } else {
    const keyOf = (d) => d.authors.map(fam).join('|').toLowerCase() + '#' + d.year;
    const groups = {};
    for (const d of data) (groups[keyOf(d)] = groups[keyOf(d)] || []).push(d);
    for (const k of Object.keys(groups)) {
      const g = groups[k].slice().sort((a, b) => a.title.localeCompare(b.title));
      g.forEach((d, i) => (info[d.id] = { n: 0, suffix: g.length > 1 ? String.fromCharCode(97 + (i % 26)) : '' }));
    }
    data.sort((a, b) => {
      const fa = (a.authors[0] ? fam(a.authors[0]) : a.title).toLowerCase();
      const fb = (b.authors[0] ? fam(b.authors[0]) : b.title).toLowerCase();
      return fa < fb ? -1 : fa > fb ? 1 : a.year - b.year || (info[a.id].suffix < info[b.id].suffix ? -1 : 1);
    });
  }
  return {
    entries: data.map((d) => Object.assign({ work: d.id, n: info[d.id].n, suffix: info[d.id].suffix }, entry(d, style, info[d.id].n, info[d.id].suffix))),
    info: info,
    data: data,
  };
}

/** cite.format: in-text citation and entry for papers, in a style (Copy citation). */
function format(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = util.ids(p, 'works', 500);
  if (ids.length === 0) throw util.fail(400, 'Give --works.', 'missing_param');
  for (const id of ids) {
    const w = core().need(app, 'works', id, 'paper');
    core().guardWork(ctx, w);
    if (!core().citable(w)) throw util.fail(409, '"' + w.getString('title').slice(0, 80) + '" cannot be cited until its identifier resolves (or a person enters it by hand).', 'source_unresolved', { work: w.id });
  }
  const style = util.oneOf(p, 'style', STYLES, core().settings(app).getString('citation_style') || 'apa');
  const bib = bibliography(app, ids, style);
  const items = ids.map((id) => ({ d: bib.data.find((d) => d.id === id), n: bib.info[id].n, suffix: bib.info[id].suffix, locator: util.str(p, 'locator', '') }));
  return { style: style, in_text: inText(items, style), entries: bib.entries };
}

/* -------------------------------------------------------------- writers */

const LATEX = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };

function tex(s) {
  return String(s || '').replace(/[\\{}&%$#_~^]/g, (c) => LATEX[c]);
}

const BIB_TYPES = { article: 'article', preprint: 'misc', conference: 'inproceedings', book: 'book', chapter: 'incollection', thesis: 'phdthesis', report: 'techreport', dataset: 'misc', software: 'software', webpage: 'online', other: 'misc' };

function bibName(a) {
  if (isOrg(a)) return '{' + tex(a.literal) + '}';
  return tex(a.family) + (a.given ? ', ' + tex(a.given) : '');
}

function bibtexOf(d) {
  const f = [];
  const add = (k, v) => {
    if (v !== undefined && v !== null && String(v) !== '') f.push('  ' + k + ' = {' + v + '}');
  };
  add('title', tex(fullTitle(d)));
  if (d.authors.length > 0) add('author', d.authors.map(bibName).join(' and '));
  if (d.editors.length > 0) add('editor', d.editors.map(bibName).join(' and '));
  const venueKey = d.type === 'article' ? 'journal' : d.type === 'chapter' || d.type === 'conference' ? 'booktitle' : '';
  if (venueKey !== '') add(venueKey, tex(d.container));
  if (d.year > 0) add('year', String(d.year));
  if (/^\d{4}-\d{2}/.test(d.issued)) add('month', String(Number(d.issued.slice(5, 7))));
  add('volume', tex(d.volume));
  add('number', tex(d.issue));
  add('pages', tex(d.pages.replace(/\s*-+\s*/g, '--')));
  if (d.type === 'thesis') add('school', tex(d.publisher));
  else if (d.type === 'report') add('institution', tex(d.publisher));
  else add('publisher', tex(d.publisher));
  add('address', tex(d.place));
  add('edition', tex(d.edition));
  add('isbn', d.isbn);
  add('issn', d.issn);
  add('doi', d.doi);
  if (d.arxiv_id !== '') {
    add('eprint', d.arxiv_id);
    add('archiveprefix', 'arXiv');
  }
  if (d.pmid !== '') add('pmid', d.pmid);
  add('url', d.url !== '' && d.doi === '' ? d.url : '');
  add('abstract', tex(d.abstract));
  if (d.keywords.length > 0) add('keywords', tex(d.keywords.join(', ')));
  add('note', tex(d.note));
  return '@' + BIB_TYPES[d.type] + '{' + d.citekey + ',\n' + f.join(',\n') + '\n}\n';
}

const RIS_TYPES = { article: 'JOUR', preprint: 'GEN', conference: 'CPAPER', book: 'BOOK', chapter: 'CHAP', thesis: 'THES', report: 'RPRT', dataset: 'DATA', software: 'COMP', webpage: 'ELEC', other: 'GEN' };

function risOf(d) {
  const L = [];
  const add = (k, v) => {
    if (v !== undefined && v !== null && String(v) !== '') L.push(k + '  - ' + String(v).replace(/\r?\n/g, ' '));
  };
  add('TY', RIS_TYPES[d.type]);
  add('TI', fullTitle(d));
  for (const a of d.authors) add('AU', a.family ? a.family + (a.given ? ', ' + a.given : '') : a.literal);
  for (const a of d.editors) add('ED', a.family ? a.family + (a.given ? ', ' + a.given : '') : a.literal);
  add(d.type === 'article' ? 'JO' : 'T2', d.container);
  if (d.year > 0) add('PY', String(d.year));
  if (d.issued !== '') add('DA', d.issued.replace(/-/g, '/'));
  add('VL', d.volume);
  add('IS', d.issue);
  const pp = d.pages.split(/\s*-+\s*/);
  add('SP', pp[0] || '');
  if (pp.length > 1) add('EP', pp[1]);
  add('PB', d.publisher);
  add('CY', d.place);
  add('ET', d.edition);
  add('SN', d.isbn !== '' ? d.isbn : d.issn);
  add('DO', d.doi);
  add('UR', d.url !== '' ? d.url : doiUrl(d));
  add('AB', d.abstract);
  for (const k of d.keywords) add('KW', k);
  add('LA', d.language);
  add('ID', d.citekey);
  L.push('ER  - ');
  return L.join('\r\n') + '\r\n';
}

const CSL_TYPES = { article: 'article-journal', preprint: 'article', conference: 'paper-conference', book: 'book', chapter: 'chapter', thesis: 'thesis', report: 'report', dataset: 'dataset', software: 'software', webpage: 'webpage', other: 'document' };

function cslOf(d) {
  const o = { id: d.citekey, type: CSL_TYPES[d.type], title: fullTitle(d) };
  const person = (a) => (a.family ? Object.assign({ family: a.family }, a.given ? { given: a.given } : {}) : { literal: a.literal });
  if (d.authors.length > 0) o.author = d.authors.map(person);
  if (d.editors.length > 0) o.editor = d.editors.map(person);
  if (d.issued !== '') o.issued = { 'date-parts': [d.issued.split('-').map(Number)] };
  else if (d.year > 0) o.issued = { 'date-parts': [[d.year]] };
  const put = (k, v) => {
    if (v !== '' && v !== undefined) o[k] = v;
  };
  put('container-title', d.container);
  put('container-title-short', d.container_short);
  put('volume', d.volume);
  put('issue', d.issue);
  put('page', d.pages);
  put('number', d.article_number);
  put('publisher', d.publisher);
  put('publisher-place', d.place);
  put('edition', d.edition);
  put('ISBN', d.isbn);
  put('ISSN', d.issn);
  put('DOI', d.doi);
  put('PMID', d.pmid);
  put('URL', d.url !== '' ? d.url : doiUrl(d));
  put('abstract', d.abstract);
  put('language', d.language);
  if (d.keywords.length > 0) o.keyword = d.keywords.join(', ');
  if (d.arxiv_id !== '') o.archive = 'arXiv:' + d.arxiv_id;
  return o;
}

module.exports = { STYLES: STYLES, NUMERIC: NUMERIC, dataOf: dataOf, entry: entry, inText: inText, bibliography: bibliography, format: format, bibtexOf: bibtexOf, risOf: risOf, cslOf: cslOf, tex: tex, givenOf: givenOf };
