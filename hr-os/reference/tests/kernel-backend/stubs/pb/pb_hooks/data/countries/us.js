// SCRATCH STUB (kernel-backend tests only; the packs builders ship the real file).
module.exports = {
  code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York', timezones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'], date_format: 'MM/DD/YYYY', week_start: 0, weekend: [0, 6], name_order: 'given_first',
  regions: [{ code: 'CA', name: 'California' }, { code: 'NY', name: 'New York' }, { code: 'TX', name: 'Texas' }],
  packs: ['us-federal'], region_packs: { CA: ['us-ca'], NY: ['us-ny'] }, bank_formats: ['nacha_ppd'],
  id_types: [{ code: 'ssn', label: 'Social Security number', mask: 'last4', pattern: '^\\d{9}$' }],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30', break_min: 30 },
  holidays: [
    { day: '2026-01-01', name: "New Year's Day", region: '', kind: 'public' },
    { day: '2026-05-25', name: 'Memorial Day', region: '', kind: 'public' },
    { day: '2026-07-03', name: 'Independence Day (observed)', region: '', kind: 'observed' },
    { day: '2026-09-07', name: 'Labor Day', region: '', kind: 'public' },
    { day: '2026-11-26', name: 'Thanksgiving Day', region: '', kind: 'public' },
    { day: '2026-12-25', name: 'Christmas Day', region: '', kind: 'public' },
    { day: '2026-03-31', name: 'Cesar Chavez Day', region: 'CA', kind: 'public' },
    { day: '2027-01-01', name: "New Year's Day", region: '', kind: 'public' },
  ],
};
