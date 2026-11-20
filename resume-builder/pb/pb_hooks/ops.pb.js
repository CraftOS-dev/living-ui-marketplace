/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond CRUD live here (spec B3/D4).
 * Every route here must have a matching entry in operations.json (the gate
 * enforces it) so any agent can discover it via GET /api/_ops.
 */

// resumes.duplicate — duplicate a resume record by id (body { id }), as the
// Duplicate button does: the same handler as the resumes.duplicate operation
// (lib_agent.js). Answers { success, id, title } of the new copy; an unknown
// id answers 404.
routerAdd('POST', '/api/ops/resumes/duplicate', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.duplicate', (result) => ({
    id: result.resume.id,
    title: result.resume.title
  }));
});
