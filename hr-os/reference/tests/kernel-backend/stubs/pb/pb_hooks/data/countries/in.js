// SCRATCH STUB (kernel-backend tests only; the packs builders ship the real file).
module.exports = {
  code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', date_format: 'DD/MM/YYYY', week_start: 1, weekend: [0], name_order: 'given_first', fiscal_year_start: '04-01',
  regions: [{ code: 'MH', name: 'Maharashtra' }, { code: 'KA', name: 'Karnataka' }],
  packs: ['in'], region_packs: { MH: ['in-pt-mh'], KA: ['in-pt-ka'] }, bank_formats: ['in_neft_csv'],
  id_types: [{ code: 'pan', label: 'PAN', mask: 'last4', pattern: '^[A-Z]{5}\\d{4}[A-Z]$' }, { code: 'aadhaar', label: 'Aadhaar', mask: 'last4', pattern: '^\\d{12}$' }],
  schedule: { days: [1, 2, 3, 4, 5, 6], start: '09:30', end: '18:30', break_min: 60 },
  holidays: [
    { day: '2026-01-26', name: 'Republic Day', region: '', kind: 'public' },
    { day: '2026-08-15', name: 'Independence Day', region: '', kind: 'public' },
    { day: '2026-10-02', name: 'Gandhi Jayanti', region: '', kind: 'public' },
    { day: '2026-05-01', name: 'Maharashtra Day', region: 'MH', kind: 'public' },
    { day: '2027-01-26', name: 'Republic Day', region: '', kind: 'public' },
  ],
};
