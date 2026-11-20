// United States country data for HR OS (packs-west).

module.exports = {
  code: 'US',
  name: 'United States',
  currency: 'USD',
  timezone: 'America/New_York',
  timezones: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu'
  ],
  date_format: 'MM/DD/YYYY',
  week_start: 0,
  weekend: [0, 6],
  name_order: 'given_first',
  regions: [
    { code: 'AL', name: 'Alabama' },
    { code: 'AK', name: 'Alaska' },
    { code: 'AZ', name: 'Arizona' },
    { code: 'AR', name: 'Arkansas' },
    { code: 'CA', name: 'California' },
    { code: 'CO', name: 'Colorado' },
    { code: 'CT', name: 'Connecticut' },
    { code: 'DE', name: 'Delaware' },
    { code: 'DC', name: 'District of Columbia' },
    { code: 'FL', name: 'Florida' },
    { code: 'GA', name: 'Georgia' },
    { code: 'HI', name: 'Hawaii' },
    { code: 'ID', name: 'Idaho' },
    { code: 'IL', name: 'Illinois' },
    { code: 'IN', name: 'Indiana' },
    { code: 'IA', name: 'Iowa' },
    { code: 'KS', name: 'Kansas' },
    { code: 'KY', name: 'Kentucky' },
    { code: 'LA', name: 'Louisiana' },
    { code: 'ME', name: 'Maine' },
    { code: 'MD', name: 'Maryland' },
    { code: 'MA', name: 'Massachusetts' },
    { code: 'MI', name: 'Michigan' },
    { code: 'MN', name: 'Minnesota' },
    { code: 'MS', name: 'Mississippi' },
    { code: 'MO', name: 'Missouri' },
    { code: 'MT', name: 'Montana' },
    { code: 'NE', name: 'Nebraska' },
    { code: 'NV', name: 'Nevada' },
    { code: 'NH', name: 'New Hampshire' },
    { code: 'NJ', name: 'New Jersey' },
    { code: 'NM', name: 'New Mexico' },
    { code: 'NY', name: 'New York' },
    { code: 'NC', name: 'North Carolina' },
    { code: 'ND', name: 'North Dakota' },
    { code: 'OH', name: 'Ohio' },
    { code: 'OK', name: 'Oklahoma' },
    { code: 'OR', name: 'Oregon' },
    { code: 'PA', name: 'Pennsylvania' },
    { code: 'RI', name: 'Rhode Island' },
    { code: 'SC', name: 'South Carolina' },
    { code: 'SD', name: 'South Dakota' },
    { code: 'TN', name: 'Tennessee' },
    { code: 'TX', name: 'Texas' },
    { code: 'UT', name: 'Utah' },
    { code: 'VT', name: 'Vermont' },
    { code: 'VA', name: 'Virginia' },
    { code: 'WA', name: 'Washington' },
    { code: 'WV', name: 'West Virginia' },
    { code: 'WI', name: 'Wisconsin' },
    { code: 'WY', name: 'Wyoming' }
  ],
  id_types: [
    { code: 'ssn', label: 'Social Security number', mask: 'last4', pattern: '^\\d{9}$' },
    { code: 'itin', label: 'Individual Taxpayer Identification Number', mask: 'last4', pattern: '^9\\d{8}$' }
  ],
  packs: ['us-federal'],
  region_packs: {
    CA: ['us-ca'],
    NY: ['us-ny'],
    NJ: ['us-nj'],
    IL: ['us-il'],
    PA: ['us-pa'],
    NC: ['us-nc'],
    CO: ['us-co'],
    AZ: ['us-az'],
    GA: ['us-ga'],
    OH: ['us-oh'],
    VA: ['us-va'],
    MA: ['us-ma'],
    MI: ['us-mi'],
    AK: ['us-no-income-tax'],
    FL: ['us-no-income-tax'],
    NV: ['us-no-income-tax'],
    NH: ['us-no-income-tax'],
    SD: ['us-no-income-tax'],
    TN: ['us-no-income-tax'],
    TX: ['us-no-income-tax'],
    WA: ['us-no-income-tax'],
    WY: ['us-no-income-tax']
  },
  bank_formats: ['nacha_ppd', 'generic_csv'],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30', break_min: 30 },
  employment_types: [
    { code: 'full_time', name: 'Full time' },
    { code: 'part_time', name: 'Part time' },
    { code: 'temporary', name: 'Temporary' },
    { code: 'seasonal', name: 'Seasonal' },
    { code: 'intern', name: 'Intern' }
  ],
  leave_types: [
    {
      code: 'fmla',
      name: 'Family and medical leave (FMLA)',
      paid: false,
      unit: 'day',
      statutory: true,
      days: 60,
      note: 'Up to 12 workweeks of job-protected unpaid leave in 12 months for eligible employees of covered employers (26 workweeks of military caregiver leave). Days assume a five-day week.'
    },
    {
      code: 'pto',
      name: 'Paid time off',
      paid: true,
      unit: 'day',
      statutory: false,
      days: 0,
      note: 'No federal paid vacation or sick leave mandate; many states and cities require paid sick leave. Set by company policy.'
    }
  ],
  min_wage: {
    hourly: 7.25,
    monthly: 0,
    currency: 'USD',
    note: 'Federal FLSA minimum; the higher state or local minimum applies.'
  },
  holidays: [
    { day: '2026-01-01', name: 'New Year\'s Day', region: '', kind: 'public' },
    { day: '2026-01-19', name: 'Birthday of Martin Luther King, Jr.', region: '', kind: 'public' },
    { day: '2026-02-16', name: 'Washington\'s Birthday', region: '', kind: 'public' },
    { day: '2026-05-25', name: 'Memorial Day', region: '', kind: 'public' },
    { day: '2026-06-19', name: 'Juneteenth National Independence Day', region: '', kind: 'public' },
    { day: '2026-07-03', name: 'Independence Day (observed)', region: '', kind: 'observed' },
    { day: '2026-07-04', name: 'Independence Day', region: '', kind: 'public' },
    { day: '2026-09-07', name: 'Labor Day', region: '', kind: 'public' },
    { day: '2026-10-12', name: 'Columbus Day', region: '', kind: 'public' },
    { day: '2026-11-11', name: 'Veterans Day', region: '', kind: 'public' },
    { day: '2026-11-26', name: 'Thanksgiving Day', region: '', kind: 'public' },
    { day: '2026-12-25', name: 'Christmas Day', region: '', kind: 'public' },
    { day: '2027-01-01', name: 'New Year\'s Day', region: '', kind: 'public' },
    { day: '2027-01-18', name: 'Birthday of Martin Luther King, Jr.', region: '', kind: 'public' },
    { day: '2027-02-15', name: 'Washington\'s Birthday', region: '', kind: 'public' },
    { day: '2027-05-31', name: 'Memorial Day', region: '', kind: 'public' },
    { day: '2027-06-18', name: 'Juneteenth National Independence Day (observed)', region: '', kind: 'observed' },
    { day: '2027-06-19', name: 'Juneteenth National Independence Day', region: '', kind: 'public' },
    { day: '2027-07-04', name: 'Independence Day', region: '', kind: 'public' },
    { day: '2027-07-05', name: 'Independence Day (observed)', region: '', kind: 'observed' },
    { day: '2027-09-06', name: 'Labor Day', region: '', kind: 'public' },
    { day: '2027-10-11', name: 'Columbus Day', region: '', kind: 'public' },
    { day: '2027-11-11', name: 'Veterans Day', region: '', kind: 'public' },
    { day: '2027-11-25', name: 'Thanksgiving Day', region: '', kind: 'public' },
    { day: '2027-12-24', name: 'Christmas Day (observed)', region: '', kind: 'observed' },
    { day: '2027-12-25', name: 'Christmas Day', region: '', kind: 'public' },
    { day: '2027-12-31', name: 'New Year\'s Day 2028 (observed)', region: '', kind: 'observed' }
  ],
  filings: [
    {
      code: 'us_941',
      name: 'Form 941 quarterly federal tax return',
      frequency: 'quarterly',
      due: 'April 30, July 31, October 31, January 31'
    },
    {
      code: 'us_940',
      name: 'Form 940 annual FUTA return',
      frequency: 'annual',
      due: 'January 31 (February 10 if deposits were on time)'
    },
    { code: 'us_w2', name: 'Forms W-2 and W-3', frequency: 'annual', due: 'January 31' },
    {
      code: 'us_state_quarterly',
      name: 'State withholding and unemployment quarterly returns',
      frequency: 'quarterly',
      due: 'by state, usually the last day of the month after the quarter'
    }
  ],
  sources: [
    {
      title: '5 U.S.C. 6103, legal public holidays (Cornell LII)',
      url: 'https://www.law.cornell.edu/uscode/text/5/6103',
      retrieved: '2026-11-04',
      note: 'opm.gov answered 403 to automated fetches; Publication 15 (2026) section 11 lists the same 2026 legal holidays.'
    },
    {
      title: 'IRS Publication 15 (2026), section 11 legal holidays for 2026',
      url: 'https://www.irs.gov/pub/irs-pdf/p15.pdf',
      retrieved: '2026-11-04'
    },
    {
      title: 'US Department of Labor, Family and Medical Leave Act',
      url: 'https://www.dol.gov/agencies/whd/fmla',
      retrieved: '2026-11-04'
    }
  ],
  notes: 'Holidays are the 11 federal legal public holidays with the Saturday to Friday and Sunday to Monday observed days (private employers choose their own holidays; District of Columbia Emancipation Day on April 16 is not included). No federal statutory paid leave. Region packs: state income tax packs for CA, NY, NJ, IL, PA, NC, CO, AZ, GA, OH, VA, MA and MI (draft), and the no-income-tax pack for AK, FL, NV, NH, SD, TN, TX, WA and WY. The other 28 states and DC have no pack yet. NACHA PPD for direct deposit.'
};
