/**
 * SCRATCH ONLY: the fake module's registrations (kernel-core tests). Never shipped.
 */
module.exports = {
  on: { 'entity.created': 'lib_zz_test.onEntity' },
  needsYou: 'lib_zz_test.needsYou',
  triggers: {
    zz_review: {
      record: 'zz_things',
      param: 'thing_id',
      perm: 'network:edit',
      label: 'Review a thing',
      description: 'Test: your AI agent reviews a thing',
      fires: 'zz.make --ask true, or Ask your AI agent on a thing',
      cooldown: 10,
      deal: 'lib_zz_test.dealOf',
      nda: true,
      lands: { 'zz.save': 'thing' },
      instruction: 'Review the thing thing_id. 1) zz.get --thing <thing_id>. 2) zz.save --thing <thing_id> --value <n> --why --evidence --confidence (marks it done).',
    },
  },
  search: 'lib_zz_test.search',
  settingsKeys: { zz_test: { sla_days: 5, label: 'Things', enabled: true } },
  imports: {
    zz_things: {
      label: 'Things',
      perm: 'network:edit',
      fields: [
        { key: 'name', label: 'Name', required: true, type: 'text', synonyms: ['Thing', 'Thing name'] },
        { key: 'value', label: 'Value', type: 'number', synonyms: ['Amount', 'Score'] },
        { key: 'day', label: 'Day', type: 'day', synonyms: ['Date'] },
        { key: 'email', label: 'Email', type: 'email', synonyms: ['E-mail'] },
        { key: 'tags', label: 'Tags', type: 'list' },
      ],
      row: 'lib_zz_test.importRow',
    },
  },
  today: 'lib_zz_test.today',
};
