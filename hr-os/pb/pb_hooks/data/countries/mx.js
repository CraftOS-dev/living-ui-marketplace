// Mexico country data for HR OS (packs-west).

module.exports = {
  code: 'MX',
  name: 'Mexico',
  currency: 'MXN',
  timezone: 'America/Mexico_City',
  timezones: [
    'America/Mexico_City',
    'America/Cancun',
    'America/Monterrey',
    'America/Chihuahua',
    'America/Hermosillo',
    'America/Tijuana'
  ],
  date_format: 'DD/MM/YYYY',
  week_start: 1,
  weekend: [0, 6],
  name_order: 'given_first',
  id_types: [
    { code: 'curp', label: 'CURP', mask: 'last3', pattern: '^[A-Z0-9]{18}$' },
    { code: 'rfc', label: 'RFC', mask: 'last3', pattern: '^[A-Z&]{3,4}\\d{6}[A-Z0-9]{3}$' },
    { code: 'nss', label: 'Numero de Seguridad Social (IMSS)', mask: 'last3', pattern: '^\\d{11}$' }
  ],
  packs: ['generic'],
  bank_formats: ['generic_csv'],
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
  notes: 'Metadata only: no built-in payroll pack (the generic pack is enabled, with rates a person sets), no statutory leave minimums and no public holidays (add them as company holidays). ISR, IMSS, INFONAVIT and CFDI nomina are not built in.'
};
