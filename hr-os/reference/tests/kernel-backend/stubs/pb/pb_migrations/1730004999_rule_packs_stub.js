/// <reference path="../pb_data/types.d.ts" />
// SCRATCH ONLY (kernel-backend): the payroll module owns rule_packs; this stub lets the kernel's boot seeding run here.
migrate((app) => {
  try { app.findCollectionByNameOrId('rule_packs'); return; } catch { /* not there yet */ }
  const t = (name, max) => ({ name: name, type: 'text', max: max || 200 });
  const c = new Collection({ type: 'base', name: 'rule_packs', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [
    t('code', 60), t('country', 2), t('region', 10), t('name', 200), t('version', 40), t('effective_from', 10), t('effective_to', 10),
    { name: 'status', type: 'select', maxSelect: 1, values: ['draft', 'tested', 'active', 'retired'] }, { name: 'body', type: 'json', maxSize: 5000000 },
    { name: 'vectors_passed', type: 'number', onlyInt: true }, { name: 'vectors_total', type: 'number', onlyInt: true }, t('tested_at', 40), t('activated_by', 30), t('activated_at', 40),
    { name: 'source', type: 'select', maxSelect: 1, values: ['builtin', 'agent', 'person'] }, t('notes', 4000),
    { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ] });
  app.save(c);
}, () => {});
