// United Kingdom country data for HR OS (packs-west).

module.exports = {
  code: 'GB',
  name: 'United Kingdom',
  currency: 'GBP',
  timezone: 'Europe/London',
  date_format: 'DD/MM/YYYY',
  week_start: 1,
  weekend: [0, 6],
  name_order: 'given_first',
  regions: [
    { code: 'ENG', name: 'England' },
    { code: 'SCT', name: 'Scotland' },
    { code: 'WLS', name: 'Wales' },
    { code: 'NIR', name: 'Northern Ireland' }
  ],
  id_types: [
    {
      code: 'nino',
      label: 'National Insurance number',
      mask: 'last3',
      pattern: '^[A-CEGHJ-PR-TW-Z]{2}\\d{6}[A-D]$'
    }
  ],
  packs: ['gb'],
  bank_formats: ['bacs_csv', 'generic_csv'],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30', break_min: 60 },
  employment_types: [
    { code: 'full_time', name: 'Full time' },
    { code: 'part_time', name: 'Part time' },
    { code: 'fixed_term', name: 'Fixed term' },
    { code: 'zero_hours', name: 'Zero hours' },
    { code: 'apprentice', name: 'Apprentice' }
  ],
  leave_types: [
    {
      code: 'annual',
      name: 'Annual leave',
      paid: true,
      unit: 'day',
      statutory: true,
      days: 28,
      note: '5.6 weeks a year (28 days for a five-day week, pro rata for part time); bank holidays may count toward it.'
    },
    {
      code: 'sick',
      name: 'Sick leave (SSP)',
      paid: true,
      unit: 'day',
      statutory: true,
      days: 0,
      note: 'Statutory Sick Pay from the first day of illness in 2026 to 2027: the lower of £123.25 a week or 80% of average weekly earnings.'
    }
  ],
  min_wage: {
    hourly: 12.71,
    monthly: 0,
    currency: 'GBP',
    note: 'National Living Wage (21 and over) from 1 April 2026; 18 to 20: £10.85; under 18 and apprentices: £8.00.'
  },
  holidays: [
    { day: '2026-01-01', name: 'New Year\'s Day', region: 'ENG', kind: 'public' },
    { day: '2026-01-01', name: 'New Year\'s Day', region: 'NIR', kind: 'public' },
    { day: '2026-01-01', name: 'New Year\'s Day', region: 'SCT', kind: 'public' },
    { day: '2026-01-01', name: 'New Year\'s Day', region: 'WLS', kind: 'public' },
    { day: '2026-01-02', name: '2nd January', region: 'SCT', kind: 'public' },
    { day: '2026-03-17', name: 'St Patrick\'s Day', region: 'NIR', kind: 'public' },
    { day: '2026-04-03', name: 'Good Friday', region: 'ENG', kind: 'public' },
    { day: '2026-04-03', name: 'Good Friday', region: 'NIR', kind: 'public' },
    { day: '2026-04-03', name: 'Good Friday', region: 'SCT', kind: 'public' },
    { day: '2026-04-03', name: 'Good Friday', region: 'WLS', kind: 'public' },
    { day: '2026-04-06', name: 'Easter Monday', region: 'ENG', kind: 'public' },
    { day: '2026-04-06', name: 'Easter Monday', region: 'NIR', kind: 'public' },
    { day: '2026-04-06', name: 'Easter Monday', region: 'WLS', kind: 'public' },
    { day: '2026-05-04', name: 'Early May bank holiday', region: 'ENG', kind: 'public' },
    { day: '2026-05-04', name: 'Early May bank holiday', region: 'NIR', kind: 'public' },
    { day: '2026-05-04', name: 'Early May bank holiday', region: 'SCT', kind: 'public' },
    { day: '2026-05-04', name: 'Early May bank holiday', region: 'WLS', kind: 'public' },
    { day: '2026-05-25', name: 'Spring bank holiday', region: 'ENG', kind: 'public' },
    { day: '2026-05-25', name: 'Spring bank holiday', region: 'NIR', kind: 'public' },
    { day: '2026-05-25', name: 'Spring bank holiday', region: 'SCT', kind: 'public' },
    { day: '2026-05-25', name: 'Spring bank holiday', region: 'WLS', kind: 'public' },
    { day: '2026-06-15', name: 'World Cup bank holiday', region: 'SCT', kind: 'public' },
    {
      day: '2026-07-13',
      name: 'Battle of the Boyne (Orangemen\'s Day) (substitute day)',
      region: 'NIR',
      kind: 'observed'
    },
    { day: '2026-08-03', name: 'Summer bank holiday', region: 'SCT', kind: 'public' },
    { day: '2026-08-31', name: 'Summer bank holiday', region: 'ENG', kind: 'public' },
    { day: '2026-08-31', name: 'Summer bank holiday', region: 'NIR', kind: 'public' },
    { day: '2026-08-31', name: 'Summer bank holiday', region: 'WLS', kind: 'public' },
    { day: '2026-11-30', name: 'St Andrew\'s Day', region: 'SCT', kind: 'public' },
    { day: '2026-12-25', name: 'Christmas Day', region: 'ENG', kind: 'public' },
    { day: '2026-12-25', name: 'Christmas Day', region: 'NIR', kind: 'public' },
    { day: '2026-12-25', name: 'Christmas Day', region: 'SCT', kind: 'public' },
    { day: '2026-12-25', name: 'Christmas Day', region: 'WLS', kind: 'public' },
    { day: '2026-12-28', name: 'Boxing Day (substitute day)', region: 'ENG', kind: 'observed' },
    { day: '2026-12-28', name: 'Boxing Day (substitute day)', region: 'NIR', kind: 'observed' },
    { day: '2026-12-28', name: 'Boxing Day (substitute day)', region: 'SCT', kind: 'observed' },
    { day: '2026-12-28', name: 'Boxing Day (substitute day)', region: 'WLS', kind: 'observed' },
    { day: '2027-01-01', name: 'New Year\'s Day', region: 'ENG', kind: 'public' },
    { day: '2027-01-01', name: 'New Year\'s Day', region: 'NIR', kind: 'public' },
    { day: '2027-01-01', name: 'New Year\'s Day', region: 'SCT', kind: 'public' },
    { day: '2027-01-01', name: 'New Year\'s Day', region: 'WLS', kind: 'public' },
    { day: '2027-01-04', name: '2nd January (substitute day)', region: 'SCT', kind: 'observed' },
    { day: '2027-03-17', name: 'St Patrick\'s Day', region: 'NIR', kind: 'public' },
    { day: '2027-03-26', name: 'Good Friday', region: 'ENG', kind: 'public' },
    { day: '2027-03-26', name: 'Good Friday', region: 'NIR', kind: 'public' },
    { day: '2027-03-26', name: 'Good Friday', region: 'SCT', kind: 'public' },
    { day: '2027-03-26', name: 'Good Friday', region: 'WLS', kind: 'public' },
    { day: '2027-03-29', name: 'Easter Monday', region: 'ENG', kind: 'public' },
    { day: '2027-03-29', name: 'Easter Monday', region: 'NIR', kind: 'public' },
    { day: '2027-03-29', name: 'Easter Monday', region: 'WLS', kind: 'public' },
    { day: '2027-05-03', name: 'Early May bank holiday', region: 'ENG', kind: 'public' },
    { day: '2027-05-03', name: 'Early May bank holiday', region: 'NIR', kind: 'public' },
    { day: '2027-05-03', name: 'Early May bank holiday', region: 'SCT', kind: 'public' },
    { day: '2027-05-03', name: 'Early May bank holiday', region: 'WLS', kind: 'public' },
    { day: '2027-05-31', name: 'Spring bank holiday', region: 'ENG', kind: 'public' },
    { day: '2027-05-31', name: 'Spring bank holiday', region: 'NIR', kind: 'public' },
    { day: '2027-05-31', name: 'Spring bank holiday', region: 'SCT', kind: 'public' },
    { day: '2027-05-31', name: 'Spring bank holiday', region: 'WLS', kind: 'public' },
    { day: '2027-07-12', name: 'Battle of the Boyne (Orangemen\'s Day)', region: 'NIR', kind: 'public' },
    { day: '2027-08-02', name: 'Summer bank holiday', region: 'SCT', kind: 'public' },
    { day: '2027-08-30', name: 'Summer bank holiday', region: 'ENG', kind: 'public' },
    { day: '2027-08-30', name: 'Summer bank holiday', region: 'NIR', kind: 'public' },
    { day: '2027-08-30', name: 'Summer bank holiday', region: 'WLS', kind: 'public' },
    { day: '2027-11-30', name: 'St Andrew\'s Day', region: 'SCT', kind: 'public' },
    { day: '2027-12-27', name: 'Christmas Day (substitute day)', region: 'ENG', kind: 'observed' },
    { day: '2027-12-27', name: 'Christmas Day (substitute day)', region: 'NIR', kind: 'observed' },
    { day: '2027-12-27', name: 'Christmas Day (substitute day)', region: 'SCT', kind: 'observed' },
    { day: '2027-12-27', name: 'Christmas Day (substitute day)', region: 'WLS', kind: 'observed' },
    { day: '2027-12-28', name: 'Boxing Day (substitute day)', region: 'ENG', kind: 'observed' },
    { day: '2027-12-28', name: 'Boxing Day (substitute day)', region: 'NIR', kind: 'observed' },
    { day: '2027-12-28', name: 'Boxing Day (substitute day)', region: 'SCT', kind: 'observed' },
    { day: '2027-12-28', name: 'Boxing Day (substitute day)', region: 'WLS', kind: 'observed' }
  ],
  filings: [
    {
      code: 'gb_fps',
      name: 'RTI Full Payment Submission',
      frequency: 'per_pay_date',
      due: 'on or before each pay date'
    },
    {
      code: 'gb_eps',
      name: 'RTI Employer Payment Summary',
      frequency: 'monthly',
      due: '19th after the tax month'
    },
    { code: 'gb_p60', name: 'P60', frequency: 'annual', due: '31 May' },
    { code: 'gb_p11d', name: 'P11D and P11D(b)', frequency: 'annual', due: '6 July' }
  ],
  sources: [
    {
      title: 'GOV.UK bank holidays feed (England and Wales, Scotland, Northern Ireland)',
      url: 'https://www.gov.uk/bank-holidays.json',
      retrieved: '2026-11-04'
    },
    {
      title: 'GOV.UK Holiday entitlement',
      url: 'https://www.gov.uk/holiday-entitlement-rights',
      retrieved: '2026-11-04'
    },
    {
      title: 'HMRC Rates and thresholds for employers 2026 to 2027 (National Minimum Wage, SSP)',
      url: 'https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027',
      retrieved: '2026-11-04'
    }
  ],
  notes: 'Holidays by nation: England and Wales rows are tagged ENG and WLS, Scotland SCT (including the 2026 World Cup bank holiday on 15 June), Northern Ireland NIR; substitute days are kind observed. Bacs payments through a bureau or bank file (a documented simple CSV); Faster Payments by bank upload.'
};
