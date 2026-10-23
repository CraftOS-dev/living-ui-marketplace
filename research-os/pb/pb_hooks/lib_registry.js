/// <reference path="../pb_data/types.d.ts" />
/**
 * Public scholarly registries, all keyless:
 *
 *   Crossref      works by DOI (with Retraction Watch updates), search
 *   arXiv         the Atom API: entries by id, search
 *   OpenAlex      works, references, citing works, search (a shared free
 *                 daily budget per network without a key)
 *   PubMed        E-utilities: esearch, esummary, efetch (abstracts)
 *   Open Library  books by ISBN
 *
 * Every answer is normalized to one metadata shape (see `blank`). A registry
 * that does not answer throws `unreachable` (the caller keeps an honest
 * state and retries later); a registry that has no such record returns null.
 * Nothing here invents a value: a field the registry lacks stays empty.
 */

const CROSSREF = 'https://api.crossref.org';
const ARXIV = 'https://export.arxiv.org/api/query';
const OPENALEX = 'https://api.openalex.org';
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const OPENLIBRARY = 'https://openlibrary.org';

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function email(app) {
  try {
    return require(`${__hooks}/lib_core.js`).settings(app).getString('contact_email');
  } catch {
    return '';
  }
}

function enc(s) {
  return encodeURIComponent(String(s));
}

/** One GET. kind: 'json' | 'text'. Returns { status, json, text } or throws unreachable. */
function fetch(app, url, kind, timeout) {
  const util = u();
  const mail = email(app);
  const headers = { 'User-Agent': 'ResearchOS/1.0' + (mail !== '' ? ' (mailto:' + mail + ')' : ''), Accept: kind === 'json' ? 'application/json' : '*/*' };
  let res;
  try {
    res = $http.send({ url: url, method: 'GET', headers: headers, timeout: timeout || 25 });
  } catch (err) {
    console.error('[ro] registry unreachable', url, String(err));
    throw util.fail(502, 'The registry did not answer (' + hostOf(url) + '). It is tried again later.', 'unreachable', { host: hostOf(url) });
  }
  const st = res.statusCode;
  if (st === 404 || st === 410) return { status: 404, json: null, text: '' };
  if (st === 429 || st >= 500 || st === 403) {
    console.error('[ro] registry status', st, url);
    throw util.fail(502, hostOf(url) + ' answered ' + st + (st === 429 ? ' (too many requests for now)' : '') + '. It is tried again later.', 'unreachable', { host: hostOf(url), http: st });
  }
  if (st !== 200) return { status: st, json: null, text: '' };
  if (kind === 'json') return { status: 200, json: res.json, text: '' };
  return { status: 200, json: null, text: toString(res.body) };
}

function hostOf(url) {
  const m = /^https?:\/\/([^/]+)/.exec(String(url));
  return m ? m[1] : String(url);
}

/* ----------------------------------------------------------- text tools */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Markup (JATS, HTML, MathML) to plain text: titles inside markup are dropped as elements, never by wording. */
function stripMarkup(s) {
  let t = String(s || '');
  t = t.replace(/<(jats:)?title[^>]*>[\s\S]*?<\/(jats:)?title>/gi, ' ');
  t = t.replace(/<\/(jats:)?p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeEntities(t);
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function squash(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * A display name ("Ashish Vaswani", "Ludwig van Beethoven") as given and
 * family names: the last word is the family name, with lower-case particles
 * before it (van, de, von) kept with it. "Family, Given" is read as written.
 */
function splitName(display) {
  const n = squash(display);
  if (n === '') return null;
  if (n.indexOf(',') > 0) {
    const parts = n.split(',');
    return { family: parts[0].trim(), given: parts.slice(1).join(',').trim() };
  }
  const words = n.split(' ');
  if (words.length === 1) return { family: words[0] };
  let i = words.length - 1;
  while (i > 1 && /^[a-z]/.test(words[i - 1])) i--;
  return { family: words.slice(i).join(' '), given: words.slice(0, i).join(' ') };
}

/** The empty metadata shape every registry fills. */
function blank() {
  return {
    type: 'other',
    title: '',
    subtitle: '',
    authors: [],
    editors: [],
    year: 0,
    issued: '',
    container: '',
    container_short: '',
    volume: '',
    issue: '',
    pages: '',
    article_number: '',
    publisher: '',
    place: '',
    edition: '',
    isbn: '',
    issn: '',
    abstract: '',
    doi: '',
    arxiv_id: '',
    pmid: '',
    pmcid: '',
    openalex_id: '',
    url: '',
    language: '',
    keywords: [],
    cited_by: 0,
    refs_count: 0,
    oa_url: '',
    oa_pdf_url: '',
    oa_status: '',
    integrity: null,
    references: [],
    related_doi: '',
    source: '',
  };
}

function issuedOf(parts) {
  if (!Array.isArray(parts) || parts.length === 0 || !Array.isArray(parts[0])) return { year: 0, issued: '' };
  const p = parts[0];
  const y = Number(p[0]) || 0;
  if (y <= 0) return { year: 0, issued: '' };
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  let issued = String(y);
  if (p.length > 1 && Number(p[1]) >= 1) issued += '-' + pad(Number(p[1]));
  if (p.length > 2 && Number(p[2]) >= 1) issued += '-' + pad(Number(p[2]));
  return { year: y, issued: issued };
}

/* ------------------------------------------------------------- Crossref */

const CROSSREF_TYPES = {
  'journal-article': 'article',
  'proceedings-article': 'conference',
  'posted-content': 'preprint',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  'reference-entry': 'chapter',
  dissertation: 'thesis',
  report: 'report',
  'report-component': 'report',
  dataset: 'dataset',
  database: 'dataset',
  standard: 'report',
};

function crossrefPerson(a) {
  const out = {};
  if (a.family) out.family = String(a.family);
  if (a.given) out.given = String(a.given);
  if (!a.family && a.name) out.literal = String(a.name);
  if (a.ORCID) out.orcid = String(a.ORCID).replace(/^https?:\/\/orcid\.org\//, '');
  return out;
}

/** Crossref's update notices (Retraction Watch) as an integrity state. */
function crossrefIntegrity(m) {
  const ups = Array.isArray(m['updated-by']) ? m['updated-by'] : [];
  let state = 'clear';
  const notices = [];
  for (const up of ups) {
    const t = String(up.type || '').toLowerCase();
    const when = up.updated && up.updated['date-time'] ? String(up.updated['date-time']).slice(0, 10) : '';
    notices.push({ type: t, doi: String(up.DOI || ''), date: when, source: String(up.source || '') });
    if (t === 'retraction' || t === 'withdrawal' || t === 'removal') state = 'retracted';
    else if ((t === 'expression_of_concern' || t === 'expression-of-concern') && state !== 'retracted') state = 'concern';
    else if ((t === 'correction' || t === 'erratum' || t === 'corrigendum') && state === 'clear') state = 'corrected';
  }
  return { state: state, notices: notices };
}

function fromCrossref(m) {
  const out = blank();
  out.source = 'crossref';
  out.type = CROSSREF_TYPES[String(m.type || '')] || 'other';
  out.title = squash(stripMarkup(Array.isArray(m.title) ? m.title[0] || '' : m.title || ''));
  out.subtitle = squash(stripMarkup(Array.isArray(m.subtitle) ? m.subtitle[0] || '' : ''));
  out.authors = (Array.isArray(m.author) ? m.author : []).map(crossrefPerson).filter((a) => a.family || a.literal);
  out.editors = (Array.isArray(m.editor) ? m.editor : []).map(crossrefPerson).filter((a) => a.family || a.literal);
  const iss = issuedOf((m.issued && m.issued['date-parts']) || (m['published-print'] && m['published-print']['date-parts']) || (m['published-online'] && m['published-online']['date-parts']) || (m.created && m.created['date-parts']));
  out.year = iss.year;
  out.issued = iss.issued;
  out.container = squash(Array.isArray(m['container-title']) ? m['container-title'][0] || '' : '');
  out.container_short = squash(Array.isArray(m['short-container-title']) ? m['short-container-title'][0] || '' : '');
  out.volume = String(m.volume || '');
  out.issue = String(m.issue || '');
  out.pages = String(m.page || '');
  out.article_number = String(m['article-number'] || '');
  out.publisher = String(m.publisher || '');
  out.place = String(m['publisher-location'] || '');
  out.edition = String(m['edition-number'] || '');
  const isbns = Array.isArray(m.ISBN) ? m.ISBN : [];
  if (isbns.length > 0) out.isbn = require(`${__hooks}/lib_ident.js`).cleanIsbn(isbns[0]) || '';
  const issns = Array.isArray(m.ISSN) ? m.ISSN : [];
  out.issn = issns.join(', ');
  out.abstract = stripMarkup(m.abstract || '');
  out.doi = String(m.DOI || '').toLowerCase();
  out.url = out.doi !== '' ? 'https://doi.org/' + out.doi : String(m.URL || '');
  out.language = String(m.language || '');
  out.keywords = Array.isArray(m.subject) ? m.subject.slice(0, 20).map(String) : [];
  out.cited_by = Number(m['is-referenced-by-count'] || 0);
  out.refs_count = Number(m['references-count'] || m['reference-count'] || 0);
  out.integrity = crossrefIntegrity(m);
  out.references = (Array.isArray(m.reference) ? m.reference : []).slice(0, 2000).map((r) => ({
    doi: String(r.DOI || '').toLowerCase(),
    raw: squash(r.unstructured || [r.author, r.year, r['article-title'], r['journal-title'] || r['volume-title']].filter(Boolean).join('. ')),
    title: squash(r['article-title'] || r['volume-title'] || ''),
    year: Number(String(r.year || '').slice(0, 4)) || 0,
    authors: String(r.author || ''),
    venue: squash(r['journal-title'] || r['series-title'] || ''),
  }));
  return out;
}

function crossrefWork(app, doi) {
  const mail = email(app);
  const r = fetch(app, CROSSREF + '/works/' + enc(doi) + (mail !== '' ? '?mailto=' + enc(mail) : ''), 'json');
  if (r.status !== 200 || !r.json || !r.json.message) return null;
  return fromCrossref(r.json.message);
}

/** Crossref search: results in the normalized shape (no references). */
function crossrefSearch(app, query, opts) {
  const o = opts || {};
  const filters = [];
  if (o.from_year) filters.push('from-pub-date:' + o.from_year);
  if (o.to_year) filters.push('until-pub-date:' + o.to_year);
  if (o.type === 'article') filters.push('type:journal-article');
  if (o.type === 'book') filters.push('type:book');
  if (o.type === 'conference') filters.push('type:proceedings-article');
  if (o.type === 'preprint') filters.push('type:posted-content');
  const mail = email(app);
  let url = CROSSREF + '/works?query.bibliographic=' + enc(query) + '&rows=' + (o.rows || 20) + '&select=DOI,title,subtitle,author,issued,container-title,type,is-referenced-by-count,abstract,publisher,volume,issue,page,ISBN,references-count,updated-by';
  if (filters.length > 0) url += '&filter=' + enc(filters.join(','));
  if (mail !== '') url += '&mailto=' + enc(mail);
  const r = fetch(app, url, 'json');
  const items = r.status === 200 && r.json && r.json.message && Array.isArray(r.json.message.items) ? r.json.message.items : [];
  const total = r.status === 200 && r.json && r.json.message ? Number(r.json.message['total-results'] || 0) : 0;
  return { items: items.map(fromCrossref), total: total, url: url };
}

/* ---------------------------------------------------------------- arXiv */

function xmlTag(xml, tag) {
  const re = new RegExp('<' + tag + '(\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>');
  const m = re.exec(xml);
  return m ? m[2] : '';
}

function xmlTags(xml, tag) {
  const re = new RegExp('<' + tag + '(\\s[^>]*)?(/>|>([\\s\\S]*?)</' + tag + '>)', 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push({ attrs: m[1] || '', inner: m[3] || '' });
  return out;
}

function attr(attrs, name) {
  const m = new RegExp(name + '="([^"]*)"').exec(attrs);
  return m ? decodeEntities(m[1]) : '';
}

function fromArxivEntry(xml) {
  const out = blank();
  out.source = 'arxiv';
  const idUrl = squash(xmlTag(xml, 'id'));
  const m = /arxiv\.org\/abs\/(.+)$/.exec(idUrl);
  if (m === null) return null;
  out.arxiv_id = m[1].replace(/v\d+$/, '');
  out.type = 'preprint';
  out.title = squash(decodeEntities(xmlTag(xml, 'title')));
  out.abstract = squash(decodeEntities(xmlTag(xml, 'summary')));
  const pub = squash(xmlTag(xml, 'published'));
  if (/^\d{4}-\d{2}-\d{2}/.test(pub)) {
    out.year = Number(pub.slice(0, 4));
    out.issued = pub.slice(0, 10);
  }
  out.authors = xmlTags(xml, 'author')
    .map((a) => splitName(decodeEntities(xmlTag(a.inner, 'name'))))
    .filter((n) => n !== null);
  out.related_doi = squash(xmlTag(xml, 'arxiv:doi')).toLowerCase();
  const jref = squash(decodeEntities(xmlTag(xml, 'arxiv:journal_ref')));
  out.container = 'arXiv';
  out.publisher = 'arXiv';
  out.url = 'https://arxiv.org/abs/' + out.arxiv_id;
  out.oa_url = out.url;
  out.oa_pdf_url = 'https://arxiv.org/pdf/' + out.arxiv_id;
  out.oa_status = 'green';
  const cat = xmlTags(xml, 'arxiv:primary_category');
  const cats = xmlTags(xml, 'category').map((c) => attr(c.attrs, 'term')).filter((t) => t !== '');
  out.keywords = cats.slice(0, 10);
  if (cat.length > 0) out.container_short = attr(cat[0].attrs, 'term');
  if (jref !== '') out.journal_ref = jref;
  return out;
}

function arxivParse(text) {
  const entries = [];
  const parts = String(text).split('<entry>');
  for (let i = 1; i < parts.length; i++) {
    const body = parts[i].split('</entry>')[0];
    const e = fromArxivEntry(body);
    if (e !== null && e.title !== '') entries.push(e);
  }
  const total = Number(squash(xmlTag(String(text), 'opensearch:totalResults'))) || entries.length;
  return { items: entries, total: total };
}

function arxivWorks(app, ids) {
  if (ids.length === 0) return [];
  const r = fetch(app, ARXIV + '?id_list=' + enc(ids.join(',')) + '&max_results=' + ids.length, 'text');
  if (r.status !== 200) return [];
  return arxivParse(r.text).items;
}

function arxivSearch(app, query, opts) {
  const o = opts || {};
  const url = ARXIV + '?search_query=' + enc('all:' + query) + '&start=0&max_results=' + (o.rows || 20) + '&sortBy=relevance';
  const r = fetch(app, url, 'text');
  if (r.status !== 200) return { items: [], total: 0, url: url };
  const parsed = arxivParse(r.text);
  let items = parsed.items;
  if (o.from_year) items = items.filter((x) => x.year >= o.from_year);
  if (o.to_year) items = items.filter((x) => x.year <= o.to_year);
  return { items: items, total: parsed.total, url: url };
}

/* ------------------------------------------------------------- OpenAlex */

const OPENALEX_TYPES = {
  article: 'article',
  review: 'article',
  letter: 'article',
  editorial: 'article',
  preprint: 'preprint',
  book: 'book',
  'book-chapter': 'chapter',
  dissertation: 'thesis',
  dataset: 'dataset',
  report: 'report',
  standard: 'report',
};

function oaId(s) {
  const m = /(W\d+)$/.exec(String(s || ''));
  return m ? m[1] : '';
}

function abstractFrom(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const w of Object.keys(index)) for (const pos of index[w]) words[pos] = w;
  return words.filter((x) => x !== undefined).join(' ');
}

function fromOpenAlex(w) {
  const out = blank();
  out.source = 'openalex';
  out.openalex_id = oaId(w.id);
  out.type = OPENALEX_TYPES[String(w.type || '')] || 'other';
  out.title = squash(w.display_name || w.title || '');
  out.authors = (Array.isArray(w.authorships) ? w.authorships : [])
    .map((a) => {
      const p = splitName((a.author && a.author.display_name) || a.raw_author_name || '');
      if (p === null) return null;
      const orcid = a.author && a.author.orcid ? String(a.author.orcid).replace(/^https?:\/\/orcid\.org\//, '') : '';
      if (orcid !== '') p.orcid = orcid;
      return p;
    })
    .filter((a) => a !== null);
  out.year = Number(w.publication_year || 0);
  out.issued = /^\d{4}-\d{2}-\d{2}$/.test(String(w.publication_date || '')) ? String(w.publication_date) : out.year > 0 ? String(out.year) : '';
  const loc = w.primary_location || {};
  out.container = squash((loc.source && loc.source.display_name) || '');
  const b = w.biblio || {};
  out.volume = String(b.volume || '');
  out.issue = String(b.issue || '');
  out.pages = b.first_page ? String(b.first_page) + (b.last_page && b.last_page !== b.first_page ? '-' + b.last_page : '') : '';
  const ids = w.ids || {};
  out.doi = String(w.doi || ids.doi || '').replace(/^https?:\/\/doi\.org\//, '').toLowerCase();
  out.pmid = String(ids.pmid || '').replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, '').replace(/\/$/, '');
  out.pmcid = String(ids.pmcid || '').replace(/^.*\/(PMC\d+)\/?$/, '$1');
  out.url = out.doi !== '' ? 'https://doi.org/' + out.doi : String(loc.landing_page_url || w.id || '');
  out.language = String(w.language || '');
  out.keywords = (Array.isArray(w.keywords) ? w.keywords : []).slice(0, 12).map((k) => String(k.display_name || '')).filter((k) => k !== '');
  out.abstract = abstractFrom(w.abstract_inverted_index);
  out.cited_by = Number(w.cited_by_count || 0);
  out.refs_count = Number(w.referenced_works_count || 0);
  const oa = w.open_access || {};
  out.oa_url = String(oa.oa_url || '');
  out.oa_status = String(oa.oa_status || '');
  const best = w.best_oa_location || {};
  out.oa_pdf_url = String(best.pdf_url || '');
  out.integrity = w.is_retracted === true ? { state: 'retracted', notices: [{ type: 'retraction', doi: '', date: '', source: 'openalex' }] } : null;
  out.referenced = (Array.isArray(w.referenced_works) ? w.referenced_works : []).map(oaId).filter((x) => x !== '');
  return out;
}

const OA_FIELDS = 'id,doi,display_name,publication_year,publication_date,authorships,primary_location,cited_by_count,open_access,best_oa_location,type,biblio,ids,language,keywords,is_retracted,referenced_works_count';

function openalexWork(app, ref) {
  const r = fetch(app, OPENALEX + '/works/' + enc(ref), 'json');
  if (r.status !== 200 || !r.json || !r.json.id) return null;
  return fromOpenAlex(r.json);
}

/** Many OpenAlex works by id (up to 50 per call). */
function openalexMany(app, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = fetch(app, OPENALEX + '/works?filter=openalex_id:' + chunk.join('|') + '&per-page=50&select=' + OA_FIELDS + ',referenced_works', 'json');
    if (r.status === 200 && r.json && Array.isArray(r.json.results)) for (const w of r.json.results) out.push(fromOpenAlex(w));
  }
  return out;
}

/** Works citing an OpenAlex work, most cited first. */
function openalexCiting(app, id, n) {
  const r = fetch(app, OPENALEX + '/works?filter=cites:' + enc(id) + '&sort=cited_by_count:desc&per-page=' + (n || 25) + '&select=' + OA_FIELDS, 'json');
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.results)) return { items: [], total: 0 };
  return { items: r.json.results.map(fromOpenAlex), total: Number((r.json.meta && r.json.meta.count) || 0) };
}

function openalexSearch(app, query, opts) {
  const o = opts || {};
  const filters = [];
  if (o.from_year || o.to_year) filters.push('publication_year:' + (o.from_year || '') + '-' + (o.to_year || ''));
  if (o.oa === true) filters.push('is_oa:true');
  if (o.type === 'article') filters.push('type:article');
  if (o.type === 'preprint') filters.push('type:preprint');
  if (o.type === 'book') filters.push('type:book');
  let url = OPENALEX + '/works?search=' + enc(query) + '&per-page=' + (o.rows || 20) + '&select=' + OA_FIELDS + ',abstract_inverted_index';
  if (filters.length > 0) url += '&filter=' + filters.join(',');
  const r = fetch(app, url, 'json');
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.results)) return { items: [], total: 0, url: url };
  return { items: r.json.results.map(fromOpenAlex), total: Number((r.json.meta && r.json.meta.count) || 0), url: url };
}

/* --------------------------------------------------------------- PubMed */

function pubmedPerson(name) {
  const n = squash(name);
  const m = /^(.+?)\s+([A-Z]{1,4})$/.exec(n);
  if (m !== null) return { family: m[1], given: m[2].split('').join('. ') + '.' };
  return splitName(n) || { literal: n };
}

function fromPubmedSummary(s, abstractText) {
  const out = blank();
  out.source = 'pubmed';
  out.pmid = String(s.uid || '');
  out.type = 'article';
  out.title = squash(decodeEntities(String(s.title || '').replace(/\.$/, '')));
  out.authors = (Array.isArray(s.authors) ? s.authors : []).filter((a) => a.authtype === 'Author' || a.authtype === undefined).map((a) => pubmedPerson(a.name || ''));
  const y = /(\d{4})/.exec(String(s.sortpubdate || s.pubdate || ''));
  out.year = y ? Number(y[1]) : 0;
  const sd = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(String(s.sortpubdate || ''));
  out.issued = sd ? sd[1] + '-' + sd[2] + '-' + sd[3] : out.year > 0 ? String(out.year) : '';
  out.container = squash(s.fulljournalname || s.source || '');
  out.container_short = squash(s.source || '');
  out.volume = String(s.volume || '');
  out.issue = String(s.issue || '');
  out.pages = String(s.pages || '');
  for (const id of Array.isArray(s.articleids) ? s.articleids : []) {
    if (id.idtype === 'doi') out.doi = String(id.value || '').toLowerCase();
    if (id.idtype === 'pmc') out.pmcid = String(id.value || '');
  }
  out.url = 'https://pubmed.ncbi.nlm.nih.gov/' + out.pmid + '/';
  out.language = Array.isArray(s.lang) ? String(s.lang[0] || '') : '';
  out.abstract = abstractText || '';
  return out;
}

function pubmedAbstracts(app, pmids) {
  const out = {};
  if (pmids.length === 0) return out;
  const r = fetch(app, EUTILS + '/efetch.fcgi?db=pubmed&retmode=xml&id=' + pmids.join(','), 'text');
  if (r.status !== 200) return out;
  const arts = String(r.text).split('<PubmedArticle>');
  for (let i = 1; i < arts.length; i++) {
    const a = arts[i];
    const pmid = squash(xmlTag(a, 'PMID'));
    const parts = xmlTags(a, 'AbstractText').map((t) => {
      const label = attr(t.attrs, 'Label');
      const body = squash(decodeEntities(t.inner.replace(/<[^>]+>/g, '')));
      return label !== '' ? label + ': ' + body : body;
    });
    if (pmid !== '') out[pmid] = parts.join('\n\n');
  }
  return out;
}

function pubmedWorks(app, pmids) {
  if (pmids.length === 0) return [];
  const r = fetch(app, EUTILS + '/esummary.fcgi?db=pubmed&retmode=json&id=' + pmids.join(','), 'json');
  if (r.status !== 200 || !r.json || !r.json.result) return [];
  const abs = pubmedAbstracts(app, pmids);
  const out = [];
  for (const id of r.json.result.uids || []) {
    const s = r.json.result[id];
    if (s && !s.error) out.push(fromPubmedSummary(s, abs[id] || ''));
  }
  return out;
}

function pubmedSearch(app, query, opts) {
  const o = opts || {};
  let term = query;
  if (o.from_year || o.to_year) term += ' AND (' + (o.from_year || 1800) + ':' + (o.to_year || 3000) + '[dp])';
  const url = EUTILS + '/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=' + (o.rows || 20) + '&term=' + enc(term);
  const r = fetch(app, url, 'json');
  const ids = r.status === 200 && r.json && r.json.esearchresult ? r.json.esearchresult.idlist || [] : [];
  const total = r.status === 200 && r.json && r.json.esearchresult ? Number(r.json.esearchresult.count || 0) : 0;
  return { items: ids.length > 0 ? pubmedWorks(app, ids) : [], total: total, url: url };
}

/* --------------------------------------------------------- Open Library */

function openlibraryIsbn(app, isbn) {
  const r = fetch(app, OPENLIBRARY + '/api/books?bibkeys=ISBN:' + enc(isbn) + '&format=json&jscmd=data', 'json');
  if (r.status !== 200 || !r.json) return null;
  const b = r.json['ISBN:' + isbn];
  if (!b) return null;
  const out = blank();
  out.source = 'openlibrary';
  out.type = 'book';
  out.title = squash(b.title || '');
  out.subtitle = squash(b.subtitle || '');
  out.authors = (Array.isArray(b.authors) ? b.authors : []).map((a) => splitName(a.name || '')).filter((a) => a !== null);
  const y = /(\d{4})/.exec(String(b.publish_date || ''));
  out.year = y ? Number(y[1]) : 0;
  out.issued = out.year > 0 ? String(out.year) : '';
  out.publisher = (Array.isArray(b.publishers) ? b.publishers : []).map((p) => squash(p.name || '')).filter((x) => x !== '').join(', ');
  out.place = (Array.isArray(b.publish_places) ? b.publish_places : []).map((p) => squash(p.name || '')).filter((x) => x !== '').join(', ');
  out.isbn = isbn;
  out.url = String(b.url || '');
  out.keywords = (Array.isArray(b.subjects) ? b.subjects : []).slice(0, 10).map((s) => squash(s.name || '')).filter((x) => x !== '');
  return out;
}

module.exports = {
  fetch: fetch,
  blank: blank,
  splitName: splitName,
  stripMarkup: stripMarkup,
  crossrefWork: crossrefWork,
  crossrefSearch: crossrefSearch,
  arxivWorks: arxivWorks,
  arxivSearch: arxivSearch,
  openalexWork: openalexWork,
  openalexMany: openalexMany,
  openalexCiting: openalexCiting,
  openalexSearch: openalexSearch,
  oaId: oaId,
  pubmedWorks: pubmedWorks,
  pubmedSearch: pubmedSearch,
  openlibraryIsbn: openlibraryIsbn,
};
