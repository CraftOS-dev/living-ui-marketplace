/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — routes for every agent operation declared in
 * operations.json (executor method + path match each routerAdd exactly).
 * The logic, with the UI source of every rule, is in lib_agent.js.
 *
 * Handlers run in isolated VMs: each one requires lib_agent.js itself and
 * names its operation literally. resumes.duplicate is routed here at
 * POST /api/ops/resumes/copy; the app's older route
 * POST /api/ops/resumes/duplicate (ops.pb.js) runs the same handler.
 */

// app.guide
routerAdd('GET', '/api/ops/app/guide', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'app.guide');
});

// resumes.list
routerAdd('GET', '/api/ops/resumes/list', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.list');
});

// resumes.get
routerAdd('GET', '/api/ops/resumes/get', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.get');
});

// resumes.score
routerAdd('GET', '/api/ops/resumes/score', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.score');
});

// resumes.export
routerAdd('GET', '/api/ops/resumes/export', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.export');
});

// resumes.create
routerAdd('POST', '/api/ops/resumes/create', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.create');
});

// resumes.import
routerAdd('POST', '/api/ops/resumes/import', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.import');
});

// resumes.duplicate
routerAdd('POST', '/api/ops/resumes/copy', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.duplicate');
});

// resumes.rename
routerAdd('POST', '/api/ops/resumes/rename', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.rename');
});

// resumes.delete
routerAdd('POST', '/api/ops/resumes/delete', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'resumes.delete');
});

// style.options
routerAdd('GET', '/api/ops/style/options', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'style.options');
});

// style.set-template
routerAdd('POST', '/api/ops/style/set-template', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'style.set-template');
});

// style.update
routerAdd('POST', '/api/ops/style/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'style.update');
});

// layout.set-visibility
routerAdd('POST', '/api/ops/layout/set-visibility', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'layout.set-visibility');
});

// layout.move
routerAdd('POST', '/api/ops/layout/move', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'layout.move');
});

// personal.update
routerAdd('POST', '/api/ops/personal/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'personal.update');
});

// personal.set-photo
routerAdd('POST', '/api/ops/personal/set-photo', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'personal.set-photo');
});

// philosophy.update
routerAdd('POST', '/api/ops/philosophy/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'philosophy.update');
});

// experience.add
routerAdd('POST', '/api/ops/experience/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'experience.add');
});

// experience.update
routerAdd('POST', '/api/ops/experience/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'experience.update');
});

// experience.remove
routerAdd('POST', '/api/ops/experience/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'experience.remove');
});

// education.add
routerAdd('POST', '/api/ops/education/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'education.add');
});

// education.update
routerAdd('POST', '/api/ops/education/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'education.update');
});

// education.remove
routerAdd('POST', '/api/ops/education/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'education.remove');
});

// skills.add
routerAdd('POST', '/api/ops/skills/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'skills.add');
});

// skills.update
routerAdd('POST', '/api/ops/skills/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'skills.update');
});

// skills.remove
routerAdd('POST', '/api/ops/skills/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'skills.remove');
});

// mytime.add
routerAdd('POST', '/api/ops/mytime/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'mytime.add');
});

// mytime.update
routerAdd('POST', '/api/ops/mytime/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'mytime.update');
});

// mytime.remove
routerAdd('POST', '/api/ops/mytime/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'mytime.remove');
});

// achievements.add
routerAdd('POST', '/api/ops/achievements/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'achievements.add');
});

// achievements.update
routerAdd('POST', '/api/ops/achievements/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'achievements.update');
});

// achievements.remove
routerAdd('POST', '/api/ops/achievements/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'achievements.remove');
});

// projects.add
routerAdd('POST', '/api/ops/projects/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'projects.add');
});

// projects.update
routerAdd('POST', '/api/ops/projects/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'projects.update');
});

// projects.remove
routerAdd('POST', '/api/ops/projects/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'projects.remove');
});

// certifications.add
routerAdd('POST', '/api/ops/certifications/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'certifications.add');
});

// certifications.update
routerAdd('POST', '/api/ops/certifications/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'certifications.update');
});

// certifications.remove
routerAdd('POST', '/api/ops/certifications/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'certifications.remove');
});

// publications.add
routerAdd('POST', '/api/ops/publications/add', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'publications.add');
});

// publications.update
routerAdd('POST', '/api/ops/publications/update', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'publications.update');
});

// publications.remove
routerAdd('POST', '/api/ops/publications/remove', (e) => {
  const agent = require(`${__hooks}/lib_agent.js`);
  return agent.run(e, 'publications.remove');
});
