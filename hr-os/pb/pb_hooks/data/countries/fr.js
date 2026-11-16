// France country data for HR OS (packs-west).

module.exports = {
  code: 'FR',
  name: 'France',
  currency: 'EUR',
  timezone: 'Europe/Paris',
  date_format: 'DD/MM/YYYY',
  week_start: 1,
  weekend: [0, 6],
  name_order: 'given_first',
  id_types: [{ code: 'nir', label: 'Numero de securite sociale (NIR)', mask: 'last3', pattern: '' }],
  packs: ['generic'],
  bank_formats: ['sepa_pain001'],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', break_min: 60 },
  holidays: [],
  sources: [
    {
      title: 'ISO 4217 currency and IANA time zone database identifiers; national identifier formats',
      url: 'https://www.iso.org/iso-4217-currency-codes.html',
      retrieved: '2026-11-04',
      note: 'Metadata only; no statutory rates, leave minimums or holidays were researched.'
    }
  ],
  notes: 'Metadata only: no built-in payroll pack (the generic pack is enabled, with rates a person sets), no statutory leave minimums and no public holidays (add them as company holidays). Prelevement a la source and DSN are not built in.'
};
