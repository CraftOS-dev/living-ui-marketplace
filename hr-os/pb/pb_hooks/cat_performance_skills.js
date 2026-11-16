/**
 * Catalog: the skill library and the skills matrix. A person's own skills
 * are the kernel's employee-skills ops (set, remove; managers and HR verify
 * with --verified true); the library name is the skill name.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const SKILL = S('Skill id or name', { required: true });
const FIELDS = {
  category: S('Category, e.g. Engineering, Languages, Safety'),
  description: S('What the skill covers'),
  levels: S('JSON list of up to five descriptions, level 1 first'),
  expected: S('JSON list [{job_title, level}]: the level a job title expects'),
};
const MATRIX = {
  scope: S('team (managers, default) | department | all (HR) | me', { enum: ['team', 'department', 'all', 'me'] }),
  department: S('Department'),
  entity: S('Entity'),
  category: S('Skill category'),
  all_skills: B('Show every library skill, also those nobody in the rows has'),
};

module.exports = [
  { name: 'skills.list', method: 'GET', fn: 'lib_performance_skills.list', perm: 'signed', effect: 'read', desc: 'The skill library with how many people hold each skill, their average level and how many are verified; categories; skill names people use that are not in the library yet (unlisted).', params: { q: S('Name or description contains'), category: S('Category'), archived: B('Include archived skills') } },
  { name: 'skills.add', method: 'POST', fn: 'lib_performance_skills.add', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Add a skill to the library (or several at once with --names \'["SQL","Excel"]\').', params: Object.assign({ name: S('Skill name'), names: S('JSON list of names to add at once') }, FIELDS) },
  { name: 'skills.update', method: 'POST', fn: 'lib_performance_skills.update', perm: 'performance:edit', agent: 'propose', kind: 'performance', diff: { collection: 'skills', id: 'skill', fields: { name: 'name', category: 'category', description: 'description', archived: 'archived' } }, effect: 'write', desc: 'Change a library skill (a skill people hold keeps its name; archive it and add a new one instead).', params: Object.assign({ skill: SKILL, name: S('New name'), archived: B('Archive') }, FIELDS) },
  { name: 'skills.delete', method: 'POST', fn: 'lib_performance_skills.remove', perm: 'performance:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a library skill nobody holds (archive it otherwise).', params: { skill: SKILL } },
  { name: 'skills.matrix', method: 'GET', fn: 'lib_performance_skills.matrix', perm: 'signed', effect: 'read', desc: 'The skills matrix: people (a manager\'s team, a department, or everyone HR sees) by library skills; each cell the level 1 to 5, verified or not, and the level the person\'s job title expects (gaps).', params: Object.assign({}, MATRIX, { limit: N('People (default 100)'), offset: N('People to skip') }) },
  { name: 'skills.export', method: 'GET', fn: 'lib_performance_skills.exportCsv', perm: 'signed', agent: 'deny', effect: 'read', desc: 'A CSV of the skills matrix the caller sees (level per skill, v = verified).', params: MATRIX },
];
