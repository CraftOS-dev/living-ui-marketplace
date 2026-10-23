/// <reference path="../pb_data/types.d.ts" />
/**
 * Region presets: the starting tax setup for a shop in each country. A
 * preset fills the settings and the tax classes once, at setup; afterwards
 * every value is the shop's own and is edited in Settings.
 *
 * Rates are basis points. `dine_in_rate_bp` is the rate when the order is
 * eaten in, for countries where that changes it (Japan's reduced 8% for
 * food to take away becomes 10% eaten in); -1 keeps the same rate.
 * `cash_rounding` is the smallest coin, in minor units, that cash totals
 * round to (Malaysia 5 sen, Australia 5 cents, New Zealand 10 cents).
 */

const PRESETS = {
  MY: {
    label: 'Malaysia',
    currency: 'MYR',
    price_mode: 'exclusive',
    tax_rounding: 'half_up',
    cash_rounding: 5,
    tax_reg_label: 'SST No.',
    order_types: ['dine_in', 'takeaway'],
    default_order_type: 'dine_in',
    classes: [
      { name: 'SST 6%', rate_bp: 600, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'Service tax 8%', rate_bp: 800, dine_in_rate_bp: -1, mark: '' },
      { name: 'No tax', rate_bp: 0, dine_in_rate_bp: -1, mark: '' },
    ],
  },
  SG: {
    label: 'Singapore',
    currency: 'SGD',
    price_mode: 'inclusive',
    tax_rounding: 'half_up',
    cash_rounding: 0,
    tax_reg_label: 'GST Reg No.',
    order_types: ['dine_in', 'takeaway'],
    default_order_type: 'dine_in',
    classes: [
      { name: 'GST 9%', rate_bp: 900, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'No GST', rate_bp: 0, dine_in_rate_bp: -1, mark: '' },
    ],
  },
  JP: {
    label: 'Japan',
    currency: 'JPY',
    price_mode: 'inclusive',
    tax_rounding: 'floor',
    cash_rounding: 0,
    tax_reg_label: '登録番号',
    order_types: ['dine_in', 'takeaway'],
    default_order_type: 'takeaway',
    classes: [
      { name: 'Standard 10%', rate_bp: 1000, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'Food 8% (10% eaten in)', rate_bp: 800, dine_in_rate_bp: 1000, mark: '※' },
      { name: 'Reduced 8%', rate_bp: 800, dine_in_rate_bp: -1, mark: '※' },
      { name: 'Non-taxable', rate_bp: 0, dine_in_rate_bp: -1, mark: '' },
    ],
  },
  AU: {
    label: 'Australia',
    currency: 'AUD',
    price_mode: 'inclusive',
    tax_rounding: 'half_up',
    cash_rounding: 5,
    tax_reg_label: 'ABN',
    order_types: ['dine_in', 'takeaway'],
    default_order_type: 'takeaway',
    classes: [
      { name: 'GST 10%', rate_bp: 1000, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'GST free', rate_bp: 0, dine_in_rate_bp: -1, mark: '*' },
    ],
  },
  NZ: {
    label: 'New Zealand',
    currency: 'NZD',
    price_mode: 'inclusive',
    tax_rounding: 'half_up',
    cash_rounding: 10,
    tax_reg_label: 'GST No.',
    order_types: ['dine_in', 'takeaway'],
    default_order_type: 'takeaway',
    classes: [
      { name: 'GST 15%', rate_bp: 1500, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'Zero rated', rate_bp: 0, dine_in_rate_bp: -1, mark: '' },
    ],
  },
  GB: {
    label: 'United Kingdom',
    currency: 'GBP',
    price_mode: 'inclusive',
    tax_rounding: 'half_up',
    cash_rounding: 0,
    tax_reg_label: 'VAT No.',
    order_types: ['dine_in', 'takeaway'],
    default_order_type: 'takeaway',
    classes: [
      { name: 'VAT 20%', rate_bp: 2000, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'VAT 5%', rate_bp: 500, dine_in_rate_bp: -1, mark: '' },
      { name: 'Zero rated', rate_bp: 0, dine_in_rate_bp: -1, mark: '' },
    ],
  },
  US: {
    label: 'United States',
    currency: 'USD',
    price_mode: 'exclusive',
    tax_rounding: 'half_up',
    cash_rounding: 0,
    tax_reg_label: 'Tax ID',
    order_types: ['dine_in', 'takeaway'],
    default_order_type: 'takeaway',
    classes: [
      { name: 'Sales tax', rate_bp: 0, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'Non-taxable', rate_bp: 0, dine_in_rate_bp: -1, mark: '' },
    ],
  },
  OTHER: {
    label: 'Another country',
    currency: 'USD',
    price_mode: 'exclusive',
    tax_rounding: 'half_up',
    cash_rounding: 0,
    tax_reg_label: 'Tax No.',
    order_types: [],
    default_order_type: '',
    classes: [
      { name: 'Tax', rate_bp: 0, dine_in_rate_bp: -1, mark: '', is_default: true },
      { name: 'No tax', rate_bp: 0, dine_in_rate_bp: -1, mark: '' },
    ],
  },
};

const REGIONS = ['MY', 'SG', 'JP', 'AU', 'NZ', 'GB', 'US', 'OTHER'];

function list() {
  return REGIONS.map((code) => {
    const p = PRESETS[code];
    return {
      code: code,
      label: p.label,
      currency: p.currency,
      price_mode: p.price_mode,
      tax_rounding: p.tax_rounding,
      cash_rounding: p.cash_rounding,
      tax_reg_label: p.tax_reg_label,
      order_types: p.order_types,
      default_order_type: p.default_order_type,
      classes: p.classes,
    };
  });
}

module.exports = { PRESETS: PRESETS, REGIONS: REGIONS, list: list };
