/// <reference path="../pb_data/types.d.ts" />
/**
 * Bank payment files for pay runs. Pure JavaScript (no PocketBase globals),
 * so Node tests and PocketBase hooks run the same bytes.
 *
 * Formats with `official: false` have no published layout: screens tag them
 * "check with your bank".
 *
 * write(format, input) -> { ok, format, filename, mime, encoding, bytes, text,
 *                           count, total_minor, currency, sha256, problems, warnings, label }
 *
 * input = {
 *   payer:    the employer's bank details for this format (FORMATS[x].payer_fields),
 *   pay_date: 'YYYY-MM-DD' (the day the money should arrive),
 *   created:  'YYYY-MM-DD HH:MM:SS' (the entity's local time; passed in so output is deterministic),
 *   reference: short text for the run (run number or period),
 *   currency: ISO code (each format except generic_csv has a fixed one),
 *   kind:     'salary' | 'bonus',
 *   payments: [{ ref (employee number), employee, name, kana, bank_code, branch_code, bank_name,
 *                account (plain digits, unsealed by the caller), account_type, iban, bic,
 *                id_type, id_number, email, amount_minor, reference }],
 *   options:  per-format switches (FORMATS[x].options)
 * }
 *
 * A file is produced only when there is no problem. Problems name the
 * employee (`ref`) and the field, so a person can fix the record and export
 * again. Plain account numbers live only inside this call: they are never
 * returned except inside `bytes`, and problems quote masked values.
 */

/* --------------------------------------------------------------- formats */

const FORMATS = {
  generic_csv: {
    code: 'generic_csv', name: 'Generic CSV', country: '', currency: '', extension: 'csv', mime: 'text/csv',
    official: false, label: 'A plain list of payments, for any bank or for checking by hand',
    layout: 'UTF-8 CSV, CRLF, header row; columns employee_number, name, bank_name, bank_code, branch_code, account_number, iban, swift, amount, currency, reference. Text cells are quoted; cells starting with = + - @ get a leading apostrophe.',
    payer_fields: [],
    options: [{ key: 'header', type: 'boolean', default: true, label: 'Header row' }],
  },
  nacha_ppd: {
    code: 'nacha_ppd', name: 'NACHA ACH (PPD credits)', country: 'US', currency: 'USD', extension: 'ach', mime: 'text/plain',
    official: true, label: 'Nacha file format, PPD entries for direct deposit',
    layout: '94-character records: file header 1, batch header 5 (PPD, service class 220, or 200 with an offset debit), entry detail 6 (22 checking, 32 savings, 27 or 37 offset), batch control 8, file control 9, blocked to 10 with 9-filled records.',
    payer_fields: [
      { key: 'destination_routing', label: 'Immediate destination (your bank routing number)', required: true, pattern: '^\\d{9}$' },
      { key: 'destination_name', label: 'Immediate destination name', required: false, max: 23 },
      { key: 'origin', label: 'Immediate origin (10 characters, from your bank)', required: true, pattern: '^[0-9A-Za-z ]{9,10}$' },
      { key: 'origin_name', label: 'Immediate origin name', required: false, max: 23 },
      { key: 'company_name', label: 'Company name (16)', required: true, max: 16 },
      { key: 'company_id', label: 'Company identification (10, from your bank)', required: true, pattern: '^[0-9A-Za-z ]{10}$' },
      { key: 'odfi_routing', label: 'Originating bank routing number', required: true, pattern: '^\\d{9}$' },
      { key: 'entry_description', label: 'Entry description', required: false, max: 10, default: 'PAYROLL' },
      { key: 'discretionary', label: 'Company discretionary data', required: false, max: 20 },
      { key: 'account', label: 'Company account (for an offset entry)', required: false },
      { key: 'account_type', label: 'Company account type', required: false, enum: ['checking', 'savings'] },
    ],
    options: [
      { key: 'offset', type: 'boolean', default: false, label: 'Add a balancing offset debit (service class 200)' },
      { key: 'file_id_modifier', type: 'text', default: 'A', label: 'File ID modifier (A to Z, 0 to 9)' },
      { key: 'newline', type: 'enum', default: 'lf', values: ['lf', 'crlf', 'none'], label: 'Record separator' },
    ],
  },
  aba: {
    code: 'aba', name: 'ABA direct entry (Cemtext)', country: 'AU', currency: 'AUD', extension: 'aba', mime: 'text/plain',
    official: true, label: 'BECS direct entry file, 120-character records',
    layout: '120-character records separated by CRLF: descriptive 0, detail 1 (transaction code 53 payroll; 13 for the balancing debit), file total 7 with 999-999.',
    payer_fields: [
      { key: 'fi', label: 'Bank abbreviation (3 letters, e.g. CBA, WBC, NAB, ANZ)', required: true, pattern: '^[A-Z]{3}$' },
      { key: 'user_name', label: 'User name your bank gave you (26)', required: true, max: 26 },
      { key: 'user_id', label: 'Direct entry user ID (6 digits)', required: true, pattern: '^\\d{1,6}$' },
      { key: 'bsb', label: 'Your BSB (xxx-xxx)', required: true, pattern: '^\\d{3}-?\\d{3}$' },
      { key: 'account', label: 'Your account number', required: true, pattern: '^[0-9-]{1,10}$' },
      { key: 'remitter', label: 'Remitter name on statements (16)', required: true, max: 16 },
      { key: 'description', label: 'Description of entries (12)', required: false, max: 12, default: 'PAYROLL' },
      { key: 'account_title', label: 'Your account name (for the balancing record)', required: false, max: 32 },
    ],
    options: [
      { key: 'balance', type: 'boolean', default: false, label: 'Add a self-balancing debit record (some banks require it)' },
    ],
  },
  sepa_pain001: {
    code: 'sepa_pain001', name: 'SEPA credit transfer (pain.001.001.03)', country: '', currency: 'EUR', extension: 'xml', mime: 'application/xml',
    official: true, label: 'ISO 20022 customer credit transfer initiation, SEPA euro payments',
    layout: 'UTF-8 XML, urn:iso:std:iso:20022:tech:xsd:pain.001.001.03, one PmtInf with service level SEPA, category purpose SALA, charge bearer SLEV.',
    payer_fields: [
      { key: 'name', label: 'Debtor name (70)', required: true, max: 70 },
      { key: 'iban', label: 'Debtor IBAN', required: true },
      { key: 'bic', label: 'Debtor bank BIC', required: false, pattern: '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' },
      { key: 'initiating_party', label: 'Initiating party name', required: false, max: 70 },
    ],
    options: [
      { key: 'batch_booking', type: 'boolean', default: true, label: 'One debit on your statement' },
      { key: 'purpose', type: 'enum', default: 'SALA', values: ['SALA', 'BONU', 'PENS'], label: 'Category purpose' },
    ],
  },
  bacs_csv: {
    code: 'bacs_csv', name: 'Bacs bulk payment CSV', country: 'GB', currency: 'GBP', extension: 'csv', mime: 'text/csv',
    official: false, label: 'A simple CSV most UK bulk payment imports map',
    layout: 'ASCII CSV, CRLF, columns sort_code (6 digits), account_number (8 digits), account_name (18), amount (pounds, 2 decimals), reference (18), optional header row. Characters A to Z, 0 to 9, space . & / -.',
    payer_fields: [],
    options: [{ key: 'header', type: 'boolean', default: false, label: 'Header row' }],
  },
  zengin: {
    code: 'zengin', name: 'Zengin salary transfer (全銀 給与振込)', country: 'JP', currency: 'JPY', extension: 'txt', mime: 'text/plain',
    official: true, label: 'Zengin 120-byte records, half-width katakana, JIS (Shift_JIS single-byte)',
    layout: '120-byte records: header 1 (type 11 salary, 12 bonus), data 2, trailer 8, end 9; N fields right-aligned zero-padded, C fields left-aligned space-padded; names in half-width katakana; JIS X 0201 bytes (the single-byte part of Shift_JIS).',
    payer_fields: [
      { key: 'consignor_code', label: '委託者コード (10 digits, from your bank)', required: true, pattern: '^\\d{1,10}$' },
      { key: 'consignor_kana', label: '委託者名 (company name in kana, 40)', required: true, max: 40 },
      { key: 'bank_code', label: '仕向銀行番号 (4 digits)', required: true, pattern: '^\\d{4}$' },
      { key: 'bank_kana', label: '仕向銀行名 (kana, optional)', required: false, max: 15 },
      { key: 'branch_code', label: '仕向支店番号 (3 digits)', required: true, pattern: '^\\d{3}$' },
      { key: 'branch_kana', label: '仕向支店名 (kana, optional)', required: false, max: 15 },
      { key: 'account_type', label: '預金種目', required: true, enum: ['ordinary', 'current'] },
      { key: 'account', label: '口座番号 (up to 7 digits)', required: true, pattern: '^\\d{1,7}$' },
    ],
    options: [
      { key: 'newline', type: 'enum', default: 'crlf', values: ['crlf', 'none'], label: 'Record separator' },
      { key: 'eof', type: 'boolean', default: false, label: 'End with an EOF byte (1A)' },
      { key: 'employee_codes', type: 'boolean', default: false, label: 'Put employee numbers in 社員番号' },
    ],
  },
  sg_giro_csv: {
    code: 'sg_giro_csv', name: 'Singapore GIRO payroll CSV', country: 'SG', currency: 'SGD', extension: 'csv', mime: 'text/csv',
    official: false, label: 'A simple CSV of GIRO payments, one row a person',
    layout: 'ASCII CSV, CRLF, header row; columns name, bank_code (4 digits) or SWIFT, branch_code (3 digits), account_number, amount (2 decimals), purpose_code SALA, reference, employee_number.',
    payer_fields: [],
    options: [],
  },
  in_neft_csv: {
    code: 'in_neft_csv', name: 'India NEFT bulk CSV', country: 'IN', currency: 'INR', extension: 'csv', mime: 'text/csv',
    official: false, label: 'A simple CSV of NEFT payments, one row a person',
    layout: 'ASCII CSV, CRLF, header row; columns beneficiary_name, account_number, ifsc, amount (2 decimals), payment_mode NEFT, narration (30), employee_number, email.',
    payer_fields: [],
    options: [],
  },
  my_maybank_csv: {
    code: 'my_maybank_csv', name: 'Maybank M2U Biz bulk payroll CSV', country: 'MY', currency: 'MYR', extension: 'csv', mime: 'text/csv',
    official: false, label: 'A CSV in the shape of the M2U Biz bulk payment template',
    layout: 'ASCII CSV written as raw text (never through a spreadsheet), comma delimiter, CRLF, header row; columns Beneficiary Name, Beneficiary Bank (SWIFT), Beneficiary Account No, ID Type, ID Number, Payment Amount (2 decimals), Payment Reference, Payment Description, Beneficiary Email, Crediting Date (DD/MM/YYYY).',
    payer_fields: [],
    options: [],
  },
  my_cimb_txt: {
    code: 'my_cimb_txt', name: 'CIMB BizChannel payroll text', country: 'MY', currency: 'MYR', extension: 'txt', mime: 'text/plain',
    official: false, label: 'HR OS layout with the BizConverter fields, pipe separated',
    layout: 'ASCII text, CRLF, pipe separated: H|company|account|crediting date YYYYMMDD|count|total; D|name|SWIFT|account|ID type|ID number|amount|reference|description|email; T|count|total.',
    payer_fields: [
      { key: 'name', label: 'Company name', required: true, max: 40 },
      { key: 'account', label: 'Company CIMB account', required: true, pattern: '^\\d{6,20}$' },
    ],
    options: [],
  },
};

const ORDER = ['generic_csv', 'nacha_ppd', 'aba', 'sepa_pain001', 'bacs_csv', 'zengin', 'sg_giro_csv', 'in_neft_csv', 'my_maybank_csv', 'my_cimb_txt'];

/** The formats as plain data for screens and the catalog (no functions). */
function list() {
  return ORDER.map(function (k) { return JSON.parse(JSON.stringify(FORMATS[k])); });
}

function info(code) {
  return FORMATS[code] ? JSON.parse(JSON.stringify(FORMATS[code])) : null;
}

/* -------------------------------------------------------------- helpers */

const ZERO_DP = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const THREE_DP = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

function exponentOf(currency) {
  const c = String(currency || '').toUpperCase();
  if (ZERO_DP.indexOf(c) >= 0) return 0;
  if (THREE_DP.indexOf(c) >= 0) return 3;
  return 2;
}

function s(v) {
  return v === undefined || v === null ? '' : String(v);
}

function rep(ch, n) {
  let out = '';
  for (let i = 0; i < n; i++) out += ch;
  return out;
}

/** Right-aligned in n, padded with ch (numbers). Longer text keeps its right end. */
function right(v, n, ch) {
  const t = s(v);
  if (t.length >= n) return t.slice(t.length - n);
  return rep(ch === undefined ? '0' : ch, n - t.length) + t;
}

/** Left-aligned in n, padded with spaces, cut at n. */
function left(v, n) {
  const t = s(v);
  if (t.length >= n) return t.slice(0, n);
  return t + rep(' ', n - t.length);
}

function onlyDigits(v) {
  return s(v).replace(/[^0-9]/g, '');
}

/** Amount in major units as text with the currency's decimals ("1234.50"). */
function majorText(minor, exp) {
  const neg = minor < 0;
  let t = String(Math.abs(minor));
  if (exp === 0) return (neg ? '-' : '') + t;
  while (t.length <= exp) t = '0' + t;
  return (neg ? '-' : '') + t.slice(0, t.length - exp) + '.' + t.slice(t.length - exp);
}

/** Last 4 characters with the rest hidden, for problem messages. */
function masked(v) {
  const t = s(v).replace(/\s/g, '');
  if (t.length <= 4) return rep('*', t.length);
  return rep('*', Math.min(4, t.length - 4)) + t.slice(t.length - 4);
}

/* Latin letters to ASCII, for formats limited to basic Latin. */
const LATIN1 = {
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'Å': 'A', 'Æ': 'AE', 'Ç': 'C', 'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E',
  'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'Ð': 'D', 'Ñ': 'N', 'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O', 'Ø': 'O',
  'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U', 'Ý': 'Y', 'Þ': 'TH', 'ß': 'ss', 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
  'å': 'a', 'æ': 'ae', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ð': 'd',
  'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y',
  'þ': 'th', 'ÿ': 'y', 'Ș': 'S', 'ș': 's', 'Ț': 'T', 'ț': 't',
};
// U+0100 to U+017F (Latin Extended-A), in code point order.
const EXT_A = ('A a A a A a C c C c C c C c D d D d E e E e E e E e E e G g G g G g G g H h H h I i I i I i I i I i IJ ij J j K k k ' +
  'L l L l L l L l L l N n N n N n n N n O o O o O o OE oe R r R r R r S s S s S s S s T t T t T t U u U u U u U u U u U u W w Y y Y Z z Z z Z z s').split(' ');

function latinToAscii(textValue) {
  let out = '';
  const t = s(textValue);
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    const c = t.charCodeAt(i);
    if (c < 0x80) out += ch;
    else if (LATIN1[ch] !== undefined) out += LATIN1[ch];
    else if (c >= 0x100 && c <= 0x17f) out += EXT_A[c - 0x100];
    else if (c === 0x2019 || c === 0x2018) out += "'";
    else if (c === 0x2010 || c === 0x2011 || c === 0x2012 || c === 0x2212) out += '-';
    else if (c === 0x3000 || c === 0xa0) out += ' ';
    else out += '\u0000';
  }
  return out;
}

/**
 * Text for a field limited to `allowed` (a RegExp for one character).
 * Returns { text, changed, lost } where lost counts characters that had no
 * equivalent (dropped). Spaces collapse; the result is trimmed.
 */
function charset(textValue, allowed, upper) {
  let t = latinToAscii(textValue);
  if (upper) t = t.toUpperCase();
  let out = '';
  let lost = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    if (allowed.test(ch)) out += ch;
    else lost += 1;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return { text: out, changed: out.toUpperCase() !== s(textValue).replace(/\s+/g, ' ').trim().toUpperCase(), lost: lost };
}

/* ------------------------------------------------------------- checks */

/** US ABA routing number: 9 digits, 3-7-1 weighted sum divisible by 10. */
function routingValid(v) {
  const t = s(v);
  if (!/^\d{9}$/.test(t)) return false;
  const d = t.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

const SEPA_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH', 'GB', 'MC', 'SM', 'VA', 'AD', 'AL', 'ME', 'MD', 'MK'];

function ibanClean(v) {
  return s(v).replace(/\s+/g, '').toUpperCase();
}

/** IBAN check: { ok, code, message } with the country length and the mod 97 check digits. */
function ibanCheck(v) {
  const t = ibanClean(v);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(t)) return { ok: false, code: 'iban_shape', message: 'An IBAN is two letters, two check digits and the account part' };
  const cc = t.slice(0, 2);
  const len = IBAN_LENGTHS[cc];
  if (len === undefined) return { ok: false, code: 'iban_country', message: 'IBAN country ' + cc + ' is not in the IBAN registry list' };
  if (t.length !== len) return { ok: false, code: 'iban_length', message: 'A ' + cc + ' IBAN has ' + len + ' characters, this one has ' + t.length };
  const moved = t.slice(4) + t.slice(0, 4);
  let rem = 0;
  for (let i = 0; i < moved.length; i++) {
    const c = moved.charCodeAt(i);
    const part = c >= 65 ? String(c - 55) : moved.charAt(i);
    for (let j = 0; j < part.length; j++) rem = (rem * 10 + (part.charCodeAt(j) - 48)) % 97;
  }
  if (rem !== 1) return { ok: false, code: 'iban_check', message: 'The IBAN check digits do not match (a typing mistake)' };
  return { ok: true, code: '', message: '' };
}

function bicValid(v) {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s(v).toUpperCase().replace(/\s+/g, ''));
}

/** Australian BSB: six digits, written xxx-xxx. Returns the written form or ''. */
function bsbFormat(v) {
  const t = s(v).replace(/\s+/g, '');
  if (!/^\d{3}-?\d{3}$/.test(t)) return '';
  const d = t.replace('-', '');
  return d.slice(0, 3) + '-' + d.slice(3);
}

function ifscValid(v) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s(v).toUpperCase().replace(/\s+/g, ''));
}

/* --------------------------------------------- Japanese half-width kana */

const KANA_FULL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const KANA_HALF = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ';
const DAKU_FULL = 'ガギグゲゴザジズゼゾダヂヅデドバビブベボ';
const DAKU_BASE = 'ｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾊﾋﾌﾍﾎ';
const HANDAKU_FULL = 'パピプペポ';
const HANDAKU_BASE = 'ﾊﾋﾌﾍﾎ';
// Small and old kana: Zengin takes the large form.
const SMALL_FULL = 'ァィゥェォャュョッヮヵヶヰヱ';
const SMALL_HALF = 'ｱｲｳｴｵﾔﾕﾖﾂﾜｶｹｲｴ';
const SMALL_HALFW = 'ｧｨｩｪｫｬｭｮｯ';
const SMALL_HALFW_TO = 'ｱｲｳｴｵﾔﾕﾖﾂ';
// Characters a Zengin name may hold: digits, capitals, half-width kana without the small ones, space and ( ) . - / , \ ｢ ｣.
const ZENGIN_OK = /^[0-9A-Z ()\-./,\\｢｣ｦｱ-ﾟ]$/;

/**
 * Text to Zengin half-width katakana. Hiragana and full-width katakana
 * become half-width (voiced marks as separate characters), small kana
 * become large, the long vowel mark becomes '-', letters become capitals.
 * Returns { text, bad: [characters that have no Zengin form] }.
 */
function zenginKana(textValue) {
  const t = s(textValue);
  let out = '';
  const bad = [];
  for (let i = 0; i < t.length; i++) {
    let ch = t.charAt(i);
    let c = t.charCodeAt(i);
    if (c >= 0x3041 && c <= 0x3096) { c += 0x60; ch = String.fromCharCode(c); }     // hiragana to katakana
    if (c >= 0xff01 && c <= 0xff5e) { c -= 0xfee0; ch = String.fromCharCode(c); }   // full-width ASCII
    if (c === 0x3000 || c === 0xa0) { out += ' '; continue; }
    if (c === 0x309b) { out += 'ﾞ'; continue; }
    if (c === 0x309c) { out += 'ﾟ'; continue; }
    if (c === 0x30fc || c === 0xff70 || c === 0x2010 || c === 0x2212 || c === 0x2015) { out += '-'; continue; }
    if (c === 0x30fb || c === 0xff65 || c === 0x3002 || c === 0xff61) { out += '.'; continue; }
    if (c === 0x3001 || c === 0xff64) { out += ','; continue; }
    if (c === 0x300c) { out += '｢'; continue; }
    if (c === 0x300d) { out += '｣'; continue; }
    if (c === 0xa5 || c === 0xffe5) { out += '\\'; continue; }
    if (ch === 'ヴ') { out += 'ｳﾞ'; continue; }
    let k = KANA_FULL.indexOf(ch);
    if (k >= 0) { out += KANA_HALF.charAt(k); continue; }
    k = DAKU_FULL.indexOf(ch);
    if (k >= 0) { out += DAKU_BASE.charAt(k) + 'ﾞ'; continue; }
    k = HANDAKU_FULL.indexOf(ch);
    if (k >= 0) { out += HANDAKU_BASE.charAt(k) + 'ﾟ'; continue; }
    k = SMALL_FULL.indexOf(ch);
    if (k >= 0) { out += SMALL_HALF.charAt(k); continue; }
    k = SMALL_HALFW.indexOf(ch);
    if (k >= 0) { out += SMALL_HALFW_TO.charAt(k); continue; }
    if (c >= 0x61 && c <= 0x7a) { out += ch.toUpperCase(); continue; }
    if (ZENGIN_OK.test(ch)) { out += ch; continue; }
    bad.push(ch);
  }
  return { text: out.replace(/ +/g, ' ').trim(), bad: bad };
}

/** Zengin text to JIS X 0201 bytes (ASCII as is, half-width kana U+FF61..FF9F to A1..DF). */
function jisBytes(textValue) {
  const t = s(textValue);
  const out = [];
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xff61 && c <= 0xff9f) out.push(c - 0xff61 + 0xa1);
    else if (c < 0x80) out.push(c);
    else throw new Error('character outside JIS X 0201: ' + t.charAt(i));
  }
  return out;
}

/* ------------------------------------------------------- bytes and hash */

function utf8Bytes(textValue) {
  const t = s(textValue);
  const out = [];
  for (let i = 0; i < t.length; i++) {
    let c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) {
      const d = t.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i += 1;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 of a byte array, as 64 hex digits (same in Node and PocketBase). */
function sha256(bytes) {
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const n = bytes.length;
  const total = Math.ceil((n + 9) / 64) * 64;
  const m = new Array(total);
  for (let i = 0; i < total; i++) m[i] = i < n ? bytes[i] & 255 : 0;
  m[n] = 0x80;
  const bits = n * 8;
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  m[total - 8] = (hi >>> 24) & 255; m[total - 7] = (hi >>> 16) & 255; m[total - 6] = (hi >>> 8) & 255; m[total - 5] = hi & 255;
  m[total - 4] = (lo >>> 24) & 255; m[total - 3] = (lo >>> 16) & 255; m[total - 2] = (lo >>> 8) & 255; m[total - 1] = lo & 255;
  const w = new Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3]) | 0;
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
      const ch = (E & F) ^ (~E & G);
      const t1 = (H + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
      const mj = (A & B) ^ (A & C) ^ (B & C);
      const t2 = (S0 + mj) | 0;
      H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    h[0] = (h[0] + A) | 0; h[1] = (h[1] + B) | 0; h[2] = (h[2] + C) | 0; h[3] = (h[3] + D) | 0;
    h[4] = (h[4] + E) | 0; h[5] = (h[5] + F) | 0; h[6] = (h[6] + G) | 0; h[7] = (h[7] + H) | 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += ('00000000' + (h[i] >>> 0).toString(16)).slice(-8);
  return out;
}

/* ---------------------------------------------------------- split pay */

/**
 * Split one net amount over a person's active accounts by their `split`
 * ({ kind: 'fixed' | 'percent' | 'rest', value }). Fixed amounts are paid
 * first in account order, then percentages of the net (rounded down to the
 * minor unit), then the rest goes to the 'rest' account (or the first
 * account when none is marked). Returns { parts: [{ account, amount_minor }], warnings }.
 */
function splitNet(netMinor, accounts) {
  const warnings = [];
  const accs = (accounts || []).filter(function (a) { return a; });
  if (accs.length === 0) return { parts: [], warnings: ['no_account'] };
  if (accs.length === 1) return { parts: [{ account: accs[0], amount_minor: netMinor }], warnings: warnings };
  const amounts = accs.map(function () { return 0; });
  let left = netMinor;
  let restIdx = -1;
  for (let i = 0; i < accs.length; i++) {
    const sp = accs[i].split || {};
    if (sp.kind === 'rest' && restIdx < 0) restIdx = i;
  }
  for (let i = 0; i < accs.length; i++) {
    const sp = accs[i].split || {};
    if (sp.kind !== 'fixed') continue;
    const want = Math.max(0, Math.round(Number(sp.value) || 0));
    const give = Math.min(want, left);
    if (give < want) warnings.push('fixed_short');
    amounts[i] = give;
    left -= give;
  }
  for (let i = 0; i < accs.length; i++) {
    const sp = accs[i].split || {};
    if (sp.kind !== 'percent') continue;
    const pct = Math.max(0, Number(sp.value) || 0);
    const want = Math.floor((netMinor * pct) / 100 + 1e-9);
    const give = Math.min(want, left);
    if (give < want) warnings.push('percent_short');
    amounts[i] = give;
    left -= give;
  }
  if (left > 0) {
    if (restIdx < 0) {
      warnings.push('no_rest_account');
      restIdx = 0;
    }
    amounts[restIdx] += left;
  }
  const parts = [];
  for (let i = 0; i < accs.length; i++) if (amounts[i] > 0) parts.push({ account: accs[i], amount_minor: amounts[i] });
  return { parts: parts, warnings: warnings };
}

/* --------------------------------------------------------------- write */

function problem(list, p, field, code, message) {
  list.push({ ref: p ? s(p.ref) : '', employee: p ? s(p.employee) : '', name: p ? s(p.name) : '', field: field, code: code, message: message });
}

function optionOf(fmt, options, key) {
  const o = options || {};
  if (o[key] !== undefined && o[key] !== null && o[key] !== '') return o[key];
  for (const d of fmt.options) if (d.key === key) return d.default;
  return undefined;
}

function payerChecks(fmt, payer, problems) {
  const py = payer || {};
  for (const f of fmt.payer_fields) {
    const v = s(py[f.key]).trim();
    if (v === '') {
      if (f.required && f.default === undefined) problem(problems, null, 'payer.' + f.key, 'payer_missing', f.label + ' is missing in the entity bank details');
      continue;
    }
    if (f.pattern && !new RegExp(f.pattern).test(v)) problem(problems, null, 'payer.' + f.key, 'payer_invalid', f.label + ' does not have the right form');
    if (f.enum && f.enum.indexOf(v) < 0) problem(problems, null, 'payer.' + f.key, 'payer_invalid', f.label + ' must be one of ' + f.enum.join(', '));
  }
}

function payerValue(fmt, payer, key) {
  const v = s((payer || {})[key]).trim();
  if (v !== '') return v;
  for (const f of fmt.payer_fields) if (f.key === key && f.default !== undefined) return s(f.default);
  return '';
}

function amountChecks(p, problems, maxMinor) {
  const a = p.amount_minor;
  if (typeof a !== 'number' || !Number.isSafeInteger(a)) {
    problem(problems, p, 'amount_minor', 'amount_invalid', 'The amount is not a whole number of minor units');
    return false;
  }
  if (a <= 0) {
    problem(problems, p, 'amount_minor', 'amount_zero', 'A bank file cannot carry a zero or negative payment; pay this person by another method or fix the payslip');
    return false;
  }
  if (maxMinor !== undefined && a > maxMinor) {
    problem(problems, p, 'amount_minor', 'amount_too_large', 'The amount is larger than this file format can carry');
    return false;
  }
  return true;
}

function day6(dayText, order) {
  const y = dayText.slice(2, 4);
  const m = dayText.slice(5, 7);
  const d = dayText.slice(8, 10);
  return order === 'dmy' ? d + m + y : y + m + d;
}

function isDayText(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(v));
}

function csvCell(v, guard) {
  let t = s(v);
  if (guard && /^[=+\-@]/.test(t)) t = "'" + t;
  if (/[",\r\n]/.test(t) || /^\s|\s$/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
  return t;
}

function csvQuoted(v) {
  return '"' + s(v).replace(/"/g, '""') + '"';
}

/* ---- generic_csv */

function writeGeneric(fmt, input, out) {
  const exp = exponentOf(input.currency);
  const lines = [];
  if (optionOf(fmt, input.options, 'header')) lines.push('employee_number,name,bank_name,bank_code,branch_code,account_number,iban,swift,amount,currency,reference');
  for (const p of input.payments) {
    if (!amountChecks(p, out.problems)) continue;
    if (s(p.name).trim() === '') problem(out.problems, p, 'name', 'name_missing', 'The person has no name');
    if (s(p.account).trim() === '' && s(p.iban).trim() === '') problem(out.problems, p, 'account', 'account_missing', 'No account number or IBAN');
    lines.push([
      csvCell(p.ref, true), csvCell(s(p.name).trim(), true), csvCell(p.bank_name, true), csvQuoted(s(p.bank_code)), csvQuoted(s(p.branch_code)),
      csvQuoted(s(p.account).replace(/\s+/g, '')), csvQuoted(ibanClean(p.iban)), csvQuoted(s(p.bic).toUpperCase()),
      majorText(p.amount_minor, exp), s(input.currency).toUpperCase(), csvCell(s(p.reference || input.reference), true),
    ].join(','));
  }
  out.text = lines.join('\r\n') + '\r\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'utf-8';
}

/* ---- nacha_ppd */

const NACHA_OK = /^[ -~]$/;

function writeNacha(fmt, input, out) {
  const py = input.payer || {};
  const created = s(input.created);
  const effective = input.pay_date;
  const offset = !!optionOf(fmt, input.options, 'offset');
  const modifier = s(optionOf(fmt, input.options, 'file_id_modifier')).toUpperCase();
  if (!/^[A-Z0-9]$/.test(modifier)) problem(out.problems, null, 'options.file_id_modifier', 'option_invalid', 'The file ID modifier is one letter or digit');
  const dest = payerValue(fmt, py, 'destination_routing');
  const odfi = payerValue(fmt, py, 'odfi_routing');
  if (dest && /^\d{9}$/.test(dest) && !routingValid(dest)) problem(out.problems, null, 'payer.destination_routing', 'routing_check', 'The destination routing number fails its check digit');
  if (odfi && /^\d{9}$/.test(odfi) && !routingValid(odfi)) problem(out.problems, null, 'payer.odfi_routing', 'routing_check', 'The originating routing number fails its check digit');
  if (offset) {
    if (!/^[0-9A-Za-z-]{1,17}$/.test(payerValue(fmt, py, 'account'))) problem(out.problems, null, 'payer.account', 'payer_missing', 'An offset entry needs the company account number');
    if (['checking', 'savings'].indexOf(payerValue(fmt, py, 'account_type')) < 0) problem(out.problems, null, 'payer.account_type', 'payer_missing', 'An offset entry needs the company account type');
  }
  const entries = [];
  for (const p of input.payments) {
    const okAmount = amountChecks(p, out.problems, 9999999999);
    const routing = onlyDigits(p.bank_code);
    if (!/^\d{9}$/.test(routing)) problem(out.problems, p, 'bank_code', 'routing_shape', 'The routing number must be 9 digits');
    else if (!routingValid(routing)) problem(out.problems, p, 'bank_code', 'routing_check', 'The routing number ' + routing + ' fails its check digit (a typing mistake)');
    const acct = s(p.account).replace(/[\s]/g, '').toUpperCase();
    if (!/^[0-9A-Z-]{1,17}$/.test(acct)) problem(out.problems, p, 'account', 'account_shape', 'The account number must be 1 to 17 digits or letters (now ' + masked(acct) + ')');
    const type = s(p.account_type);
    if (type !== 'checking' && type !== 'savings') problem(out.problems, p, 'account_type', 'account_type', 'Choose checking or savings for this account');
    const nm = charset(p.name, NACHA_OK, true);
    if (nm.text === '') problem(out.problems, p, 'name', 'name_charset', 'The name has no Latin letters the bank can read');
    else if (nm.changed) out.warnings.push({ ref: s(p.ref), code: 'name_changed', message: 'Name written as ' + nm.text.slice(0, 22) });
    if (!okAmount) continue;
    entries.push({ code: type === 'savings' ? '32' : '22', routing: routing, account: acct, amount: p.amount_minor, id: charset(p.ref, NACHA_OK, true).text, name: nm.text });
  }
  if (out.problems.length) return;
  const rec = [];
  const company = charset(payerValue(fmt, py, 'company_name'), NACHA_OK, true).text;
  const companyId = payerValue(fmt, py, 'company_id');
  const odfi8 = odfi.slice(0, 8);
  // File header
  rec.push('1' + '01' + ' ' + dest + right(payerValue(fmt, py, 'origin'), 10, ' ') + day6(created.slice(0, 10), 'ymd') + created.slice(11, 13) + created.slice(14, 16) +
    modifier + '094' + '10' + '1' + left(charset(payerValue(fmt, py, 'destination_name'), NACHA_OK, true).text, 23) +
    left(charset(payerValue(fmt, py, 'origin_name'), NACHA_OK, true).text, 23) + left(charset(input.reference, NACHA_OK, true).text, 8));
  const service = offset ? '200' : '220';
  rec.push('5' + service + left(company, 16) + left(charset(payerValue(fmt, py, 'discretionary'), NACHA_OK, true).text, 20) + left(companyId, 10) + 'PPD' +
    left(charset(payerValue(fmt, py, 'entry_description'), NACHA_OK, true).text, 10) + rep(' ', 6) + day6(effective, 'ymd') + '   ' + '1' + odfi8 + '0000001');
  let hash = 0;
  let credit = 0;
  let debit = 0;
  let seq = 0;
  for (const e of entries) {
    seq += 1;
    hash += Number(e.routing.slice(0, 8));
    credit += e.amount;
    rec.push('6' + e.code + e.routing.slice(0, 8) + e.routing.charAt(8) + left(e.account, 17) + right(e.amount, 10) + left(e.id, 15) + left(e.name, 22) + '  ' + '0' + odfi8 + right(seq, 7));
  }
  if (offset) {
    seq += 1;
    hash += Number(odfi8);
    debit = credit;
    const t = payerValue(fmt, py, 'account_type') === 'savings' ? '37' : '27';
    rec.push('6' + t + odfi8 + odfi.charAt(8) + left(payerValue(fmt, py, 'account').toUpperCase(), 17) + right(debit, 10) + left('OFFSET', 15) + left(company, 22) + '  ' + '0' + odfi8 + right(seq, 7));
  }
  const hash10 = right(hash % 10000000000, 10);
  rec.push('8' + service + right(seq, 6) + hash10 + right(debit, 12) + right(credit, 12) + left(companyId, 10) + rep(' ', 19) + rep(' ', 6) + odfi8 + '0000001');
  const blocks = Math.ceil((rec.length + 1) / 10);
  rec.push('9' + right(1, 6) + right(blocks, 6) + right(seq, 8) + hash10 + right(debit, 12) + right(credit, 12) + rep(' ', 39));
  while (rec.length < blocks * 10) rec.push(rep('9', 94));
  for (const r of rec) if (r.length !== 94) throw new Error('nacha record length ' + r.length);
  const nl = optionOf(fmt, input.options, 'newline');
  const sep = nl === 'crlf' ? '\r\n' : nl === 'none' ? '' : '\n';
  out.text = rec.join(sep) + sep;
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'ascii';
  out.count = entries.length;
  out.total_minor = credit;
  out.control = { entry_hash: hash10, entries: seq, blocks: blocks, total_credit_minor: credit, total_debit_minor: debit, service_class: service };
}

/* ---- aba */

const ABA_OK = /^[A-Za-z0-9 &',\-./+$!%()*#=:?\[\]_^@]$/;

function writeAba(fmt, input, out) {
  const py = input.payer || {};
  const balance = !!optionOf(fmt, input.options, 'balance');
  const payerBsb = bsbFormat(payerValue(fmt, py, 'bsb'));
  let payerAcct = payerValue(fmt, py, 'account');
  if (payerAcct.length > 9) payerAcct = payerAcct.replace(/-/g, '');
  if (payerAcct.length > 9) problem(out.problems, null, 'payer.account', 'payer_invalid', 'Your account number has more than 9 digits');
  const remitter = charset(payerValue(fmt, py, 'remitter'), ABA_OK, true).text;
  const rows = [];
  for (const p of input.payments) {
    const okAmount = amountChecks(p, out.problems, 9999999999);
    const bsb = bsbFormat(s(p.bank_code) + (s(p.branch_code) ? s(p.branch_code) : ''));
    if (!bsb) problem(out.problems, p, 'bank_code', 'bsb_shape', 'The BSB must be 6 digits (xxx-xxx)');
    let acct = s(p.account).replace(/\s+/g, '');
    if (acct.length > 9) acct = acct.replace(/-/g, '');
    if (!/^[0-9-]{1,9}$/.test(acct) || /^[0-]+$/.test(acct)) problem(out.problems, p, 'account', 'account_shape', 'The account number must be up to 9 digits and not all zeros (now ' + masked(acct) + ')');
    const nm = charset(p.name, ABA_OK, true);
    if (nm.text === '') problem(out.problems, p, 'name', 'name_charset', 'The name has no Latin letters the bank can read');
    else if (nm.changed) out.warnings.push({ ref: s(p.ref), code: 'name_changed', message: 'Name written as ' + nm.text.slice(0, 32) });
    if (!okAmount) continue;
    rows.push({ bsb: bsb, account: acct, amount: p.amount_minor, title: nm.text, lodgement: charset(p.reference || input.reference, ABA_OK, true).text });
  }
  if (out.problems.length) return;
  const rec = [];
  rec.push('0' + rep(' ', 17) + '01' + payerValue(fmt, py, 'fi') + rep(' ', 7) + left(charset(payerValue(fmt, py, 'user_name'), ABA_OK, true).text, 26) +
    right(payerValue(fmt, py, 'user_id'), 6) + left(charset(payerValue(fmt, py, 'description'), ABA_OK, true).text, 12) + day6(input.pay_date, 'dmy') + rep(' ', 40));
  let credit = 0;
  for (const r of rows) {
    credit += r.amount;
    rec.push('1' + r.bsb + right(r.account, 9, ' ') + ' ' + '53' + right(r.amount, 10) + left(r.title, 32) + left(r.lodgement, 18) + payerBsb + right(payerAcct, 9, ' ') + left(remitter, 16) + '00000000');
  }
  let debit = 0;
  if (balance) {
    debit = credit;
    const title = charset(payerValue(fmt, py, 'account_title') || payerValue(fmt, py, 'user_name'), ABA_OK, true).text;
    rec.push('1' + payerBsb + right(payerAcct, 9, ' ') + ' ' + '13' + right(debit, 10) + left(title, 32) + left(charset(input.reference, ABA_OK, true).text, 18) + payerBsb + right(payerAcct, 9, ' ') + left(remitter, 16) + '00000000');
  }
  const count = rows.length + (balance ? 1 : 0);
  rec.push('7' + '999-999' + rep(' ', 12) + right(Math.abs(credit - debit), 10) + right(credit, 10) + right(debit, 10) + rep(' ', 24) + right(count, 6) + rep(' ', 40));
  for (const r of rec) if (r.length !== 120) throw new Error('aba record length ' + r.length);
  out.text = rec.join('\r\n') + '\r\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'ascii';
  out.count = rows.length;
  out.total_minor = credit;
  out.control = { net_minor: Math.abs(credit - debit), credit_minor: credit, debit_minor: debit, records: count };
}

/* ---- sepa_pain001 */

const SEPA_OK = /^[A-Za-z0-9/\-?:().,'+ ]$/;

function xml(v) {
  return s(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sepaId(v) {
  // Identifiers: SEPA set without spaces, no leading or trailing slash, no '//'.
  let t = charset(v, /^[A-Za-z0-9/\-?:().,'+]$/, false).text.replace(/ /g, '');
  t = t.replace(/\/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  return t.slice(0, 35);
}

function writeSepa(fmt, input, out) {
  const py = input.payer || {};
  const dIban = ibanClean(payerValue(fmt, py, 'iban'));
  if (dIban) {
    const c = ibanCheck(dIban);
    if (!c.ok) problem(out.problems, null, 'payer.iban', c.code, 'Your IBAN: ' + c.message);
  }
  const dBic = s(payerValue(fmt, py, 'bic')).toUpperCase();
  const dName = charset(payerValue(fmt, py, 'name'), SEPA_OK, false).text.slice(0, 70);
  const txs = [];
  for (const p of input.payments) {
    const okAmount = amountChecks(p, out.problems, 99999999999);
    const iban = ibanClean(p.iban);
    if (!iban) problem(out.problems, p, 'iban', 'iban_missing', 'A SEPA payment needs the IBAN');
    else {
      const c = ibanCheck(iban);
      if (!c.ok) problem(out.problems, p, 'iban', c.code, c.message);
      else if (SEPA_COUNTRIES.indexOf(iban.slice(0, 2)) < 0) problem(out.problems, p, 'iban', 'iban_not_sepa', 'IBAN country ' + iban.slice(0, 2) + ' is outside the SEPA area');
    }
    const bic = s(p.bic).toUpperCase().replace(/\s+/g, '');
    if (bic && !bicValid(bic)) problem(out.problems, p, 'bic', 'bic_shape', 'The BIC must be 8 or 11 letters and digits');
    const nm = charset(p.name, SEPA_OK, false);
    if (nm.text === '') problem(out.problems, p, 'name', 'name_charset', 'The name has no Latin letters the bank can read');
    else if (nm.changed) out.warnings.push({ ref: s(p.ref), code: 'name_changed', message: 'Name written as ' + nm.text.slice(0, 70) });
    if (!okAmount) continue;
    txs.push({ e2e: sepaId(s(input.reference) + '-' + s(p.ref)) || 'NOTPROVIDED', amount: p.amount_minor, bic: bic, name: nm.text.slice(0, 70), iban: iban, info: charset(p.reference || input.reference, SEPA_OK, false).text.slice(0, 140) });
  }
  if (out.problems.length) return;
  let total = 0;
  for (const t of txs) total += t.amount;
  const created = s(input.created).replace(' ', 'T');
  const msgId = sepaId(s(input.reference) + '-' + created.replace(/[^0-9]/g, '').slice(0, 14)) || 'HROS';
  const purpose = s(optionOf(fmt, input.options, 'purpose'));
  const initiator = charset(payerValue(fmt, py, 'initiating_party') || payerValue(fmt, py, 'name'), SEPA_OK, false).text.slice(0, 70);
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
  L.push('  <CstmrCdtTrfInitn>');
  L.push('    <GrpHdr>');
  L.push('      <MsgId>' + xml(msgId) + '</MsgId>');
  L.push('      <CreDtTm>' + xml(created) + '</CreDtTm>');
  L.push('      <NbOfTxs>' + txs.length + '</NbOfTxs>');
  L.push('      <CtrlSum>' + majorText(total, 2) + '</CtrlSum>');
  L.push('      <InitgPty>');
  L.push('        <Nm>' + xml(initiator) + '</Nm>');
  L.push('      </InitgPty>');
  L.push('    </GrpHdr>');
  L.push('    <PmtInf>');
  L.push('      <PmtInfId>' + xml(msgId) + '</PmtInfId>');
  L.push('      <PmtMtd>TRF</PmtMtd>');
  L.push('      <BtchBookg>' + (optionOf(fmt, input.options, 'batch_booking') ? 'true' : 'false') + '</BtchBookg>');
  L.push('      <NbOfTxs>' + txs.length + '</NbOfTxs>');
  L.push('      <CtrlSum>' + majorText(total, 2) + '</CtrlSum>');
  L.push('      <PmtTpInf>');
  L.push('        <SvcLvl>');
  L.push('          <Cd>SEPA</Cd>');
  L.push('        </SvcLvl>');
  L.push('        <CtgyPurp>');
  L.push('          <Cd>' + xml(purpose) + '</Cd>');
  L.push('        </CtgyPurp>');
  L.push('      </PmtTpInf>');
  L.push('      <ReqdExctnDt>' + xml(input.pay_date) + '</ReqdExctnDt>');
  L.push('      <Dbtr>');
  L.push('        <Nm>' + xml(dName) + '</Nm>');
  L.push('      </Dbtr>');
  L.push('      <DbtrAcct>');
  L.push('        <Id>');
  L.push('          <IBAN>' + xml(dIban) + '</IBAN>');
  L.push('        </Id>');
  L.push('      </DbtrAcct>');
  L.push('      <DbtrAgt>');
  L.push('        <FinInstnId>');
  if (dBic) L.push('          <BIC>' + xml(dBic) + '</BIC>');
  else {
    L.push('          <Othr>');
    L.push('            <Id>NOTPROVIDED</Id>');
    L.push('          </Othr>');
  }
  L.push('        </FinInstnId>');
  L.push('      </DbtrAgt>');
  L.push('      <ChrgBr>SLEV</ChrgBr>');
  for (const t of txs) {
    L.push('      <CdtTrfTxInf>');
    L.push('        <PmtId>');
    L.push('          <EndToEndId>' + xml(t.e2e) + '</EndToEndId>');
    L.push('        </PmtId>');
    L.push('        <Amt>');
    L.push('          <InstdAmt Ccy="EUR">' + majorText(t.amount, 2) + '</InstdAmt>');
    L.push('        </Amt>');
    if (t.bic) {
      L.push('        <CdtrAgt>');
      L.push('          <FinInstnId>');
      L.push('            <BIC>' + xml(t.bic) + '</BIC>');
      L.push('          </FinInstnId>');
      L.push('        </CdtrAgt>');
    }
    L.push('        <Cdtr>');
    L.push('          <Nm>' + xml(t.name) + '</Nm>');
    L.push('        </Cdtr>');
    L.push('        <CdtrAcct>');
    L.push('          <Id>');
    L.push('            <IBAN>' + xml(t.iban) + '</IBAN>');
    L.push('          </Id>');
    L.push('        </CdtrAcct>');
    if (t.info) {
      L.push('        <RmtInf>');
      L.push('          <Ustrd>' + xml(t.info) + '</Ustrd>');
      L.push('        </RmtInf>');
    }
    L.push('      </CdtTrfTxInf>');
  }
  L.push('    </PmtInf>');
  L.push('  </CstmrCdtTrfInitn>');
  L.push('</Document>');
  out.text = L.join('\n') + '\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'utf-8';
  out.count = txs.length;
  out.total_minor = total;
}

/* ---- bacs_csv */

const BACS_OK = /^[A-Z0-9 .&/\-]$/;

function writeBacs(fmt, input, out) {
  const lines = [];
  if (optionOf(fmt, input.options, 'header')) lines.push('sort_code,account_number,account_name,amount,reference');
  for (const p of input.payments) {
    const okAmount = amountChecks(p, out.problems, 9999999999);
    const sort = onlyDigits(s(p.bank_code) + s(p.branch_code));
    if (!/^\d{6}$/.test(sort)) problem(out.problems, p, 'bank_code', 'sort_code_shape', 'The sort code must be 6 digits');
    const acct = s(p.account).replace(/[\s-]/g, '');
    if (!/^\d{8}$/.test(acct)) problem(out.problems, p, 'account', 'account_shape', 'A UK account number has 8 digits (now ' + masked(acct) + ')');
    const nm = charset(p.name, BACS_OK, true);
    if (nm.text === '') problem(out.problems, p, 'name', 'name_charset', 'The name has no letters the bank can read');
    const ref = charset(p.reference || input.reference, BACS_OK, true).text.slice(0, 18);
    if (ref.replace(/ /g, '').length < 6) out.warnings.push({ ref: s(p.ref), code: 'reference_short', message: 'Bacs references should have at least 6 letters or digits' });
    if (!okAmount) continue;
    lines.push([sort, acct, nm.text.slice(0, 18), majorText(p.amount_minor, 2), ref].join(','));
    out.count += 1;
    out.total_minor += p.amount_minor;
  }
  if (out.problems.length) return;
  out.text = lines.join('\r\n') + '\r\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'ascii';
}

/* ---- zengin */

function zenginField(textValue, n, label, p, out, required) {
  const k = zenginKana(textValue);
  if (k.bad.length) {
    problem(out.problems, p, label, 'kana_charset', 'Needs half-width katakana: these characters have no bank form: ' + k.bad.join(''));
    return null;
  }
  if (required && k.text === '') {
    problem(out.problems, p, label, 'kana_missing', 'The name in kana (furigana) is missing');
    return null;
  }
  if (k.text.length > n) out.warnings.push({ ref: p ? s(p.ref) : '', code: 'kana_cut', message: label + ' cut to ' + n + ' characters: ' + k.text.slice(0, n) });
  return left(k.text, n);
}

function zenginType(v) {
  const t = s(v);
  if (t === 'ordinary' || t === 'savings' || t === '1') return '1';
  if (t === 'current' || t === 'checking' || t === '2') return '2';
  if (t === 'deposit' || t === '4') return '4';
  return '';
}

function writeZengin(fmt, input, out) {
  const py = input.payer || {};
  const kind = s(input.kind) === 'bonus' ? '12' : '11';
  const head = { consignor: zenginField(payerValue(fmt, py, 'consignor_kana'), 40, 'payer.consignor_kana', null, out, true),
    bank: zenginField(payerValue(fmt, py, 'bank_kana'), 15, 'payer.bank_kana', null, out, false),
    branch: zenginField(payerValue(fmt, py, 'branch_kana'), 15, 'payer.branch_kana', null, out, false) };
  const ptype = zenginType(payerValue(fmt, py, 'account_type'));
  const data = [];
  const withCodes = !!optionOf(fmt, input.options, 'employee_codes');
  for (const p of input.payments) {
    const okAmount = amountChecks(p, out.problems, 9999999999);
    const bank = onlyDigits(p.bank_code);
    const branch = onlyDigits(p.branch_code);
    if (!/^\d{4}$/.test(bank)) problem(out.problems, p, 'bank_code', 'bank_code_shape', 'The bank code (金融機関コード) must be 4 digits');
    if (!/^\d{3}$/.test(branch)) problem(out.problems, p, 'branch_code', 'branch_code_shape', 'The branch code (支店コード) must be 3 digits');
    if (bank === '9900') out.warnings.push({ ref: s(p.ref), code: 'japan_post', message: 'ゆうちょ銀行: use the branch code and 7-digit number for transfers from other banks, not the 記号番号' });
    const acct = onlyDigits(p.account);
    if (acct === '' || acct.length > 7 || s(p.account).replace(/[\s-]/g, '') !== acct) problem(out.problems, p, 'account', 'account_shape', 'The account number (口座番号) must be up to 7 digits (now ' + masked(p.account) + ')');
    const type = zenginType(p.account_type);
    if (type === '') problem(out.problems, p, 'account_type', 'account_type', 'Choose 普通, 当座 or 貯蓄 for this account');
    const nameSource = s(p.kana).trim() !== '' ? p.kana : p.name;
    const name = zenginField(nameSource, 30, 'kana', p, out, true);
    const bankKana = zenginField(p.bank_name_kana || '', 15, 'bank_name_kana', p, out, false);
    const branchKana = zenginField(p.branch_name_kana || '', 15, 'branch_name_kana', p, out, false);
    if (!okAmount || name === null || bankKana === null || branchKana === null) continue;
    const code = withCodes ? right(onlyDigits(p.ref).slice(-10), 10) : rep(' ', 10);
    data.push('2' + bank + bankKana + branch + branchKana + '0000' + type + right(acct, 7) + name + right(p.amount_minor, 10) + '0' + code + rep(' ', 10) + rep(' ', 9));
    out.count += 1;
    out.total_minor += p.amount_minor;
  }
  if (out.problems.length || head.consignor === null || head.bank === null || head.branch === null) return;
  if (out.count > 999999) { problem(out.problems, null, 'payments', 'too_many', 'More than 999,999 records'); return; }
  if (out.total_minor > 999999999999) { problem(out.problems, null, 'payments', 'total_too_large', 'The total is larger than 12 digits'); return; }
  const rec = [];
  rec.push('1' + kind + '0' + right(payerValue(fmt, py, 'consignor_code'), 10) + head.consignor + input.pay_date.slice(5, 7) + input.pay_date.slice(8, 10) +
    payerValue(fmt, py, 'bank_code') + head.bank + payerValue(fmt, py, 'branch_code') + head.branch + ptype + right(payerValue(fmt, py, 'account'), 7) + rep(' ', 17));
  for (const d of data) rec.push(d);
  rec.push('8' + right(out.count, 6) + right(out.total_minor, 12) + rep(' ', 101));
  rec.push('9' + rep(' ', 119));
  const bytes = [];
  const nl = optionOf(fmt, input.options, 'newline');
  for (const r of rec) {
    const b = jisBytes(r);
    if (b.length !== 120) throw new Error('zengin record length ' + b.length);
    for (const x of b) bytes.push(x);
    if (nl === 'crlf') bytes.push(13, 10);
  }
  if (optionOf(fmt, input.options, 'eof')) bytes.push(0x1a);
  out.bytes = bytes;
  out.text = rec.join(nl === 'crlf' ? '\r\n' : '') + (nl === 'crlf' ? '\r\n' : '');
  out.encoding = 'shift_jis';
}

/* ---- sg_giro_csv */

const PLAIN_OK = /^[A-Za-z0-9 .,'&/()\-]$/;

function writeSgGiro(fmt, input, out) {
  const lines = ['name,bank_code,branch_code,account_number,amount,purpose_code,reference,employee_number'];
  for (const p of input.payments) {
    const okAmount = amountChecks(p, out.problems, 99999999999);
    const bank = s(p.bic).trim() ? s(p.bic).toUpperCase().replace(/\s+/g, '') : onlyDigits(p.bank_code);
    if (s(p.bic).trim() ? !bicValid(bank) : !/^\d{4}$/.test(bank)) problem(out.problems, p, 'bank_code', 'bank_code_shape', 'Give the 4-digit bank code or the SWIFT code');
    const branch = onlyDigits(p.branch_code);
    if (branch !== '' && !/^\d{3}$/.test(branch)) problem(out.problems, p, 'branch_code', 'branch_code_shape', 'The branch code has 3 digits');
    const acct = onlyDigits(p.account);
    if (acct.length < 6 || acct.length > 34 || s(p.account).replace(/[\s-]/g, '') !== acct) problem(out.problems, p, 'account', 'account_shape', 'The account number must be 6 to 34 digits (now ' + masked(p.account) + ')');
    const nm = charset(p.name, PLAIN_OK, true);
    if (nm.text === '') problem(out.problems, p, 'name', 'name_charset', 'The name has no Latin letters the bank can read');
    if (!okAmount) continue;
    lines.push([csvQuoted(nm.text.slice(0, 35)), csvQuoted(bank), csvQuoted(branch), csvQuoted(acct), majorText(p.amount_minor, 2), 'SALA',
      csvQuoted(charset(p.reference || input.reference, PLAIN_OK, true).text.slice(0, 35)), csvQuoted(s(p.ref))].join(','));
    out.count += 1;
    out.total_minor += p.amount_minor;
  }
  if (out.problems.length) return;
  out.text = lines.join('\r\n') + '\r\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'ascii';
}

/* ---- in_neft_csv */

function writeInNeft(fmt, input, out) {
  const lines = ['beneficiary_name,account_number,ifsc,amount,payment_mode,narration,employee_number,email'];
  for (const p of input.payments) {
    const okAmount = amountChecks(p, out.problems, 99999999999);
    const ifsc = s(p.bank_code || p.bic).toUpperCase().replace(/\s+/g, '');
    if (!ifscValid(ifsc)) problem(out.problems, p, 'bank_code', 'ifsc_shape', 'The IFSC is 11 characters: 4 letters, 0, then 6 letters or digits');
    const acct = onlyDigits(p.account);
    if (acct.length < 6 || acct.length > 18 || s(p.account).replace(/[\s-]/g, '') !== acct) problem(out.problems, p, 'account', 'account_shape', 'The account number must be 6 to 18 digits (now ' + masked(p.account) + ')');
    const nm = charset(p.name, PLAIN_OK, true);
    if (nm.text === '') problem(out.problems, p, 'name', 'name_charset', 'The name has no Latin letters the bank can read');
    if (!okAmount) continue;
    lines.push([csvQuoted(nm.text.slice(0, 50)), csvQuoted(acct), csvQuoted(ifsc), majorText(p.amount_minor, 2), 'NEFT',
      csvQuoted(charset(p.reference || input.reference, PLAIN_OK, true).text.slice(0, 30)), csvQuoted(s(p.ref)), csvQuoted(s(p.email))].join(','));
    out.count += 1;
    out.total_minor += p.amount_minor;
  }
  if (out.problems.length) return;
  out.text = lines.join('\r\n') + '\r\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'ascii';
}

/* ---- Malaysia */

const MY_ID_TYPES = { nric: 'NRIC', mykad: 'NRIC', old_ic: 'OLD IC', passport: 'PASSPORT', police: 'POLICE', army: 'ARMY', mypr: 'OTHERS', other: 'OTHERS', '': '' };

function myRow(p, input, out) {
  const okAmount = amountChecks(p, out.problems, 99999999999);
  const bic = s(p.bic || p.bank_code).toUpperCase().replace(/\s+/g, '');
  if (!bicValid(bic)) problem(out.problems, p, 'bic', 'bic_shape', 'Give the receiving bank\'s SWIFT code (for example MBBEMYKL)');
  const acct = onlyDigits(p.account);
  if (acct.length < 6 || acct.length > 20 || s(p.account).replace(/[\s-]/g, '') !== acct) problem(out.problems, p, 'account', 'account_shape', 'The account number must be 6 to 20 digits (now ' + masked(p.account) + ')');
  const idType = MY_ID_TYPES[s(p.id_type)] !== undefined ? MY_ID_TYPES[s(p.id_type)] : 'OTHERS';
  const idNumber = s(p.id_number).replace(/[\s-]/g, '').toUpperCase();
  if (idType === 'NRIC' && !/^\d{12}$/.test(idNumber)) problem(out.problems, p, 'id_number', 'id_shape', 'A MyKad number has 12 digits');
  const nm = charset(p.name, PLAIN_OK, true);
  if (nm.text === '') problem(out.problems, p, 'name', 'name_charset', 'The name has no Latin letters the bank can read');
  if (!okAmount) return null;
  return { name: nm.text.slice(0, 40), bic: bic, account: acct, id_type: idNumber ? idType : '', id_number: idNumber, amount: majorText(p.amount_minor, 2),
    reference: charset(p.reference || input.reference, PLAIN_OK, true).text.slice(0, 20), description: 'SALARY', email: s(p.email).trim() };
}

function writeMaybank(fmt, input, out) {
  const date = input.pay_date.slice(8, 10) + '/' + input.pay_date.slice(5, 7) + '/' + input.pay_date.slice(0, 4);
  const lines = ['Beneficiary Name,Beneficiary Bank,Beneficiary Account No,ID Type,ID Number,Payment Amount,Payment Reference,Payment Description,Beneficiary Email,Crediting Date'];
  for (const p of input.payments) {
    const r = myRow(p, input, out);
    if (!r) continue;
    lines.push([csvQuoted(r.name), csvQuoted(r.bic), csvQuoted(r.account), csvQuoted(r.id_type), csvQuoted(r.id_number), r.amount, csvQuoted(r.reference), csvQuoted(r.description), csvQuoted(r.email), csvQuoted(date)].join(','));
    out.count += 1;
    out.total_minor += p.amount_minor;
  }
  if (out.problems.length) return;
  out.text = lines.join('\r\n') + '\r\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'ascii';
}

function pipeSafe(v) {
  return s(v).replace(/[|\r\n]/g, ' ');
}

function writeCimb(fmt, input, out) {
  const py = input.payer || {};
  const rows = [];
  for (const p of input.payments) {
    const r = myRow(p, input, out);
    if (!r) continue;
    rows.push(['D', r.name, r.bic, r.account, r.id_type, r.id_number, r.amount, r.reference, r.description, r.email].map(pipeSafe).join('|'));
    out.count += 1;
    out.total_minor += p.amount_minor;
  }
  if (out.problems.length) return;
  const total = majorText(out.total_minor, 2);
  const lines = [['H', charset(payerValue(fmt, py, 'name'), PLAIN_OK, true).text.slice(0, 40), payerValue(fmt, py, 'account'), input.pay_date.replace(/-/g, ''), String(out.count), total].map(pipeSafe).join('|')];
  for (const r of rows) lines.push(r);
  lines.push(['T', String(out.count), total].join('|'));
  out.text = lines.join('\r\n') + '\r\n';
  out.bytes = utf8Bytes(out.text);
  out.encoding = 'ascii';
}

const WRITERS = {
  generic_csv: writeGeneric, nacha_ppd: writeNacha, aba: writeAba, sepa_pain001: writeSepa, bacs_csv: writeBacs,
  zengin: writeZengin, sg_giro_csv: writeSgGiro, in_neft_csv: writeInNeft, my_maybank_csv: writeMaybank, my_cimb_txt: writeCimb,
};

/**
 * Write one bank file. Never throws for bad data: problems come back with
 * ok false and no bytes.
 */
function write(format, input) {
  const fmt = FORMATS[format];
  const out = { ok: false, format: format, filename: '', mime: fmt ? fmt.mime : '', encoding: '', bytes: [], text: '', count: 0, total_minor: 0,
    currency: '', sha256: '', problems: [], warnings: [], label: fmt ? fmt.label : '', official: fmt ? fmt.official : false };
  if (!fmt) {
    problem(out.problems, null, 'format', 'format_unknown', 'Unknown bank file format ' + s(format));
    return out;
  }
  const inp = input || {};
  const currency = s(inp.currency).toUpperCase();
  out.currency = fmt.currency || currency;
  if (fmt.currency && currency && currency !== fmt.currency) problem(out.problems, null, 'currency', 'currency_mismatch', fmt.name + ' carries ' + fmt.currency + ' only; this run is in ' + currency);
  if (!fmt.currency && !/^[A-Z]{3}$/.test(currency)) problem(out.problems, null, 'currency', 'currency_missing', 'The run currency is missing');
  if (!isDayText(inp.pay_date)) problem(out.problems, null, 'pay_date', 'pay_date', 'The pay date is missing');
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s(inp.created))) problem(out.problems, null, 'created', 'created', 'The creation time is missing');
  const payments = Array.isArray(inp.payments) ? inp.payments : [];
  if (payments.length === 0) problem(out.problems, null, 'payments', 'no_payments', 'There is nobody to pay by bank in this run');
  payerChecks(fmt, inp.payer, out.problems);
  if (out.problems.length) return out;
  const full = { payer: inp.payer || {}, pay_date: inp.pay_date, created: s(inp.created).length === 16 ? s(inp.created) + ':00' : s(inp.created), reference: s(inp.reference),
    currency: out.currency, kind: s(inp.kind) || 'salary', payments: payments, options: inp.options || {} };
  WRITERS[format](fmt, full, out);
  if (out.problems.length) {
    out.bytes = [];
    out.text = '';
    out.count = 0;
    out.total_minor = 0;
    return out;
  }
  if (out.count === 0) {
    out.count = payments.length;
    let t = 0;
    for (const p of payments) t += p.amount_minor;
    out.total_minor = t;
  }
  out.ok = true;
  out.sha256 = sha256(out.bytes);
  out.filename = format + '-' + (s(inp.file_stem) ? s(inp.file_stem).replace(/[^A-Za-z0-9_-]+/g, '-') + '-' : '') + inp.pay_date + '.' + fmt.extension;
  return out;
}

module.exports = {
  FORMATS: FORMATS,
  list: list,
  info: info,
  write: write,
  splitNet: splitNet,
  routingValid: routingValid,
  ibanCheck: ibanCheck,
  bicValid: bicValid,
  bsbFormat: bsbFormat,
  ifscValid: ifscValid,
  zenginKana: zenginKana,
  jisBytes: jisBytes,
  utf8Bytes: utf8Bytes,
  sha256: sha256,
  majorText: majorText,
  exponentOf: exponentOf,
  latinToAscii: latinToAscii,
  masked: masked,
};
