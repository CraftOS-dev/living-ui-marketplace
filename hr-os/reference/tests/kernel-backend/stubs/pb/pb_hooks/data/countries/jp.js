// SCRATCH STUB (kernel-backend tests only; the packs builders ship the real file).
module.exports = {
  code: 'JP', name: 'Japan', currency: 'JPY', timezone: 'Asia/Tokyo', date_format: 'YYYY/MM/DD', week_start: 1, weekend: [0, 6], name_order: 'family_first', fiscal_year_start: '04-01',
  regions: [{ code: '13', name: 'Tokyo' }, { code: '27', name: 'Osaka' }],
  packs: ['jp'], bank_formats: ['zengin'],
  id_types: [{ code: 'my_number', label: 'My Number', mask: 'last4', pattern: '^\\d{12}$' }],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', break_min: 60 },
  employment_types: [{ code: 'full_time', name: 'Full time (regular)' }, { code: 'part_time', name: 'Part time' }, { code: 'contract', name: 'Contract (fixed term)' }],
  holidays: [
    { day: '2026-01-01', name: "New Year's Day", region: '', kind: 'public' },
    { day: '2026-01-12', name: 'Coming of Age Day', region: '', kind: 'public' },
    { day: '2026-04-29', name: 'Showa Day', region: '', kind: 'public' },
    { day: '2026-05-03', name: 'Constitution Memorial Day', region: '', kind: 'public' },
    { day: '2026-05-04', name: 'Greenery Day', region: '', kind: 'public' },
    { day: '2026-05-05', name: "Children's Day", region: '', kind: 'public' },
    { day: '2026-05-06', name: 'Substitute holiday', region: '', kind: 'observed' },
    { day: '2026-11-23', name: 'Labour Thanksgiving Day', region: '', kind: 'public' },
    { day: '2027-01-01', name: "New Year's Day", region: '', kind: 'public' },
  ],
};
