// Canada country data for HR OS (packs-west).

module.exports = {
  code: 'CA',
  name: 'Canada',
  currency: 'CAD',
  timezone: 'America/Toronto',
  timezones: [
    'America/St_Johns',
    'America/Halifax',
    'America/Toronto',
    'America/Winnipeg',
    'America/Regina',
    'America/Edmonton',
    'America/Vancouver',
    'America/Whitehorse'
  ],
  date_format: 'YYYY-MM-DD',
  week_start: 0,
  weekend: [0, 6],
  name_order: 'given_first',
  regions: [
    { code: 'AB', name: 'Alberta' },
    { code: 'BC', name: 'British Columbia' },
    { code: 'MB', name: 'Manitoba' },
    { code: 'NB', name: 'New Brunswick' },
    { code: 'NL', name: 'Newfoundland and Labrador' },
    { code: 'NS', name: 'Nova Scotia' },
    { code: 'NT', name: 'Northwest Territories' },
    { code: 'NU', name: 'Nunavut' },
    { code: 'ON', name: 'Ontario' },
    { code: 'PE', name: 'Prince Edward Island' },
    { code: 'QC', name: 'Quebec' },
    { code: 'SK', name: 'Saskatchewan' },
    { code: 'YT', name: 'Yukon' }
  ],
  id_types: [{ code: 'sin', label: 'Social Insurance Number', mask: 'last3', pattern: '^\\d{9}$' }],
  packs: ['ca-federal'],
  region_packs: {
    ON: ['ca-on'],
    AB: ['ca-ab'],
    BC: ['ca-bc']
  },
  bank_formats: ['generic_csv'],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', break_min: 60 },
  employment_types: [
    { code: 'full_time', name: 'Full time' },
    { code: 'part_time', name: 'Part time' },
    { code: 'temporary', name: 'Temporary' },
    { code: 'seasonal', name: 'Seasonal' }
  ],
  leave_types: [
    {
      code: 'vacation_on',
      name: 'Vacation (Ontario)',
      paid: true,
      unit: 'day',
      statutory: true,
      days: 10,
      region: 'ON',
      note: 'Ontario ESA: two weeks after each vacation entitlement year with less than five years of employment, three weeks with five or more; vacation pay at least 4% (6% after five years).'
    }
  ],
  holidays: [
    { day: '2026-01-01', name: 'New Year\'s Day', region: '', kind: 'public' },
    { day: '2026-02-16', name: 'Family Day', region: 'ON', kind: 'public' },
    { day: '2026-04-03', name: 'Good Friday', region: '', kind: 'public' },
    { day: '2026-04-06', name: 'Easter Monday', region: '', kind: 'optional' },
    { day: '2026-05-18', name: 'Victoria Day', region: '', kind: 'public' },
    { day: '2026-06-24', name: 'Saint-Jean-Baptiste Day', region: 'QC', kind: 'public' },
    { day: '2026-07-01', name: 'Canada Day', region: '', kind: 'public' },
    { day: '2026-08-03', name: 'Civic Holiday', region: '', kind: 'optional' },
    { day: '2026-09-07', name: 'Labour Day', region: '', kind: 'public' },
    { day: '2026-09-30', name: 'National Day for Truth and Reconciliation', region: '', kind: 'optional' },
    { day: '2026-10-12', name: 'Thanksgiving Day', region: '', kind: 'public' },
    { day: '2026-11-11', name: 'Remembrance Day', region: '', kind: 'optional' },
    { day: '2026-12-25', name: 'Christmas Day', region: '', kind: 'public' },
    { day: '2026-12-26', name: 'Boxing Day', region: '', kind: 'public' },
    { day: '2026-12-28', name: 'Boxing Day (substitute day)', region: '', kind: 'observed' },
    { day: '2027-01-01', name: 'New Year\'s Day', region: '', kind: 'public' },
    { day: '2027-02-15', name: 'Family Day', region: 'ON', kind: 'public' },
    { day: '2027-03-26', name: 'Good Friday', region: '', kind: 'public' },
    { day: '2027-03-29', name: 'Easter Monday', region: '', kind: 'optional' },
    { day: '2027-05-24', name: 'Victoria Day', region: '', kind: 'public' },
    { day: '2027-06-24', name: 'Saint-Jean-Baptiste Day', region: 'QC', kind: 'public' },
    { day: '2027-07-01', name: 'Canada Day', region: '', kind: 'public' },
    { day: '2027-08-02', name: 'Civic Holiday', region: '', kind: 'optional' },
    { day: '2027-09-06', name: 'Labour Day', region: '', kind: 'public' },
    { day: '2027-09-30', name: 'National Day for Truth and Reconciliation', region: '', kind: 'optional' },
    { day: '2027-10-11', name: 'Thanksgiving Day', region: '', kind: 'public' },
    { day: '2027-11-11', name: 'Remembrance Day', region: '', kind: 'optional' },
    { day: '2027-12-25', name: 'Christmas Day', region: '', kind: 'public' },
    { day: '2027-12-26', name: 'Boxing Day', region: '', kind: 'public' },
    { day: '2027-12-27', name: 'Christmas Day (substitute day)', region: '', kind: 'observed' },
    { day: '2027-12-28', name: 'Boxing Day (substitute day)', region: '', kind: 'observed' }
  ],
  filings: [
    { code: 'ca_t4', name: 'T4 slips and summary', frequency: 'annual', due: 'last day of February' },
    {
      code: 'ca_roe',
      name: 'Record of Employment',
      frequency: 'event',
      due: 'after an interruption of earnings'
    },
    {
      code: 'ca_pd7a',
      name: 'Source deductions remittance (PD7A)',
      frequency: 'by_remitter_type',
      due: 'by the CRA remitting schedule'
    }
  ],
  sources: [
    {
      title: 'Canada Revenue Agency, Public holidays for 2026',
      url: 'https://www.canada.ca/en/revenue-agency/services/tax/public-holidays.html',
      retrieved: '2026-11-04'
    },
    {
      title: 'Ontario, Your guide to the Employment Standards Act: public holidays and vacation',
      url: 'https://www.ontario.ca/document/your-guide-employment-standards-act-0/vacation',
      retrieved: '2026-11-04'
    }
  ],
  notes: 'Payroll packs: ca-federal (federal income tax, CPP, CPP2, EI from CRA T4127, 2026) for every Canadian entity, plus ca-on, ca-ab and ca-bc for Ontario, Alberta and British Columbia. Employees whose province of employment is another province are blocked by ca-federal (Manitoba, Saskatchewan, the Atlantic provinces and the territories are next); Quebec (QPP, QPIP and Revenu Quebec withholding) is not built and is blocked. The province of employment is the work region of the employment, else the region of the entity. Holidays: the CRA 2026 list, with 2027 placed by the same rules (Victoria Day the Monday before 25 May, Civic Holiday first Monday of August, Labour Day first Monday of September, Thanksgiving second Monday of October); Easter Monday, Civic Holiday, National Day for Truth and Reconciliation and Remembrance Day are kind optional because they are not Ontario ESA public holidays (federally regulated employers observe the Canada Labour Code list); Saint-Jean-Baptiste Day is tagged QC and Family Day ON. When New Year\'s Day, Canada Day, Christmas Day or Boxing Day falls on a weekend, the next working day is listed as kind observed (Boxing Day 2026: Monday 28 December; Christmas and Boxing Day 2027: Monday 27 and Tuesday 28 December), which is the usual substitute; Ontario\'s ESA lets the employer choose another substitute day off or pay public holiday pay instead, and the Canada Labour Code gives the holiday on another day, so edit the calendar if the company uses a different day. Filing due dates are the usual CRA and Service Canada rules and were not re-read in this session. Bank files: Canadian Payments Association Standard 005 (CPA 005) is the bank format; this app exports the generic CSV until a CPA 005 exporter exists.'
};
