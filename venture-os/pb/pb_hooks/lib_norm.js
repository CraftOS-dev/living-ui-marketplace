/// <reference path="../pb_data/types.d.ts" />
/**
 * What identifies a record (CRM lib_norm, kept whole): email addresses
 * (lowercase, trimmed), root domains (scheme, www, path and subdomains
 * dropped; co.uk-style suffixes kept), phone numbers, links, names. Free-mail
 * domains never name a company. Pure functions: no PocketBase globals.
 */

const FREE_MAIL = {};
for (const d of [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.jp', 'ymail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'zoho.com',
  'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com', 'fastmail.com', 'hey.com', 'tutanota.com', 'naver.com', 'daum.net', 'mail.ru', 'rediffmail.com',
])
  FREE_MAIL[d] = true;

const SECOND_LEVEL = {};
for (const s of ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr', 'com.br', 'com.mx', 'com.ar', 'co.in', 'com.sg', 'com.my', 'com.hk', 'com.tw', 'co.za', 'com.tr', 'co.id', 'com.ph', 'com.vn', 'co.il', 'com.cn'])
  SECOND_LEVEL[s] = true;

function fail(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code || 'invalid_param';
  return err;
}

function email(v) {
  return String(v || '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .toLowerCase();
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
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
  return s
    .replace(/[^\d+()\-.\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function url(v) {
  const s = String(v || '').trim();
  if (s === '') return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
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

/** "jane.doe@acme.com" -> "Jane Doe" (the local part as a name, when nothing better is known). */
function nameFromEmail(e) {
  const local = String(e || '').split('@')[0] || '';
  return local
    .split(/[._-]+/)
    .filter((x) => x !== '' && !/^\d+$/.test(x))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Company names compared without case, punctuation and legal suffixes. */
function companyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,'"&()]/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|bv|plc|corp|corporation|co|company|pte|sdn|bhd|pty|oy|ab|kk)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A person's name compared without case, accents and punctuation. */
function nameKey(full) {
  let s = String(full || '').toLowerCase();
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s
    .replace(/[.,'"`&()\[\]{}!?;:\/\\_*+=~|<>@#$%^-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

/** An ISO 3166 alpha-2 country code ("sg" -> "SG"), '' when empty; throws when not two letters. */
function country(v, name) {
  const s = String(v || '')
    .trim()
    .toUpperCase();
  if (s === '') return '';
  if (!/^[A-Z]{2}$/.test(s)) throw fail(400, (name || 'country') + ' is a two-letter country code such as US, GB or SG');
  return s;
}

/** An ISO 4217 currency code ("usd" -> "USD"), '' when empty; throws when not three letters. */
function currency(v, name) {
  const s = String(v || '')
    .trim()
    .toUpperCase();
  if (s === '') return '';
  if (!/^[A-Z]{3}$/.test(s)) throw fail(400, (name || 'currency') + ' is a three-letter currency code such as USD');
  return s;
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
  url: url,
  companyFromDomain: companyFromDomain,
  nameFromEmail: nameFromEmail,
  companyKey: companyKey,
  nameKey: nameKey,
  tags: tags,
  country: country,
  currency: currency,
};
