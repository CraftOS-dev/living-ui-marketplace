/// <reference path="../pb_data/types.d.ts" />
/**
 * Scholarly identifiers, parsed by their own formal syntax:
 *
 *   DOI      10.<registrant>/<suffix>, also doi:, https://doi.org/...
 *   arXiv    2401.01234, 2401.01234v2, hep-th/9901001, arxiv:..., arxiv.org/abs|pdf/...
 *   PubMed   pmid:12345678, pubmed.ncbi.nlm.nih.gov/12345678, or a bare number of up to 9 digits
 *   PMC      PMC1234567
 *   ISBN     10 or 13 digits with a valid check digit (hyphens and spaces allowed)
 *   OpenAlex W1234567890, openalex.org/W...
 *
 * Input that is none of these is refused by the caller with the formats it
 * takes. Nothing here guesses from prose: a value either has the syntax or it
 * does not.
 */

function cleanDoi(s) {
  let d = String(s).trim();
  d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  try {
    if (d.indexOf('%') >= 0) d = decodeURIComponent(d);
  } catch {
    /* keep as typed */
  }
  d = d.replace(/[.,;]+$/, '');
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d.toLowerCase() : null;
}

function cleanArxiv(s) {
  let a = String(s).trim();
  a = a.replace(/^https?:\/\/(export\.)?arxiv\.org\/(abs|pdf)\//i, '').replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '');
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(a)) return a.replace(/v\d+$/, '');
  if (/^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/.test(a)) return a.replace(/v\d+$/, '');
  return null;
}

function isbnDigits(s) {
  return String(s).replace(/[\s-]/g, '').toUpperCase();
}

function isbn10ok(d) {
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d.charAt(i) === 'X' ? 10 : Number(d.charAt(i))) * (10 - i);
  return sum % 11 === 0;
}

function isbn13ok(d) {
  if (!/^97[89]\d{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(d.charAt(i)) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

/** ISBN-10 or -13 with a valid check digit, as ISBN-13 (null otherwise). */
function cleanIsbn(s) {
  const d = isbnDigits(String(s).replace(/^isbn(-1[03])?:?\s*/i, ''));
  if (isbn13ok(d)) return d;
  if (isbn10ok(d)) {
    const core = '978' + d.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(core.charAt(i)) * (i % 2 === 0 ? 1 : 3);
    return core + String((10 - (sum % 10)) % 10);
  }
  return null;
}

/** One identifier → { kind, value, display } or null. */
function parse(input) {
  const s = String(input || '').trim();
  if (s === '') return null;
  const doi = cleanDoi(s);
  if (doi !== null) return { kind: 'doi', value: doi, display: doi };
  const ax = cleanArxiv(s);
  if (ax !== null) return { kind: 'arxiv', value: ax, display: 'arXiv:' + ax };
  let m = /^(?:pmid:\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)(\d{1,9})\/?$/i.exec(s);
  if (m !== null) return { kind: 'pmid', value: m[1], display: 'PMID ' + m[1] };
  m = /^(?:https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\/)?(PMC\d{3,10})\/?$/i.exec(s);
  if (m !== null) return { kind: 'pmcid', value: m[1].toUpperCase(), display: m[1].toUpperCase() };
  m = /^(?:https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?)?(W\d{4,12})$/.exec(s);
  if (m !== null) return { kind: 'openalex', value: m[1], display: 'OpenAlex ' + m[1] };
  const isbn = cleanIsbn(s);
  if (isbn !== null) return { kind: 'isbn', value: isbn, display: 'ISBN ' + isbn };
  if (/^\d{1,9}$/.test(s)) return { kind: 'pmid', value: s, display: 'PMID ' + s };
  return null;
}

/** Many identifiers from one box (lines, spaces, commas, semicolons). */
function parseMany(textValue) {
  const tokens = String(textValue || '')
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
  const ok = [];
  const bad = [];
  const seen = {};
  for (const t of tokens) {
    const p = parse(t);
    if (p === null) {
      bad.push(t);
      continue;
    }
    const key = p.kind + ':' + p.value;
    if (seen[key]) continue;
    seen[key] = true;
    ok.push(p);
  }
  return { ok: ok, bad: bad };
}

const FORMATS = 'a DOI (10.1038/nature14539), an arXiv ID (1706.03762), a PubMed ID (pmid:26017442), a PMC ID (PMC4699111), an ISBN (9780262035613) or an OpenAlex ID (W2919115771)';

module.exports = { parse: parse, parseMany: parseMany, cleanDoi: cleanDoi, cleanArxiv: cleanArxiv, cleanIsbn: cleanIsbn, FORMATS: FORMATS };
