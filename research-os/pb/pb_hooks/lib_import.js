/// <reference path="../pb_data/types.d.ts" />
/**
 * Importing a library file: BibTeX (and BibLaTeX), RIS, CSL-JSON (what
 * Zotero, Mendeley, EndNote, JabRef and Paperpile export).
 *
 * import.preview parses the file and shows what would happen per entry
 * (new with an identifier, new without one, already in the library);
 * import.run makes the papers; import.undo removes exactly that batch.
 *
 * Imported fields are kept as the person curated them: they count as
 * person edits, so the registry only fills what the file left empty. An
 * entry without an identifier is entered as written when a person imports
 * it; when your AI agent imports it, it waits for a person to confirm.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

/* --------------------------------------------------------------- LaTeX */

const ACCENTS = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ć', N: 'Ń', S: 'Ś', Z: 'Ź' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' },
  '.': { z: 'ż', Z: 'Ż', e: 'ė' },
  c: { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş' },
  v: { c: 'č', s: 'š', z: 'ž', r: 'ř', e: 'ě', n: 'ň', C: 'Č', S: 'Š', Z: 'Ž', R: 'Ř', E: 'Ě' },
  u: { a: 'ă', g: 'ğ', A: 'Ă', G: 'Ğ' },
  H: { o: 'ő', u: 'ű', O: 'Ő', U: 'Ű' },
  k: { a: 'ą', e: 'ę', A: 'Ą', E: 'Ę' },
  r: { a: 'å', A: 'Å', u: 'ů' },
};
const SYMBOLS = { o: 'ø', O: 'Ø', ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', '&': '&', '%': '%', $: '$', '#': '#', _: '_', textendash: '–', textemdash: '—', textquoteright: '’', textquoteleft: '‘' };

/** LaTeX text to Unicode: accents, special letters, escaped symbols; braces removed. */
function delatex(s) {
  let t = String(s || '');
  // {\"o}, \"{o}, \"o
  t = t.replace(/\{\\([`'^"~=.])\s*\{?([A-Za-z])\}?\}/g, (m, a, c) => (ACCENTS[a] && ACCENTS[a][c]) || c);
  t = t.replace(/\\([`'^"~=.])\s*\{([A-Za-z])\}/g, (m, a, c) => (ACCENTS[a] && ACCENTS[a][c]) || c);
  t = t.replace(/\\([`'^"~=.])([A-Za-z])/g, (m, a, c) => (ACCENTS[a] && ACCENTS[a][c]) || c);
  t = t.replace(/\{?\\([cvuHkr])\s*\{([A-Za-z])\}\}?/g, (m, a, c) => (ACCENTS[a] && ACCENTS[a][c]) || c);
  t = t.replace(/\{?\\([cvuHkr]) ([A-Za-z])\}?/g, (m, a, c) => (ACCENTS[a] && ACCENTS[a][c]) || c);
  t = t.replace(/\{?\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|textendash|textemdash|textquoteright|textquoteleft)\b\s*\}?/g, (m, k) => SYMBOLS[k] || k);
  t = t.replace(/\\([&%$#_])/g, '$1');
  t = t.replace(/\\(emph|textit|textbf|textsc|texttt|mathrm|mathit|mbox)\s*\{([^{}]*)\}/g, '$2');
  t = t.replace(/---/g, '—').replace(/--/g, '–');
  t = t.replace(/``|''/g, '"');
  t = t.replace(/~/g, ' ');
  t = t.replace(/[{}]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------- BibTeX */

function readValue(src, i, macros) {
  const parts = [];
  for (;;) {
    while (i < src.length && /\s/.test(src.charAt(i))) i++;
    const ch = src.charAt(i);
    if (ch === '{') {
      let depth = 0;
      const start = i + 1;
      for (; i < src.length; i++) {
        const c = src.charAt(i);
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      parts.push(src.slice(start, i));
      i++;
    } else if (ch === '"') {
      let depth = 0;
      const start = i + 1;
      i++;
      for (; i < src.length; i++) {
        const c = src.charAt(i);
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '"' && depth === 0) break;
      }
      parts.push(src.slice(start, i));
      i++;
    } else {
      const m = /^[A-Za-z0-9_:.+\-/]+/.exec(src.slice(i));
      if (m === null) break;
      const word = m[0];
      parts.push(/^\d+$/.test(word) ? word : macros[word.toLowerCase()] !== undefined ? macros[word.toLowerCase()] : word);
      i += word.length;
    }
    while (i < src.length && /\s/.test(src.charAt(i))) i++;
    if (src.charAt(i) === '#') {
      i++;
      continue;
    }
    break;
  }
  return { value: parts.join(''), next: i };
}

/** Entries of a BibTeX file: [{ type, key, fields }]. */
function parseBibtex(src) {
  const entries = [];
  const macros = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
  let i = 0;
  const errors = [];
  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at < 0) break;
    const m = /^@\s*([A-Za-z]+)\s*([{(])/.exec(src.slice(at));
    if (m === null) {
      i = at + 1;
      continue;
    }
    const type = m[1].toLowerCase();
    const close = m[2] === '{' ? '}' : ')';
    i = at + m[0].length;
    if (type === 'comment' || type === 'preamble') {
      let depth = 1;
      for (; i < src.length && depth > 0; i++) {
        const c = src.charAt(i);
        if (c === m[2]) depth++;
        else if (c === close) depth--;
      }
      continue;
    }
    if (type === 'string') {
      const k = /^\s*([A-Za-z0-9_:-]+)\s*=/.exec(src.slice(i));
      if (k !== null) {
        const v = readValue(src, i + k[0].length, macros);
        macros[k[1].toLowerCase()] = v.value;
        i = v.next;
      }
      while (i < src.length && src.charAt(i) !== close) i++;
      i++;
      continue;
    }
    const keyM = /^\s*([^,\s]*)\s*,/.exec(src.slice(i));
    let key = '';
    if (keyM !== null) {
      key = keyM[1];
      i += keyM[0].length;
    }
    const fields = {};
    for (let guard = 0; guard < 500; guard++) {
      while (i < src.length && /[\s,]/.test(src.charAt(i))) i++;
      if (i >= src.length || src.charAt(i) === close) {
        i++;
        break;
      }
      const f = /^([A-Za-z0-9_:.+-]+)\s*=/.exec(src.slice(i));
      if (f === null) {
        errors.push('Entry ' + (key || '#' + (entries.length + 1)) + ': could not read a field');
        while (i < src.length && src.charAt(i) !== close) i++;
        i++;
        break;
      }
      const v = readValue(src, i + f[0].length, macros);
      fields[f[1].toLowerCase()] = v.value;
      i = v.next;
    }
    entries.push({ type: type, key: key, fields: fields });
  }
  return { entries: entries, errors: errors };
}

/** BibTeX names: "Last, First and First von Last and {Organization}". */
function bibNames(raw) {
  const list = [];
  let depth = 0;
  let cur = '';
  const s = String(raw || '');
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (depth === 0 && /\s/.test(c) && s.slice(i).match(/^\s+and\s+/i)) {
      list.push(cur);
      cur = '';
      i += s.slice(i).match(/^\s+and\s+/i)[0].length - 1;
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== '') list.push(cur);
  return list
    .map((n) => n.trim())
    .filter((n) => n !== '' && n.toLowerCase() !== 'others')
    .map((n) => {
      if (/^\{[^{}]*\}$/.test(n)) return { literal: delatex(n) };
      const commaParts = [];
      let d = 0;
      let part = '';
      for (const c of n) {
        if (c === '{') d++;
        if (c === '}') d--;
        if (c === ',' && d === 0) {
          commaParts.push(part);
          part = '';
        } else part += c;
      }
      commaParts.push(part);
      if (commaParts.length >= 2) {
        const out = { family: delatex(commaParts[0]) };
        const given = delatex(commaParts[commaParts.length - 1]);
        if (given !== '') out.given = given;
        return out;
      }
      const split = require(`${__hooks}/lib_registry.js`).splitName(delatex(n));
      return split || { literal: delatex(n) };
    });
}

const BIB_TO = {
  article: 'article',
  inproceedings: 'conference',
  conference: 'conference',
  proceedings: 'book',
  book: 'book',
  mvbook: 'book',
  booklet: 'book',
  inbook: 'chapter',
  incollection: 'chapter',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  dataset: 'dataset',
  software: 'software',
  online: 'webpage',
  electronic: 'webpage',
  www: 'webpage',
  unpublished: 'other',
  misc: 'other',
};

function fromBibtex(e) {
  const f = e.fields;
  const ident = require(`${__hooks}/lib_ident.js`);
  const g = (k) => delatex(f[k] || '');
  let type = BIB_TO[e.type] || 'other';
  const out = { key: e.key, type: type, fields: {}, ids: {} };
  const set = (k, v) => {
    if (v !== '' && v !== undefined && v !== null) out.fields[k] = v;
  };
  set('title', g('title'));
  set('subtitle', g('subtitle'));
  if (f.author) out.fields.authors = bibNames(f.author);
  if (f.editor) out.fields.editors = bibNames(f.editor);
  const year = /(\d{4})/.exec(String(f.year || f.date || ''));
  if (year) out.fields.year = Number(year[1]);
  const date = /^(\d{4})(-\d{2})?(-\d{2})?/.exec(String(f.date || ''));
  if (date) out.fields.issued = date[0];
  set('container', type === 'article' ? g('journal') || g('journaltitle') : g('booktitle') || g('journal') || g('journaltitle'));
  set('container_short', g('shortjournal'));
  set('volume', g('volume'));
  set('issue', g('number') || g('issue'));
  set('pages', g('pages').replace(/–/g, '-'));
  set('publisher', g('publisher') || g('school') || g('institution') || g('organization'));
  set('place', g('address') || g('location'));
  set('edition', g('edition'));
  set('abstract', g('abstract'));
  set('url', String(f.url || '').trim());
  set('language', g('language') || g('langid'));
  if (f.keywords) out.fields.keywords = String(delatex(f.keywords)).split(/[,;]/).map((x) => x.trim()).filter((x) => x !== '');
  if (f.note) out.fields.note = g('note');
  const doi = ident.cleanDoi(String(f.doi || '').trim());
  if (doi) out.ids.doi = doi;
  const eprintType = String(f.archiveprefix || f.eprinttype || '').toLowerCase();
  if (f.eprint && (eprintType === 'arxiv' || ident.cleanArxiv(String(f.eprint)) !== null)) {
    const ax = ident.cleanArxiv(String(f.eprint).trim());
    if (ax) {
      out.ids.arxiv_id = ax;
      if (type === 'other') type = 'preprint';
    }
  }
  if (f.pmid && /^\d{1,9}$/.test(String(f.pmid).trim())) out.ids.pmid = String(f.pmid).trim();
  if (f.isbn) {
    const isbn = ident.cleanIsbn(String(f.isbn).split(/[ ,;]/)[0]);
    if (isbn) out.fields.isbn = isbn;
  }
  set('issn', g('issn'));
  out.type = type;
  return out;
}

/* ------------------------------------------------------------------ RIS */

const RIS_TO = { JOUR: 'article', JFULL: 'article', MGZN: 'article', NEWS: 'article', EJOUR: 'article', BOOK: 'book', EBOOK: 'book', EDBOOK: 'book', CHAP: 'chapter', ECHAP: 'chapter', CONF: 'conference', CPAPER: 'conference', THES: 'thesis', RPRT: 'report', DATA: 'dataset', COMP: 'software', ELEC: 'webpage', WEB: 'webpage', UNPB: 'other', GEN: 'other', MANSCPT: 'other' };

function parseRis(src) {
  const entries = [];
  let cur = null;
  for (const raw of String(src).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  -\s?(.*)$/.exec(raw);
    if (m === null) {
      if (cur !== null && cur.last && raw.trim() !== '') cur.tags[cur.last][cur.tags[cur.last].length - 1] += ' ' + raw.trim();
      continue;
    }
    const tag = m[1];
    const val = m[2].trim();
    if (tag === 'TY') {
      cur = { tags: {}, last: null };
      entries.push(cur);
    }
    if (cur === null) continue;
    if (tag === 'ER') {
      cur = null;
      continue;
    }
    (cur.tags[tag] = cur.tags[tag] || []).push(val);
    cur.last = tag;
  }
  return { entries: entries.map((e) => e.tags), errors: [] };
}

function risPerson(v) {
  const s = String(v || '').trim();
  if (s === '') return null;
  if (s.indexOf(',') > 0) {
    const p = s.split(',');
    const out = { family: p[0].trim() };
    if (p.slice(1).join(',').trim() !== '') out.given = p.slice(1).join(',').trim();
    return out;
  }
  return require(`${__hooks}/lib_registry.js`).splitName(s) || { literal: s };
}

function fromRis(t) {
  const ident = require(`${__hooks}/lib_ident.js`);
  const one = (...keys) => {
    for (const k of keys) if (t[k] && t[k][0]) return t[k][0];
    return '';
  };
  const out = { key: one('ID'), type: RIS_TO[one('TY')] || 'other', fields: {}, ids: {} };
  const set = (k, v) => {
    if (v !== '' && v !== undefined) out.fields[k] = v;
  };
  set('title', one('TI', 'T1'));
  const authors = (t.AU || []).concat(t.A1 || []).map(risPerson).filter(Boolean);
  if (authors.length > 0) out.fields.authors = authors;
  const editors = (t.ED || []).concat(t.A2 || []).map(risPerson).filter(Boolean);
  if (editors.length > 0 && out.type !== 'article') out.fields.editors = editors;
  set('container', one('T2', 'JO', 'JF', 'BT', 'JA'));
  set('container_short', one('J2', 'JA'));
  const y = /(\d{4})/.exec(one('PY', 'Y1', 'DA'));
  if (y) out.fields.year = Number(y[1]);
  const da = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(one('DA', 'PY'));
  if (da) out.fields.issued = da[1] + '-' + da[2] + '-' + da[3];
  set('volume', one('VL'));
  set('issue', one('IS'));
  const sp = one('SP');
  const ep = one('EP');
  set('pages', sp !== '' && ep !== '' ? sp + '-' + ep : sp);
  set('publisher', one('PB'));
  set('place', one('CY'));
  set('edition', one('ET'));
  set('abstract', one('AB', 'N2'));
  set('url', one('UR', 'L2'));
  set('language', one('LA'));
  if (t.KW) out.fields.keywords = t.KW.slice(0, 50);
  const doi = ident.cleanDoi(one('DO', 'M3') || '');
  if (doi) out.ids.doi = doi;
  const sn = one('SN');
  const isbn = sn !== '' ? ident.cleanIsbn(sn) : null;
  if (isbn) out.fields.isbn = isbn;
  else set('issn', sn);
  if (one('AN') !== '' && /^\d{1,9}$/.test(one('AN')) && /pubmed/i.test(one('DB', 'DP'))) out.ids.pmid = one('AN');
  return out;
}

/* ------------------------------------------------------------- CSL-JSON */

const CSL_TO = { 'article-journal': 'article', article: 'preprint', 'article-magazine': 'article', 'article-newspaper': 'article', 'paper-conference': 'conference', book: 'book', chapter: 'chapter', thesis: 'thesis', report: 'report', dataset: 'dataset', software: 'software', webpage: 'webpage', 'post-weblog': 'webpage' };

function fromCsl(o) {
  const ident = require(`${__hooks}/lib_ident.js`);
  const out = { key: String(o.id || o['citation-key'] || ''), type: CSL_TO[String(o.type || '')] || 'other', fields: {}, ids: {} };
  const set = (k, v) => {
    if (v !== '' && v !== undefined && v !== null) out.fields[k] = String(v).trim();
  };
  set('title', o.title);
  const person = (a) => (a && (a.family || a.literal) ? (a.family ? Object.assign({ family: String(a.family) }, a.given ? { given: String(a.given) } : {}) : { literal: String(a.literal) }) : null);
  if (Array.isArray(o.author)) out.fields.authors = o.author.map(person).filter(Boolean);
  if (Array.isArray(o.editor)) out.fields.editors = o.editor.map(person).filter(Boolean);
  const dp = o.issued && Array.isArray(o.issued['date-parts']) ? o.issued['date-parts'][0] : null;
  if (Array.isArray(dp) && Number(dp[0]) > 0) {
    out.fields.year = Number(dp[0]);
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    out.fields.issued = String(dp[0]) + (dp[1] ? '-' + pad(Number(dp[1])) : '') + (dp[1] && dp[2] ? '-' + pad(Number(dp[2])) : '');
  }
  set('container', o['container-title']);
  set('container_short', o['container-title-short']);
  set('volume', o.volume);
  set('issue', o.issue);
  set('pages', o.page);
  set('article_number', o.number);
  set('publisher', o.publisher);
  set('place', o['publisher-place']);
  set('edition', o.edition);
  set('abstract', o.abstract);
  set('url', o.URL);
  set('language', o.language);
  if (typeof o.keyword === 'string') out.fields.keywords = o.keyword.split(/[,;]/).map((x) => x.trim()).filter((x) => x !== '');
  const doi = ident.cleanDoi(String(o.DOI || ''));
  if (doi) out.ids.doi = doi;
  if (o.PMID && /^\d{1,9}$/.test(String(o.PMID))) out.ids.pmid = String(o.PMID);
  if (o.ISBN) {
    const isbn = ident.cleanIsbn(String(o.ISBN).split(/[ ,;]/)[0]);
    if (isbn) out.fields.isbn = isbn;
  }
  set('issn', o.ISSN);
  const archive = /^arxiv:(.+)$/i.exec(String(o.archive || o.number || ''));
  if (archive) {
    const ax = ident.cleanArxiv(archive[1]);
    if (ax) out.ids.arxiv_id = ax;
  }
  return out;
}

/* --------------------------------------------------------------- import */

function detect(name, textValue) {
  const n = String(name || '').toLowerCase();
  if (/\.bib$/.test(n)) return 'bibtex';
  if (/\.(ris|txt|nbib)$/.test(n)) return 'ris';
  if (/\.json$/.test(n)) return 'csljson';
  const t = String(textValue).trimStart();
  if (t.charAt(0) === '[' || t.charAt(0) === '{') return 'csljson';
  if (/^TY  - /m.test(t)) return 'ris';
  if (/^@\s*[A-Za-z]+\s*[{(]/m.test(t)) return 'bibtex';
  return '';
}

function parse(kind, textValue) {
  if (kind === 'bibtex') {
    const r = parseBibtex(textValue);
    return { items: r.entries.map(fromBibtex), errors: r.errors };
  }
  if (kind === 'ris') {
    const r = parseRis(textValue);
    return { items: r.entries.map(fromRis), errors: [] };
  }
  let data;
  try {
    data = JSON.parse(textValue);
  } catch {
    throw u().fail(400, 'This file is not valid JSON.', 'invalid_file');
  }
  if (!Array.isArray(data)) data = Array.isArray(data.items) ? data.items : [data];
  return { items: data.map(fromCsl), errors: [] };
}

/** What would become of each entry. */
function classify(app, items) {
  const W = require(`${__hooks}/lib_works.js`);
  return items.map((it, i) => {
    let existing = null;
    for (const k of ['doi', 'arxiv_id', 'pmid']) {
      if (existing === null && it.ids[k]) existing = u().findOne(app, 'works', k + ' = {:v}', { v: it.ids[k] });
    }
    const hasId = Object.keys(it.ids).length > 0;
    return {
      index: i,
      key: it.key,
      type: it.type,
      title: it.fields.title || '(no title)',
      authors: core().authorsShort(it.fields.authors || []),
      year: it.fields.year || 0,
      identifiers: it.ids,
      outcome: existing !== null ? 'existing' : hasId ? 'new_identified' : 'new_manual',
      existing: existing !== null ? { id: existing.id, title: existing.getString('title') } : null,
      problem: it.fields.title ? '' : 'no title',
    };
  });
}

/** import.preview: read a file and show what would be imported. */
function preview(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ups = ctx.e ? util.uploadedAll(ctx.e, 'file') : [];
  let textValue = '';
  let name = '';
  if (ups.length > 0) {
    const f = ups[0];
    name = f.originalName;
    textValue = readUpload(f);
  } else if (util.str(p, 'path', '') !== '') {
    const lf = util.localFile(ctx, util.str(p, 'path', ''), 'path');
    name = $filepath.base(lf.path);
    textValue = toString($os.readFile(lf.path));
  } else if (util.has(p, 'text')) {
    textValue = String(p.text || '');
    name = util.str(p, 'filename', 'pasted');
  } else throw util.fail(400, 'Upload the file, give --path, or paste --text.', 'missing_param');
  if (textValue.length > 50 * 1024 * 1024) throw util.fail(400, 'The file is larger than 50 MB.', 'too_large');
  const kind = util.oneOf(p, 'kind', ['bibtex', 'ris', 'csljson'], detect(name, textValue));
  if (kind === '') throw util.fail(400, 'This is not a BibTeX, RIS or CSL-JSON file.', 'unknown_format');
  const parsed = parse(kind, textValue);
  if (parsed.items.length === 0) throw util.fail(400, 'No entries were found in the file.', 'empty_file');
  if (parsed.items.length > 20000) throw util.fail(400, 'At most 20,000 entries per import.', 'too_many');
  const rows = classify(app, parsed.items);
  const counts = { total: rows.length, new_identified: rows.filter((r) => r.outcome === 'new_identified').length, new_manual: rows.filter((r) => r.outcome === 'new_manual').length, existing: rows.filter((r) => r.outcome === 'existing').length, problems: rows.filter((r) => r.problem !== '').length, parse_errors: parsed.errors.length };
  const b = util.newRecord(app, 'import_batches');
  b.set('kind', kind);
  b.set('filename', name.slice(0, 300));
  b.set('status', 'previewed');
  b.set('actor', ctx.actor);
  b.set('counts', counts);
  b.set('entries', parsed.items);
  b.set('result', {});
  b.set('target_collection', util.str(p, 'collection', ''));
  b.set('target_project', util.str(p, 'project', ''));
  app.save(b);
  return { import: b.id, kind: kind, filename: name, counts: counts, rows: rows.slice(0, 500), errors: parsed.errors.slice(0, 20) };
}

/** The text of an uploaded file (read from the upload itself, at most 50 MB). */
function readUpload(f) {
  const r = f.reader.open();
  try {
    return toString(r, 50 * 1024 * 1024);
  } finally {
    r.close();
  }
}

/** import.run: make the papers of a previewed import. */
function run(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = core().need(app, 'import_batches', util.req(p, 'import'), 'import');
  if (b.getString('status') !== 'previewed') throw util.fail(409, 'This import was already ' + b.getString('status') + '.', 'invalid_state');
  const items = util.jsonOf(b, 'entries') || [];
  const skipExisting = util.bool(p, 'skip_existing', true);
  const W = require(`${__hooks}/lib_works.js`);
  const S = require(`${__hooks}/lib_search.js`);
  const created = [];
  const existing = [];
  let cid = b.getString('target_collection');
  let pid = b.getString('target_project');
  if (util.str(p, 'collection', '') !== '') cid = util.str(p, 'collection', '');
  if (util.str(p, 'project', '') !== '') pid = util.str(p, 'project', '');
  if (cid !== '') cid = core().need(app, 'collections', cid, 'collection').id;
  if (pid !== '') {
    const pr = core().project(app, pid);
    core().guardProject(ctx, pr);
    pid = pr.id;
  }
  app.runInTransaction((tx) => {
    for (const it of items) {
      let hit = null;
      for (const k of ['doi', 'arxiv_id', 'pmid']) if (hit === null && it.ids[k]) hit = util.findOne(tx, 'works', k + ' = {:v}', { v: it.ids[k] });
      if (hit !== null) {
        existing.push(hit.id);
        if (!skipExisting) continue;
        continue;
      }
      if (!it.fields.title) continue;
      const hasId = Object.keys(it.ids).length > 0;
      const resolution = hasId ? 'resolving' : ctx.isAgent ? 'pending' : 'manual';
      const w = W.newWork(tx, ctx, { title: String(it.fields.title).slice(0, 2000), resolution: resolution, resolved_via: hasId ? '' : 'import', source: 'import', import_batch: b.id });
      w.set('type', W.TYPES.indexOf(it.type) >= 0 ? it.type : 'other');
      const edited = [];
      for (const k of Object.keys(it.fields)) {
        if (k === 'note') continue;
        if (W.FIELDS.indexOf(k) < 0 && k !== 'isbn') continue;
        w.set(k, it.fields[k]);
        edited.push(k);
      }
      w.set('edited', edited);
      if (it.fields.note) w.set('extra', { note: it.fields.note });
      for (const k of Object.keys(it.ids)) w.set(k, it.ids[k]);
      if (it.key && /^[A-Za-z0-9_:.-]{1,120}$/.test(it.key) && util.count(tx, 'SELECT COUNT(*) AS n FROM works WHERE LOWER(citekey) = LOWER({:k})', { k: it.key }) === 0) {
        w.set('citekey', it.key);
        edited.push('citekey');
        w.set('edited', edited);
      }
      tx.save(w);
      if (w.getString('citekey') === '') {
        w.set('citekey', W.makeCitekey(tx, w));
        tx.save(w);
      }
      S.indexWork(tx, w);
      created.push(w.id);
    }
    W.place(tx, ctx, created.concat(existing), cid, pid);
    const r = tx.findRecordById('import_batches', b.id);
    r.set('status', 'imported');
    r.set('result', { created: created, existing: existing });
    r.set('entries', []);
    tx.save(r);
    require(`${__hooks}/lib_activity.js`).write(tx, ctx, { label: 'Imported ' + created.length + ' papers from ' + b.getString('filename'), target: 'import_batches', record: b.id, project: pid, undo: { fn: 'lib_import.undoRun', args: { import: b.id } } });
  });
  if (created.length > 0) W.wakeResolver(app);
  return { import: b.id, created: created.length, existing: existing.length };
}

function undoRun(ctx, args) {
  undo(ctx, { import: args.import });
}

/** import.undo: remove exactly the papers an import made. */
function undo(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = core().need(app, 'import_batches', util.req(p, 'import'), 'import');
  if (b.getString('status') !== 'imported') throw util.fail(409, 'Only a finished import can be undone.', 'invalid_state');
  const res = util.jsonOf(b, 'result') || {};
  const ids = res.created || [];
  app.runInTransaction((tx) => {
    for (const id of ids) {
      const w = util.byId(tx, 'works', id);
      if (w === null) continue;
      require(`${__hooks}/lib_search.js`).dropWork(tx, id);
      tx.delete(w);
    }
    const r = tx.findRecordById('import_batches', b.id);
    r.set('status', 'undone');
    tx.save(r);
  });
  return { removed: ids.length };
}

function list(ctx) {
  return {
    imports: ctx.app.findRecordsByFilter('import_batches', '', '-created', 50, 0).map((b) => ({ id: b.id, kind: b.getString('kind'), filename: b.getString('filename'), status: b.getString('status'), counts: u().jsonOf(b, 'counts'), actor: b.getString('actor'), created: b.getString('created') })),
  };
}

module.exports = { delatex: delatex, parseBibtex: parseBibtex, bibNames: bibNames, fromBibtex: fromBibtex, parseRis: parseRis, fromRis: fromRis, fromCsl: fromCsl, detect: detect, parse: parse, preview: preview, run: run, undoRun: undoRun, undo: undo, list: list };
