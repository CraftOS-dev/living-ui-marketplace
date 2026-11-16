// The "Agent triggers" section of AGENT_APP.md, written from the code:
// pb/pb_hooks/lib_agent.js (TRIGGERS, AUTOMATIC), triggers.json (the
// instructions the platform delivers) and the recipes in guide_*.js.
// build_agent_app.mjs puts it in the document.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function agentTriggersMd(APP) {
  const require = createRequire(import.meta.url);
  const hooks = join(APP, 'pb', 'pb_hooks');
  const { TRIGGERS, AUTOMATIC, OPEN_HOURS } = require(join(hooks, 'lib_agent.js'));
  const declared = JSON.parse(readFileSync(join(APP, 'triggers.json'), 'utf8')).triggers;
  const recipes = {};
  for (const f of readdirSync(hooks).filter((n) => /^guide_[a-z0-9_]+\.js$/.test(n)).sort()) {
    const g = require(join(hooks, f));
    for (const [k, steps] of Object.entries(g.recipes || {})) recipes[k] = { file: f, steps };
  }
  const rows = Object.entries(TRIGGERS).map(([k, t]) => `| \`${k}\` | ${t.fires} | \`${t.param}\` (the ${t.record}) | ${t.cooldown >= 3600 ? t.cooldown / 3600 + ' hours' : t.cooldown + ' s'} |`);
  const auto = Object.entries(AUTOMATIC).map(([k, a]) => `| \`${k}\` | ${a.label} | ${a.tip} | \`${a.trigger}\` |`);
  const recipeText = Object.keys(TRIGGERS)
    .map((k) => {
      const r = recipes[k];
      const [summary, ...steps] = r.steps;
      return `#### \`${k}\` (\`${r.file}\`)\n\n${summary}\n\n${steps.map((s) => '- ' + s.replace(/^\d+\)\s*/, '')).join('\n')}\n`;
    })
    .join('\n');
  for (const k of Object.keys(TRIGGERS)) if (declared[k] === undefined) throw new Error('triggers.json lacks ' + k + ': run node tools/gen_triggers.mjs');
  return `## Agent triggers

Your AI agent is asked for one piece of work at a time: every task that needs
its judgment is its own trigger in \`triggers.json\` (written by \`node
tools/gen_triggers.mjs\` from \`pb/pb_hooks/lib_agent.js\` and the instruction
each module gives in its \`guide_*.js\`; each instruction is under 1,000
characters and names what to read, the ops to call and what done looks
like). The action that needs the work fires its trigger with the record's id
as the only param; there is no job queue and nothing asks again on its own.

| Trigger | What fires it | Params | Cooldown |
|---------|---------------|--------|----------|
${rows.join('\n')}

How an ask behaves (\`lib_agent.js\`):

- A person's click fires the trigger once (\`_triggers_lib.fire\`); the request id, when it was asked, who asked and their note are kept on the record in its \`agent_asks\` field. Hooks never read the platform's request rows; screens follow the request with the kit's \`useAgentRequest\` and show it honestly: sent in a moment (the cooldown held it), sent, working, done, not picked up in a day, not done.
- While an ask of a trigger on a record is open (asked less than ${OPEN_HOURS} hours ago and its work not delivered), asking again fires nothing (a repeat click, a second receipt on the same claim): the answer says \`asked: false\`.
- The op that delivers the work closes the ask: the answer ops (\`questions.answer\`, \`timesheet-reviews.done\`, \`packs.checked\`, the last \`claim-lines.read-result\` or \`read-failed\` of a claim, \`tasks.complete\` of the last task of your AI agent) and your AI agent's proposals (\`letters.update\`, \`openings.update\` with a description, \`interviews.summary\`, \`packs.draft\`), plus \`payruns.note --kind review\` and \`review-summaries.submit\`.
- Not picked up in ${OPEN_HOURS} hours, or refused: the record shows it with Retry. \`agent.retry --trigger --record --request\` (people only) fires once more for the request the person saw; a second Retry of the same request fires nothing.
- A person's ask the cooldown refuses answers 409 in plain words. An ask that comes with a new record (a receipt, a question, a letter request, a summary request, a timesheet check) or from Automatic work waits instead and the minute job sends it once.

Automatic work (\`settings.automatic\`, Settings, Your AI agent; every switch off until the company turns it on):

| Switch | Label | What it does | Trigger |
|--------|-------|--------------|---------|
${auto.join('\n')}

With every switch off, the app never asks your AI agent on its own: the minute job only sends an ask a person made that the cooldown held back. A hire, a checklist that starts, a week with missed punches or a month without a rule check asks nothing unless its switch is on; the screens offer "Ask your AI agent" instead.

### Recipes

The full steps of each trigger (\`app.guide --recipe <trigger>\`):

${recipeText}`;
}
