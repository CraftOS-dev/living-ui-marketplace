/// <reference path="../pb_data/types.d.ts" />
/**
 * Normalizing what identifies a record: email addresses (lowercase, trimmed),
 * root domains (scheme, www, path and subdomains dropped; co.uk-style
 * suffixes kept), phone numbers, links, names, birthdays. Free-mail domains
 * never name a company.
 */

const FREE_MAIL = {};
for (const d of [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'web.de', 'mail.com', 'zoho.com',
  'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com', 'fastmail.com', 'hey.com', 'tutanota.com',
])
  FREE_MAIL[d] = true;

const SECOND_LEVEL = {};
for (const s of ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr', 'com.br', 'com.mx', 'com.ar', 'co.in', 'com.sg', 'com.my', 'com.hk', 'com.tw', 'co.za', 'com.tr', 'co.id', 'com.ph', 'com.vn', 'co.il', 'com.cn'])
  SECOND_LEVEL[s] = true;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function email(v) {
  const e = String(v || '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .toLowerCase();
  return e;
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

/** A list of normalized, valid, unique emails; throws on an invalid one. */
function emails(list, name) {
  const out = [];
  for (const raw of list || []) {
    const e = email(raw);
    if (e === '') continue;
    if (!validEmail(e)) throw fail(400, (name || 'email') + ': "' + raw + '" is not an email address');
    if (out.indexOf(e) < 0) out.push(e);
  }
  return out;
}

/** The root domain of a URL, host or email address: "https://www.mail.acme.co.uk/x" -> "acme.co.uk". */
function domain(v) {
  let s = String(v || '')
    .trim()
    .toLowerCase();
  if (s === '') return '';
  if (s.indexOf('@') >= 0 && s.indexOf('/') < 0) s = s.split('@').pop();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[\/?#:]/)[0].replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return '';
  const parts = s.split('.');
  if (parts.length <= 2) return s;
  const last2 = parts.slice(-2).join('.');
  return SECOND_LEVEL[last2] ? parts.slice(-3).join('.') : last2;
}

function domains(list, name) {
  const out = [];
  for (const raw of list || []) {
    if (String(raw || '').trim() === '') continue;
    const d = domain(raw);
    if (d === '') throw fail(400, (name || 'domain') + ': "' + raw + '" is not a domain or website');
    if (out.indexOf(d) < 0) out.push(d);
  }
  return out;
}

function isFreeMail(d) {
  return FREE_MAIL[String(d || '').toLowerCase()] === true;
}

/** The company domain of a work email, or '' for free mail. */
function workDomain(e) {
  const d = domain(e);
  return d === '' || isFreeMail(d) ? '' : d;
}

function phone(v) {
  const s = String(v || '').trim();
  if (s === '') return '';
  return s.replace(/[^\d+()\-.\s]/g, '').replace(/\s+/g, ' ').trim();
}

function phones(list) {
  const out = [];
  for (const raw of list || []) {
    const p = phone(raw);
    if (p !== '' && out.indexOf(p) < 0) out.push(p);
  }
  return out;
}

function url(v) {
  const s = String(v || '').trim();
  if (s === '') return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
}

/** "Ada  Lovelace" -> ["Ada", "Lovelace"]; one word goes to the first name. */
function splitName(full) {
  const parts = String(full || '')
    .trim()
    .split(/\s+/)
    .filter((x) => x !== '');
  if (parts.length === 0) return ['', ''];
  if (parts.length === 1) return [parts[0], ''];
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
}

/** "acme-labs.io" -> "Acme Labs". */
function companyFromDomain(d) {
  const base = String(d || '').split('.')[0] || d;
  return base
    .split(/[-_]/)
    .filter((x) => x !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Company names compared without case, punctuation and legal suffixes. */
function companyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,'"&()]/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|bv|plc|corp|corporation|co|company|pte|sdn|bhd|pty|oy|ab)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameKey(first, last) {
  let s = (String(first || '') + ' ' + String(last || '')).toLowerCase();
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "MM-DD" or "YYYY-MM-DD" (also "DD/MM" is refused: ambiguous). */
function birthday(v, name) {
  const s = String(v || '').trim();
  if (s === '') return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) return ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  throw fail(400, (name || 'birthday') + ' must be MM-DD or YYYY-MM-DD');
}

function tags(list) {
  const out = [];
  for (const raw of list || []) {
    const t = String(raw || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    if (t !== '' && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 30);
}

module.exports = {
  email: email,
  validEmail: validEmail,
  emails: emails,
  domain: domain,
  domains: domains,
  isFreeMail: isFreeMail,
  workDomain: workDomain,
  phone: phone,
  phones: phones,
  url: url,
  splitName: splitName,
  companyFromDomain: companyFromDomain,
  companyKey: companyKey,
  nameKey: nameKey,
  birthday: birthday,
  tags: tags,
};
