// SCRATCH STUB (kernel-backend tests only; the packs builders ship the real file).
module.exports = {
  code: 'SG', name: 'Singapore', currency: 'SGD', timezone: 'Asia/Singapore', date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0, 6], name_order: 'given_first',
  regions: [], packs: ['sg'], bank_formats: ['sg_giro_csv'],
  id_types: [{ code: 'nric', label: 'NRIC / FIN', mask: 'last4', pattern: '^[STFGM]\\d{7}[A-Z]$' }],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', break_min: 60 },
  leave_types: [{ code: 'annual', name: 'Annual leave', paid: true, unit: 'day', statutory: true, days: 7 }],
  holidays: [
    { day: '2026-01-01', name: "New Year's Day", region: '', kind: 'public' },
    { day: '2026-02-17', name: 'Chinese New Year', region: '', kind: 'public' },
    { day: '2026-02-18', name: 'Chinese New Year (day 2)', region: '', kind: 'public' },
    { day: '2026-04-03', name: 'Good Friday', region: '', kind: 'public' },
    { day: '2026-05-01', name: 'Labour Day', region: '', kind: 'public' },
    { day: '2026-08-09', name: 'National Day', region: '', kind: 'public' },
    { day: '2026-08-10', name: 'National Day (observed)', region: '', kind: 'observed' },
    { day: '2026-12-25', name: 'Christmas Day', region: '', kind: 'public' },
    { day: '2027-01-01', name: "New Year's Day", region: '', kind: 'public' },
    { day: '2027-12-25', name: 'Christmas Day', region: '', kind: 'public' },
  ],
};
