/**
 * Write triggers.json from the recipes your AI agent reads in app.guide
 * (pb/pb_hooks/lib_guide.js), so a trigger's instruction and the guide never
 * disagree.
 *
 *   node tools/gen_triggers.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { RECIPES, TAIL } = require(join(root, 'pb', 'pb_hooks', 'lib_guide.js'));

const P = (description, required) => ({ type: 'string', description, required: required !== false });

const TRIGGERS = {
  day_plan_requested: { recipe: 'day_plan', description: "Asks your AI agent to plan the person's day (moves, today's top three, new cards, a note) as a proposal the person keeps item by item", params: { date: P('The day YYYY-MM-DD'), brief: P('Anything the person added', false) }, cooldown: 60 },
  inbox_sort_requested: { recipe: 'inbox', description: 'Asks your AI agent to suggest a day, an area, a goal or a person for each card in the inbox', params: { brief: P('Anything the person added', false) }, cooldown: 60 },
  breakdown_requested: { recipe: 'breakdown', description: 'Asks your AI agent to break a goal down into first steps (cards, habits, milestones, a project) as a proposal', params: { goal_id: P('The goal'), brief: P('Anything the person added', false) }, cooldown: 30 },
  habit_help_requested: { recipe: 'habit_help', description: 'Asks your AI agent to look at a habit that is not sticking and suggest small changes', params: { habit_id: P('The habit'), brief: P('Anything the person added', false) }, cooldown: 30 },
  recap_requested: { recipe: 'recap', description: "Asks your AI agent to write its paragraph of the week's recap (the weekly routine, or a button)", params: { week_start: P('The first day of the week') }, cooldown: 120 },
  morning_note_due: { recipe: 'morning_note', description: "The morning routine: your AI agent writes today's note on Home (weather, what matters, a nudge)", params: { date: P('The day') }, cooldown: 300 },
  question_asked: { recipe: 'question', description: 'Asks your AI agent a question typed in the app', params: { ask_id: P('The question') }, cooldown: 10 },
  evening_checkin: { recipe: 'evening_checkin', description: 'The evening routine: your AI agent sends one short message about the day and offers to move what is left', params: { date: P('The day') }, cooldown: 300 },
  proposal_returned: { recipe: null, description: 'Tells your AI agent the person sent one of its proposals back with what to change', params: { proposal_id: P('The proposal') }, cooldown: 10 },
};

const out = { triggers: {} };
for (const [name, t] of Object.entries(TRIGGERS)) {
  let instruction;
  if (t.recipe === null) {
    instruction = 'The person sent one of your proposals back in this Life OS with what to change. 1) `agent-app run <project> proposals.list --status returned` and find <proposal_id>: read its decision_note. 2) Make the change they asked for and propose again with the same operation and a new --why (never re-submit it unchanged), or say in one message why it cannot be done. ' + TAIL;
  } else {
    const lines = RECIPES[t.recipe];
    instruction = lines[0] + ' First run `agent-app run <project> app.guide` once for the rules. Steps (every command is `agent-app run <project> <op> ...`): ' + lines.slice(1).join(' ') + ' Finish with exactly one short message to the person. ' + TAIL;
  }
  const params = {};
  for (const [k, v] of Object.entries(t.params)) {
    params[k] = { type: v.type, description: v.description };
    if (v.required) params[k].required = true;
  }
  out.triggers[name] = { description: t.description, instruction, params, cooldown_seconds: t.cooldown };
}
writeFileSync(join(root, 'triggers.json'), JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(out.triggers).length + ' triggers');
