// Country data files for jp, sg, in, my and metadata-only Asian countries.
import fs from 'node:fs';
import path from 'node:path';
import { writeModule, RETRIEVED } from './emit.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// ---------------------------------------------------------------- Japan
const JA_EN = { '元日': "New Year's Day", '成人の日': 'Coming of Age Day', '建国記念の日': 'National Foundation Day', '天皇誕生日': "Emperor's Birthday", '春分の日': 'Vernal Equinox Day', '昭和の日': 'Showa Day', '憲法記念日': 'Constitution Memorial Day', 'みどりの日': 'Greenery Day', 'こどもの日': "Children's Day", '海の日': 'Marine Day', '山の日': 'Mountain Day', '敬老の日': 'Respect for the Aged Day', '秋分の日': 'Autumnal Equinox Day', 'スポーツの日': 'Sports Day', '文化の日': 'Culture Day', '勤労感謝の日': 'Labour Thanksgiving Day' };

function jpHolidays() {
  const csv = new TextDecoder('shift_jis').decode(fs.readFileSync(path.join(here, '..', 'src', 'cao_syukujitsu.csv')));
  const raw = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^(202[67])\/(\d{1,2})\/(\d{1,2}),(.+)$/);
    if (m) raw.push({ day: m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'), ja: m[4].trim() });
  }
  const days = new Set(raw.map((r) => r.day));
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  return raw.map((r) => {
    if (r.ja !== '休日') return { day: r.day, name: r.ja + ' (' + (JA_EN[r.ja] || r.ja) + ')', region: '', kind: 'public' };
    // A 休日 between two holidays is a 国民の休日; otherwise it is a 振替休日 for a holiday on a Sunday.
    if (days.has(shift(r.day, -1)) && days.has(shift(r.day, 1))) return { day: r.day, name: "国民の休日 (Citizens' Holiday)", region: '', kind: 'public' };
    return { day: r.day, name: '振替休日 (Substitute Holiday)', region: '', kind: 'observed' };
  });
}

const JP_PREFS = [['01', 'Hokkaido'], ['02', 'Aomori'], ['03', 'Iwate'], ['04', 'Miyagi'], ['05', 'Akita'], ['06', 'Yamagata'], ['07', 'Fukushima'], ['08', 'Ibaraki'], ['09', 'Tochigi'], ['10', 'Gunma'], ['11', 'Saitama'], ['12', 'Chiba'], ['13', 'Tokyo'], ['14', 'Kanagawa'], ['15', 'Niigata'], ['16', 'Toyama'], ['17', 'Ishikawa'], ['18', 'Fukui'], ['19', 'Yamanashi'], ['20', 'Nagano'], ['21', 'Gifu'], ['22', 'Shizuoka'], ['23', 'Aichi'], ['24', 'Mie'], ['25', 'Shiga'], ['26', 'Kyoto'], ['27', 'Osaka'], ['28', 'Hyogo'], ['29', 'Nara'], ['30', 'Wakayama'], ['31', 'Tottori'], ['32', 'Shimane'], ['33', 'Okayama'], ['34', 'Hiroshima'], ['35', 'Yamaguchi'], ['36', 'Tokushima'], ['37', 'Kagawa'], ['38', 'Ehime'], ['39', 'Kochi'], ['40', 'Fukuoka'], ['41', 'Saga'], ['42', 'Nagasaki'], ['43', 'Kumamoto'], ['44', 'Oita'], ['45', 'Miyazaki'], ['46', 'Kagoshima'], ['47', 'Okinawa']];

function jp() {
  return {
    code: 'JP', name: 'Japan', currency: 'JPY', timezone: 'Asia/Tokyo', timezones: ['Asia/Tokyo'], date_format: 'YYYY/MM/DD', week_start: 1, weekend: [0, 6], name_order: 'family_first',
    regions: JP_PREFS.map(([code, name]) => ({ code, name })),
    id_types: [
      { code: 'my_number', label: 'My Number (個人番号)', mask: 'last4', pattern: '^\\d{12}$' },
      { code: 'residence_card', label: 'Residence card (在留カード)', mask: 'last4', pattern: '^[A-Z]{2}\\d{8}[A-Z]{2}$' },
      { code: 'pension_number', label: 'Basic pension number (基礎年金番号)', mask: 'last4', pattern: '^\\d{4}-?\\d{6}$' },
      { code: 'ei_number', label: 'Employment insurance number (雇用保険被保険者番号)', mask: 'last4', pattern: '^\\d{4}-?\\d{6}-?\\d$' },
      { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }
    ],
    packs: ['jp'],
    bank_formats: ['zengin', 'generic_csv'],
    schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', break_min: 60 },
    employment_types: [{ code: 'full_time', name: '正社員 (regular full time)' }, { code: 'contract', name: '契約社員 (fixed term)' }, { code: 'part_time', name: 'パート・アルバイト (part time)' }, { code: 'officer', name: '役員 (company officer)' }, { code: 'intern', name: 'インターン (intern)' }],
    leave_types: [
      { code: 'annual', name: '年次有給休暇 (annual paid leave)', paid: true, unit: 'day', statutory: true, days: 10, note: 'After 6 months with 80 percent attendance: 10 days, then 11, 12, 14, 16, 18 and 20 from 6.5 years; proportional grants for short weeks; expires after 2 years; employers must ensure 5 days a year are taken for grants of 10 or more, and keep a 年次有給休暇管理簿 (長野労働局 handbook, Feb 2026).' },
      { code: 'maternity', name: '産前産後休業 (maternity leave)', paid: false, unit: 'day', statutory: true, days: 0, note: 'Statutory leave; pay comes from health insurance (出産手当金), not the employer. Not re-verified this session.' },
      { code: 'childcare', name: '育児休業 (childcare leave)', paid: false, unit: 'day', statutory: true, days: 0, note: 'Statutory leave; benefit from employment insurance. Not re-verified this session.' },
      { code: 'family_care', name: '介護休業 (family care leave)', paid: false, unit: 'day', statutory: true, days: 0, note: 'Statutory leave; benefit from employment insurance. Not re-verified this session.' }
    ],
    min_wage: { currency: 'JPY', note: 'Set by prefecture; FY2026 national weighted average 1,177 yen an hour, effective October to December 2026 by prefecture (MHLW, search summary). Prefecture amounts are not encoded.' },
    holidays: jpHolidays(),
    filings: [
      { code: 'jp_gensen', name: '源泉所得税 payment', due_rule: '10th of the following month' },
      { code: 'jp_juminzei', name: '住民税 special collection payment', due_rule: '10th of the following month' },
      { code: 'jp_santei', name: '算定基礎届', due_rule: '1 to 10 July' },
      { code: 'jp_rodo_hoken', name: '労働保険 年度更新', due_rule: '1 June to 10 July' },
      { code: 'jp_hotei_chosho', name: '源泉徴収票 and 給与支払報告書', due_rule: '31 January' }
    ],
    sources: [
      { title: '内閣府 国民の祝日 CSV (syukujitsu.csv)', url: 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv', retrieved: RETRIEVED },
      { title: '長野労働局 労働条件ハンドブック (Feb 2026) pp.80 to 85', url: 'https://jsite.mhlw.go.jp/nagano-roudoukyoku/content/contents/roudoujyouken_handbook202602-12.pdf', retrieved: RETRIEVED }
    ],
    notes: 'Holidays are the Cabinet Office list for 2026 and 2027 (休日 rows: 振替休日 marked observed, 国民の休日 public). Year-end company closures (for example 29 December to 3 January) are company holidays, not statutory, and are not included.'
  };
}

// ---------------------------------------------------------------- Singapore
function sg() {
  const h = (day, name, kind = 'public') => ({ day, name, region: '', kind });
  return {
    code: 'SG', name: 'Singapore', currency: 'SGD', timezone: 'Asia/Singapore', date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'given_first',
    regions: [],
    id_types: [
      { code: 'nric', label: 'NRIC', mask: 'last4', pattern: '^[STFGM]\\d{7}[A-Z]$' },
      { code: 'fin', label: 'FIN', mask: 'last4', pattern: '^[FGM]\\d{7}[A-Z]$' },
      { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }
    ],
    packs: ['sg'],
    bank_formats: ['sg_giro_csv', 'generic_csv'],
    schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', break_min: 60 },
    employment_types: [{ code: 'full_time', name: 'Full time' }, { code: 'part_time', name: 'Part time' }, { code: 'contract', name: 'Fixed-term contract' }, { code: 'intern', name: 'Intern' }],
    leave_types: [
      { code: 'annual', name: 'Annual leave', paid: true, unit: 'day', statutory: true, days: 7, note: 'Employment Act, after 3 months of service: 7 days in the 1st year, plus 1 a year to 14 from the 8th year (MOM, updated 17 Apr 2023).' },
      { code: 'sick', name: 'Outpatient sick leave', paid: true, unit: 'day', statutory: true, days: 14, note: 'After 3 months: 5, 8, 11, then 14 days from 6 months (MOM, updated 12 Jan 2026).' },
      { code: 'hospitalisation', name: 'Hospitalisation leave', paid: true, unit: 'day', statutory: true, days: 60, note: 'After 3 months: 15, 30, 45, then 60 days from 6 months, including the 14 outpatient days (MOM).' }
    ],
    min_wage: { currency: 'SGD', note: 'No general minimum wage; Progressive Wage Model sectors and the Local Qualifying Salary apply to some employers.' },
    holidays: [
      h('2026-01-01', "New Year's Day"), h('2026-02-17', 'Chinese New Year'), h('2026-02-18', 'Chinese New Year (second day)'), h('2026-03-21', 'Hari Raya Puasa'), h('2026-04-03', 'Good Friday'), h('2026-05-01', 'Labour Day'), h('2026-05-27', 'Hari Raya Haji'), h('2026-05-31', 'Vesak Day'), h('2026-06-01', 'Vesak Day (observed)', 'observed'), h('2026-08-09', 'National Day'), h('2026-08-10', 'National Day (observed)', 'observed'), h('2026-11-08', 'Deepavali'), h('2026-11-09', 'Deepavali (observed)', 'observed'), h('2026-12-25', 'Christmas Day'),
      h('2027-01-01', "New Year's Day"), h('2027-02-06', 'Chinese New Year'), h('2027-02-07', 'Chinese New Year (second day)'), h('2027-02-08', 'Chinese New Year (observed)', 'observed'), h('2027-03-10', 'Hari Raya Puasa'), h('2027-03-26', 'Good Friday'), h('2027-05-01', 'Labour Day'), h('2027-05-17', 'Hari Raya Haji'), h('2027-05-20', 'Vesak Day'), h('2027-08-09', 'National Day'), h('2027-10-28', 'Deepavali'), h('2027-12-25', 'Christmas Day')
    ],
    filings: [
      { code: 'sg_cpf', name: 'CPF, SDL and self-help group payment', due_rule: '14th of the following month' },
      { code: 'sg_ir8a', name: 'IR8A (Auto-Inclusion Scheme)', due_rule: '1 March' }
    ],
    sources: [
      { title: 'MOM, Public holidays (updated 19 Jun 2026)', url: 'https://www.mom.gov.sg/employment-practices/public-holidays', retrieved: RETRIEVED },
      { title: 'MOM, Annual leave eligibility and entitlement', url: 'https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement', retrieved: RETRIEVED },
      { title: 'MOM, Sick leave eligibility and entitlement', url: 'https://www.mom.gov.sg/employment-practices/leave/sick-leave/eligibility-and-entitlement', retrieved: RETRIEVED }
    ],
    notes: 'Observed rows are the Mondays MOM lists for holidays that fall on a Sunday (they apply when the rest day is Sunday). Saturday holidays (for example Labour Day 2027) give a day off in lieu or pay under the Employment Act, which is not encoded. Maternity, paternity, shared parental and childcare leave are not encoded.'
  };
}

// ---------------------------------------------------------------- India
const IN_REGIONS = [['AN', 'Andaman and Nicobar Islands'], ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'], ['AS', 'Assam'], ['BR', 'Bihar'], ['CH', 'Chandigarh'], ['CG', 'Chhattisgarh'], ['DH', 'Dadra and Nagar Haveli and Daman and Diu'], ['DL', 'Delhi'], ['GA', 'Goa'], ['GJ', 'Gujarat'], ['HR', 'Haryana'], ['HP', 'Himachal Pradesh'], ['JK', 'Jammu and Kashmir'], ['JH', 'Jharkhand'], ['KA', 'Karnataka'], ['KL', 'Kerala'], ['LA', 'Ladakh'], ['LD', 'Lakshadweep'], ['MP', 'Madhya Pradesh'], ['MH', 'Maharashtra'], ['MN', 'Manipur'], ['ML', 'Meghalaya'], ['MZ', 'Mizoram'], ['NL', 'Nagaland'], ['OD', 'Odisha'], ['PY', 'Puducherry'], ['PB', 'Punjab'], ['RJ', 'Rajasthan'], ['SK', 'Sikkim'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['TR', 'Tripura'], ['UP', 'Uttar Pradesh'], ['UK', 'Uttarakhand'], ['WB', 'West Bengal']];

function inHolidays() {
  const c = (day, name) => ({ day, name, region: '', kind: 'public' });
  const dl = (day, name) => ({ day, name, region: 'DL', kind: 'public' });
  return [
    c('2026-01-26', 'Republic Day'), dl('2026-03-04', 'Holi'), c('2026-03-21', 'Id-ul-Fitr'), dl('2026-03-26', 'Ram Navami'), c('2026-03-31', 'Mahavir Jayanti'), c('2026-04-03', 'Good Friday'), c('2026-05-01', 'Buddha Purnima'), c('2026-05-27', 'Id-ul-Zuha (Bakrid)'), c('2026-06-26', 'Muharram'), c('2026-08-15', 'Independence Day'), c('2026-08-26', 'Milad-un-Nabi (Prophet Mohammad\'s Birthday)'), dl('2026-09-04', 'Janmashtami (Vaishnav)'), c('2026-10-02', "Mahatma Gandhi's Birthday"), c('2026-10-20', 'Dussehra (Vijaya Dashmi)'), c('2026-11-08', 'Diwali (Deepavali)'), c('2026-11-24', "Guru Nanak's Birthday"), c('2026-12-25', 'Christmas Day'),
    c('2027-01-26', 'Republic Day'), c('2027-03-10', 'Id-ul-Fitr'), dl('2027-03-23', 'Holi'), c('2027-03-26', 'Good Friday'), dl('2027-04-15', 'Ram Navami'), c('2027-04-19', 'Mahavir Jayanti'), c('2027-05-17', 'Id-ul-Zuha (Bakrid)'), c('2027-05-20', 'Buddha Purnima'), c('2027-06-16', 'Muharram'), c('2027-08-15', 'Independence Day'), c('2027-08-15', 'Milad-un-Nabi (Prophet Mohammad\'s Birthday)'), dl('2027-08-25', 'Janmashtami (Vaishnav)'), c('2027-10-02', "Mahatma Gandhi's Birthday"), c('2027-10-09', 'Dussehra (Vijaya Dashmi)'), c('2027-10-29', 'Diwali (Deepavali)'), c('2027-11-14', "Guru Nanak's Birthday"), c('2027-12-25', 'Christmas Day')
  ];
}

function india() {
  return {
    code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'given_first',
    regions: IN_REGIONS.map(([code, name]) => ({ code, name })),
    id_types: [
      { code: 'pan', label: 'PAN', mask: 'last4', pattern: '^[A-Z]{5}\\d{4}[A-Z]$' },
      { code: 'aadhaar', label: 'Aadhaar', mask: 'last4', pattern: '^\\d{12}$' },
      { code: 'uan', label: 'UAN (EPF)', mask: 'last4', pattern: '^\\d{12}$' },
      { code: 'esic_ip', label: 'ESIC insurance number', mask: 'last4', pattern: '^\\d{10}$' },
      { code: 'passport', label: 'Passport', mask: 'last3', pattern: '^[A-Z]\\d{7}$' }
    ],
    packs: ['in', 'in-epf', 'in-esi'],
    region_packs: { MH: ['in-pt-mh'], KA: ['in-pt-ka'], TN: ['in-pt-tn'], WB: ['in-pt-wb'], TG: ['in-pt-tg'], GJ: ['in-pt-gj'], AP: ['in-pt-ap'] },
    bank_formats: ['in_neft_csv', 'generic_csv'],
    schedule: { days: [1, 2, 3, 4, 5], start: '09:30', end: '18:30', break_min: 60 },
    employment_types: [{ code: 'full_time', name: 'Permanent full time' }, { code: 'fixed_term', name: 'Fixed-term employment' }, { code: 'contract', name: 'Contract (through a contractor)' }, { code: 'part_time', name: 'Part time' }, { code: 'apprentice', name: 'Apprentice' }, { code: 'intern', name: 'Intern' }],
    leave_types: [],
    min_wage: { currency: 'INR', note: 'Minimum wages are set by each state and by skill level; not encoded.' },
    holidays: inHolidays(),
    filings: [
      { code: 'in_tds_deposit', name: 'TDS deposit', due_rule: '7th of the following month (30 April for March)' },
      { code: 'in_24q', name: 'Quarterly TDS statement on salaries', due_rule: '31 July, 31 October, 31 January, 31 May' },
      { code: 'in_form16', name: 'Form 16 to employees', due_rule: '15 June' },
      { code: 'in_ecr', name: 'EPF ECR and payment', due_rule: '15th of the following month' },
      { code: 'in_esic', name: 'ESI contribution', due_rule: '15th of the following month' }
    ],
    sources: [
      { title: 'DoPT O.M. No. 12/2/2023-JCA dated 16.07.2026, Holidays to be observed in Central Government Offices during 2027 (copy circulated by the Department of Posts, 08.09.2026)', url: 'https://utilities.cept.gov.in/dop/pdfbind.ashx?id=15435', retrieved: RETRIEVED },
      { title: 'DoPT O.M. No. 12/2/2023-JCA dated 03.07.2025 for 2026, as reproduced by StaffNews', url: 'https://www.staffnews.in/2025/07/list-of-holidays-2026-closed-holidays.html', retrieved: RETRIEVED }
    ],
    notes: 'Holidays: the 14 compulsory central government holidays (region empty) plus the 3 holidays DoPT chose for offices in Delhi and New Delhi (region DL: Holi, Ram Navami, Janmashtami). In other states the Central Government Employees Welfare Coordination Committee picks 3 from 12 optional holidays, and private employers follow the state Shops and Establishments rules (national holidays: Republic Day, Independence Day, Gandhi Jayanti, plus festival holidays), so add state holidays per entity. The 2026 list is from a reproduction of the DoPT order (the DoPT site was not readable). Leave minimums come from state Shops and Establishments Acts and the Labour Codes and are not encoded. Many employers work a 5-day week; some work Saturdays (set the schedule).'
  };
}

// ---------------------------------------------------------------- Malaysia
const MY_REGIONS = [['01', 'Johor'], ['02', 'Kedah'], ['03', 'Kelantan'], ['04', 'Melaka'], ['05', 'Negeri Sembilan'], ['06', 'Pahang'], ['07', 'Pulau Pinang'], ['08', 'Perak'], ['09', 'Perlis'], ['10', 'Selangor'], ['11', 'Terengganu'], ['12', 'Sabah'], ['13', 'Sarawak'], ['14', 'Wilayah Persekutuan Kuala Lumpur'], ['15', 'Wilayah Persekutuan Labuan'], ['16', 'Wilayah Persekutuan Putrajaya']];

function myHolidays() {
  const out = [];
  const nat = (day, name) => out.push({ day, name, region: '', kind: 'public' });
  const st = (regions, day, name) => regions.forEach((r) => out.push({ day, name, region: r, kind: 'public' }));
  const all = MY_REGIONS.map((r) => r[0]);
  const exceptSarawak = all.filter((r) => r !== '13');
  const newYear = ['04', '05', '06', '07', '08', '10', '12', '13', '14', '15', '16'];
  // 2026 (Bank Muamalat reproduction of the JPM list)
  st(newYear, '2026-01-01', "New Year's Day");
  nat('2026-02-17', 'Chinese New Year'); nat('2026-02-18', 'Chinese New Year (second day)');
  nat('2026-03-21', 'Hari Raya Aidilfitri'); nat('2026-03-22', 'Hari Raya Aidilfitri (second day)');
  nat('2026-05-01', 'Labour Day'); nat('2026-05-27', 'Hari Raya Aidiladha'); nat('2026-05-31', 'Wesak Day');
  nat('2026-06-01', "Yang di-Pertuan Agong's Birthday"); nat('2026-06-17', 'Awal Muharam'); nat('2026-08-25', 'Maulidur Rasul');
  nat('2026-08-31', 'National Day (Hari Merdeka)'); nat('2026-09-16', 'Malaysia Day'); st(exceptSarawak, '2026-11-08', 'Deepavali'); nat('2026-12-25', 'Christmas Day');
  st(['14', '16', '15'], '2026-02-01', 'Federal Territory Day'); st(['14', '16', '07', '08', '01', '05', '10'], '2026-02-01', 'Thaipusam');
  st(['14', '16', '15', '07', '08', '09', '03', '06', '10', '11'], '2026-03-07', 'Nuzul Al-Quran');
  st(['15', '12'], '2026-05-30', 'Harvest Festival (Kaamatan)'); st(['15', '12'], '2026-05-31', 'Harvest Festival (Kaamatan, second day)');
  st(['01', '02', '04'], '2026-02-19', 'Awal Ramadan'); st(['01'], '2026-03-23', "Sultan of Johor's Birthday"); st(['01'], '2026-07-21', 'Hari Hol Almarhum Sultan Iskandar');
  st(['02', '09', '05', '11'], '2026-01-17', 'Israk and Mikraj'); st(['02', '03', '09', '11'], '2026-05-28', 'Hari Raya Aidiladha (second day)'); st(['02'], '2026-06-21', "Sultan of Kedah's Birthday");
  st(['03', '11'], '2026-05-26', 'Arafah Day'); st(['03'], '2026-09-29', "Sultan of Kelantan's Birthday"); st(['03'], '2026-09-30', "Sultan of Kelantan's Birthday (second day)");
  st(['04'], '2026-02-20', 'Melaka Independence Declaration Day'); st(['04'], '2026-08-24', "Melaka Governor's Birthday");
  st(['05'], '2026-01-14', "Yang di-Pertuan Besar Negeri Sembilan's Birthday");
  st(['06'], '2026-05-22', 'Hari Hol Pahang'); st(['06'], '2026-07-31', "Sultan of Pahang's Birthday");
  st(['07'], '2026-07-07', 'George Town World Heritage City Day'); st(['07'], '2026-07-11', "Penang Governor's Birthday");
  st(['08'], '2026-11-06', "Sultan of Perak's Birthday"); st(['09'], '2026-05-17', "Raja of Perlis' Birthday"); st(['10'], '2026-12-11', "Sultan of Selangor's Birthday");
  st(['12'], '2026-03-30', "Sabah Governor's Birthday"); st(['12', '13'], '2026-04-03', 'Good Friday'); st(['12'], '2026-12-24', 'Christmas Eve');
  st(['13'], '2026-06-01', 'Hari Gawai'); st(['13'], '2026-06-02', 'Hari Gawai (second day)'); st(['13'], '2026-07-22', 'Sarawak Day'); st(['13'], '2026-10-10', "Sarawak Governor's Birthday");
  st(['11'], '2026-03-04', 'Anniversary of the Installation of the Sultan of Terengganu'); st(['11'], '2026-04-26', "Sultan of Terengganu's Birthday");
  // 2027 federal holidays (secondary summary of the JPM 2027 list; state holidays not included)
  st(newYear, '2027-01-01', "New Year's Day");
  nat('2027-02-06', 'Chinese New Year'); nat('2027-02-07', 'Chinese New Year (second day)');
  nat('2027-03-10', 'Hari Raya Aidilfitri'); nat('2027-03-11', 'Hari Raya Aidilfitri (second day)');
  nat('2027-05-01', 'Labour Day'); nat('2027-05-17', 'Hari Raya Aidiladha'); st(['02', '03', '09', '11'], '2027-05-18', 'Hari Raya Aidiladha (second day)'); nat('2027-05-20', 'Wesak Day');
  nat('2027-06-06', 'Awal Muharam'); nat('2027-06-07', "Yang di-Pertuan Agong's Birthday"); nat('2027-08-15', 'Maulidur Rasul');
  nat('2027-08-31', 'National Day (Hari Merdeka)'); nat('2027-09-16', 'Malaysia Day'); st(exceptSarawak, '2027-10-28', 'Deepavali'); nat('2027-12-25', 'Christmas Day');
  // Replacement days: a public holiday on the weekly rest day gives the next working day that is not already a
  // holiday (Employment Act 1955 s 60D; the JPM list note: "the next day shall be a public holiday"). Rest day
  // Sunday with a Saturday-Sunday weekend, except Kedah, Kelantan and Terengganu: rest day Friday, weekend
  // Friday-Saturday. Generated per state; Saturday holidays in Saturday-Sunday states get none.
  const friSat = { '02': true, '03': true, '11': true };
  const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const nextDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const observed = [];
  for (const [r] of MY_REGIONS) {
    const rest = friSat[r] ? 5 : 0;
    const off = friSat[r] ? [5, 6] : [6, 0];
    const mine = out.filter((h) => h.region === '' || h.region === r).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const taken = new Set(mine.map((h) => h.day));
    for (const h of mine) {
      if (dow(h.day) !== rest) continue;
      let d = nextDay(h.day);
      while (off.indexOf(dow(d)) >= 0 || taken.has(d)) d = nextDay(d);
      taken.add(d);
      observed.push({ day: d, name: h.name + ' (replacement day)', region: r, kind: 'observed' });
    }
  }
  return out.concat(observed).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.region < b.region ? -1 : a.region > b.region ? 1 : a.name < b.name ? -1 : 1));
}

function my() {
  return {
    code: 'MY', name: 'Malaysia', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', timezones: ['Asia/Kuala_Lumpur', 'Asia/Kuching'], date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'given_first',
    regions: MY_REGIONS.map(([code, name]) => ({ code, name })),
    id_types: [
      { code: 'mykad', label: 'MyKad (NRIC)', mask: 'last4', pattern: '^\\d{6}-?\\d{2}-?\\d{4}$' },
      { code: 'mypr', label: 'MyPR', mask: 'last4', pattern: '^\\d{6}-?\\d{2}-?\\d{4}$' },
      { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' },
      { code: 'tin', label: 'Income tax number (TIN)', mask: 'last4', pattern: '' },
      { code: 'epf_no', label: 'EPF member number', mask: 'last4', pattern: '' }
    ],
    packs: ['my', 'my-epf', 'my-socso', 'my-hrdf'],
    bank_formats: ['my_maybank_csv', 'my_cimb_txt', 'generic_csv'],
    schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', break_min: 60 },
    employment_types: [{ code: 'full_time', name: 'Permanent full time' }, { code: 'contract', name: 'Fixed-term contract' }, { code: 'part_time', name: 'Part time' }, { code: 'foreign_worker', name: 'Foreign worker' }, { code: 'intern', name: 'Intern' }],
    leave_types: [
      { code: 'annual', name: 'Annual leave', paid: true, unit: 'day', statutory: true, days: 8, note: 'Employment Act: 8 days under 2 years of service, 12 for 2 to 5 years, 16 over 5 years (MyGOV, updated 26 May 2026).' },
      { code: 'sick', name: 'Sick leave', paid: true, unit: 'day', statutory: true, days: 14, note: '14 days under 2 years, then 18 (2 to 5 years) and 22 (over 5). The MyGOV page reads 16 for 2 to 5 years while other sources and section 60F read 18: check before use.' },
      { code: 'hospitalisation', name: 'Hospitalisation leave', paid: true, unit: 'day', statutory: true, days: 60, note: 'Up to 60 days a year (MyGOV).' },
      { code: 'maternity', name: 'Maternity leave', paid: true, unit: 'day', statutory: true, days: 98, note: '98 consecutive days for eligible employees (MyGOV).' },
      { code: 'paternity', name: 'Paternity leave', paid: true, unit: 'day', statutory: true, days: 7, note: '7 consecutive days, up to 5 births (MyGOV).' }
    ],
    min_wage: { monthly: 1700, currency: 'MYR', note: 'RM1,700 a month from 1 February 2025 (all employers from 1 August 2025); Budget 2027 proposes RM2,000 from June 2027 with an MSME exemption.' },
    holidays: myHolidays(),
    filings: [
      { code: 'my_cp39', name: 'PCB payment (e-PCB Plus)', due_rule: '15th of the following month' },
      { code: 'my_epf', name: 'EPF contribution', due_rule: '15th of the following month' },
      { code: 'my_perkeso', name: 'SOCSO, EIS and LINDUNG contributions', due_rule: '15th of the following month' },
      { code: 'my_hrdf', name: 'HRD Corp levy', due_rule: '15th of the following month' },
      { code: 'my_ea', name: 'Form EA to employees', due_rule: 'end of February' },
      { code: 'my_form_e', name: 'Form E with CP8D', due_rule: '31 March' }
    ],
    sources: [
      { title: 'Bank Muamalat, Hari Kelepasan Am 2026 (reproduction of the JPM federal and state list)', url: 'https://www.muamalat.com.my/wp-content/uploads/2025/12/Hari-Kelepasan-Am-2026.pdf', retrieved: RETRIEVED },
      { title: 'eCentral, Cuti umum 2027 (summary of the JPM 2027 list)', url: 'https://ecentral.my/cuti-2027/', retrieved: RETRIEVED },
      { title: 'MyGOV, Labour law (updated 26 May 2026)', url: 'https://www.malaysia.gov.my/en/topics/labour-law', retrieved: RETRIEVED }
    ],
    notes: 'kabinet.gov.my (the official JPM list) refused connections, so 2026 holidays come from a bank\'s reproduction of the JPM list and 2027 holidays are the federal list from a secondary summary without state holidays: check both against the JPM list. Islamic holidays may move with moon sighting. Replacement days (kind observed, per state) are generated by the rule in the JPM list note and Employment Act 1955 s 60D: a holiday on the rest day (Sunday; Friday in Kedah, Kelantan and Terengganu, whose weekend is Friday and Saturday) moves to the next working day that is not already a holiday. They are not read from the official list, so check them against it; set the work schedule of entities in Kedah, Kelantan and Terengganu to a Sunday to Thursday week. The Employment Act requires 11 paid public holidays a year, 5 of them fixed (National Day, Agong\'s Birthday, the Ruler\'s Birthday or Federal Territory Day, Labour Day, Malaysia Day).'
  };
}

// ---------------------------------------------------------------- metadata only
function meta(o) {
  return Object.assign({ regions: [], packs: [], bank_formats: ['generic_csv'], leave_types: [], holidays: [], sources: [], notes: 'Metadata only: no rule pack ships for this country. Use the generic pack with your own rates, and add public holidays to the holiday calendar.' }, o);
}

const METAS = [
  meta({ code: 'PH', name: 'Philippines', currency: 'PHP', timezone: 'Asia/Manila', date_format: 'MM/DD/YYYY', week_start: 1, weekend: [0, 6], name_order: 'given_first', id_types: [{ code: 'tin', label: 'TIN', mask: 'last3', pattern: '' }, { code: 'sss', label: 'SSS number', mask: 'last4', pattern: '' }, { code: 'philhealth', label: 'PhilHealth number', mask: 'last4', pattern: '' }, { code: 'pagibig', label: 'Pag-IBIG MID', mask: 'last4', pattern: '' }, { code: 'philsys', label: 'PhilSys number (PhilID)', mask: 'last4', pattern: '' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }] }),
  meta({ code: 'ID', name: 'Indonesia', currency: 'IDR', timezone: 'Asia/Jakarta', timezones: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'], date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'given_first', id_types: [{ code: 'nik', label: 'NIK (KTP)', mask: 'last4', pattern: '^\\d{16}$' }, { code: 'npwp', label: 'NPWP', mask: 'last4', pattern: '' }, { code: 'bpjs', label: 'BPJS number', mask: 'last4', pattern: '' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }] }),
  meta({ code: 'TH', name: 'Thailand', currency: 'THB', timezone: 'Asia/Bangkok', date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'given_first', id_types: [{ code: 'thai_id', label: 'Thai national ID', mask: 'last4', pattern: '^\\d{13}$' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }, { code: 'work_permit', label: 'Work permit', mask: 'last4', pattern: '' }] }),
  meta({ code: 'VN', name: 'Vietnam', currency: 'VND', timezone: 'Asia/Ho_Chi_Minh', date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'family_first', id_types: [{ code: 'cccd', label: 'Citizen identity card (CCCD)', mask: 'last4', pattern: '^\\d{12}$' }, { code: 'tax_code', label: 'Personal tax code', mask: 'last4', pattern: '' }, { code: 'si_number', label: 'Social insurance number', mask: 'last4', pattern: '' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }] }),
  meta({ code: 'HK', name: 'Hong Kong', currency: 'HKD', timezone: 'Asia/Hong_Kong', date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'family_first', id_types: [{ code: 'hkid', label: 'HKID', mask: 'last4', pattern: '^[A-Z]{1,2}\\d{6}\\(?[0-9A]\\)?$' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }] }),
  meta({ code: 'CN', name: 'China', currency: 'CNY', timezone: 'Asia/Shanghai', date_format: 'YYYY/MM/DD', week_start: 1, weekend: [0, 6], name_order: 'family_first', id_types: [{ code: 'resident_id', label: 'Resident identity card', mask: 'last4', pattern: '^\\d{17}[\\dX]$' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }, { code: 'foreigner_pr', label: 'Foreigner permanent resident ID card', mask: 'last4', pattern: '' }] }),
  meta({ code: 'KR', name: 'South Korea', currency: 'KRW', timezone: 'Asia/Seoul', date_format: 'YYYY.MM.DD', week_start: 1, weekend: [0, 6], name_order: 'family_first', id_types: [{ code: 'rrn', label: 'Resident registration number', mask: 'last4', pattern: '^\\d{6}-?\\d{7}$' }, { code: 'arc', label: 'Alien registration card', mask: 'last4', pattern: '^\\d{6}-?\\d{7}$' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }] }),
  meta({ code: 'TW', name: 'Taiwan', currency: 'TWD', timezone: 'Asia/Taipei', date_format: 'YYYY/MM/DD', week_start: 1, weekend: [0, 6], name_order: 'family_first', id_types: [{ code: 'national_id', label: 'National ID', mask: 'last4', pattern: '^[A-Z][12]\\d{8}$' }, { code: 'arc', label: 'Resident certificate (ARC)', mask: 'last4', pattern: '' }, { code: 'passport', label: 'Passport', mask: 'last3', pattern: '' }] })
];

export function build() {
  const files = [
    writeModule('data/countries/jp.js', 'Country data: Japan.', jp()),
    writeModule('data/countries/sg.js', 'Country data: Singapore.', sg()),
    writeModule('data/countries/in.js', 'Country data: India.', india()),
    writeModule('data/countries/my.js', 'Country data: Malaysia.', my())
  ];
  for (const m of METAS) files.push(writeModule('data/countries/' + m.code.toLowerCase() + '.js', 'Country data (metadata only): ' + m.name + '.', m));
  return files;
}
