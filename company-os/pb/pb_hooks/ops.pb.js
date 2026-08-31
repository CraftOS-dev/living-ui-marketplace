/// <reference path="../pb_data/types.d.ts" />
/**
 * Company OS custom verbs. Every route has a matching operations.json entry.
 * GOJA RULE: each handler runs in an isolated VM, require() everything
 * INSIDE the callback; never reference file-scope helpers.
 * All verbs require an authenticated caller (multi-user app).
 */

// onboarding.complete, create the company from the wizard answers and seed
// vocab pack, modules, journey steps, starter metrics, and the meeting ritual.
routerAdd('POST', '/api/ops/onboarding-complete', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  try {
    if (lib.getCompany(e.app) !== null) {
      return e.json(409, { error: 'Company already exists, onboarding already completed' });
    }
    const body = e.requestInfo().body || {};
    if (!body.company_type || !body.stage) {
      return e.json(400, { error: 'company_type and stage are required' });
    }
    const company = lib.seedCompany(e.app, body, e.auth.id);
    // Whoever sets up the company is the owner, with full approved access.
    try {
      const owner = e.app.findRecordById('users', e.auth.id);
      owner.set('role', 'owner');
      owner.set('approved', true);
      e.app.save(owner);
    } catch (_) {
      /* users row missing is not fatal to onboarding */
    }
    return e.json(201, { id: company.id, stage: company.getString('stage') });
  } catch (err) {
    console.error('onboarding-complete failed:', err);
    return e.json(500, { error: String(err) });
  }
});

// member.access, the owner/admin grants or revokes a teammate's access to the
// company workspace. Runs with app privileges so it can set fields a user can
// never set on themselves (role, approved). Authorization is enforced here.
routerAdd('POST', '/api/ops/member-access', (e) => {
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  const myRole = e.auth.get('role');
  if (myRole !== 'owner' && myRole !== 'admin') {
    return e.json(403, { error: 'Only the owner or an admin can manage access.' });
  }
  const body = e.requestInfo().body || {};
  const userId = body.userId;
  const action = body.action;
  if (!userId || !action) return e.json(400, { error: 'userId and action are required.' });

  let target;
  try {
    target = e.app.findRecordById('users', userId);
  } catch (_) {
    return e.json(404, { error: 'That account no longer exists.' });
  }
  if (target.id === e.auth.id) return e.json(400, { error: 'You cannot change your own access.' });
  const targetRole = target.get('role');
  if (targetRole === 'owner') return e.json(403, { error: 'The owner account cannot be changed.' });

  try {
    if (action === 'approve') {
      target.set('approved', true);
      if (!target.get('role')) target.set('role', 'member');
    } else if (action === 'revoke') {
      target.set('approved', false);
    } else if (action === 'make_admin') {
      if (myRole !== 'owner') return e.json(403, { error: 'Only the owner can grant admin.' });
      target.set('role', 'admin');
      target.set('approved', true);
    } else if (action === 'make_member') {
      if (myRole !== 'owner') return e.json(403, { error: 'Only the owner can change an admin.' });
      target.set('role', 'member');
    } else if (action === 'remove') {
      if (myRole === 'admin' && targetRole === 'admin') {
        return e.json(403, { error: 'Only the owner can remove an admin.' });
      }
      e.app.delete(target);
      return e.json(200, { ok: true, removed: true });
    } else {
      return e.json(400, { error: 'Unknown action.' });
    }
    e.app.save(target);
    return e.json(200, { ok: true, id: target.id, role: target.get('role'), approved: target.get('approved') });
  } catch (err) {
    console.error('member-access failed:', err);
    return e.json(500, { error: String(err) });
  }
});

// journey.autocheck, mark data-detectable steps done; returns which.
routerAdd('POST', '/api/ops/journey-autocheck', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  try {
    return e.json(200, lib.runAutocheck(e.app));
  } catch (err) {
    console.error('journey-autocheck failed:', err);
    return e.json(500, { error: String(err) });
  }
});

// stage.recompute, suggest a stage from real data (opens a suggestion card
// when it differs; never applies anything).
routerAdd('POST', '/api/ops/stage-recompute', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  try {
    return e.json(200, lib.runStageCheck(e.app));
  } catch (err) {
    console.error('stage-recompute failed:', err);
    return e.json(500, { error: String(err) });
  }
});

// stage.advance, user-confirmed stage change; unlocks steps + module hints.
routerAdd('POST', '/api/ops/stage-advance', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  try {
    const body = e.requestInfo().body || {};
    if (!body.stage) return e.json(400, { error: 'stage is required' });
    return e.json(200, lib.advanceStage(e.app, String(body.stage)));
  } catch (err) {
    console.error('stage-advance failed:', err);
    return e.json(400, { error: String(err) });
  }
});

// workflows.run, run one built-in deterministic workflow by key.
routerAdd('POST', '/api/ops/workflows-run', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  const body = e.requestInfo().body || {};
  const workflow = String(body.workflow || '');
  try {
    let result;
    if (workflow === 'weekly_digest') {
      let digest = lib.buildDigest(e.app);
      // Minimal AI: one optional summary paragraph; deterministic digest
      // stands alone when the bridge is absent.
      try {
        const take = bridge.callLLM(
          'Here is a small company\'s weekly review data:\n\n' + digest,
          'In 2-3 plain, friendly sentences, point out the single most important thing to act on this week. No jargon, no bullet points.',
        );
        if (typeof take === 'string' && take.trim() !== '') {
          digest += '\n\n## CraftBot\'s take\n' + take.trim();
        }
      } catch (aiErr) {
        console.error('digest AI polish skipped:', aiErr);
      }
      const note = lib.saveDigestNote(e.app, digest);
      result = { note_id: note.id, title: note.getString('title') };
      lib.recordRun(e.app, 'weekly_digest', 'ok', 'Digest note created: ' + note.getString('title'));
    } else if (workflow === 'journey_autocheck') {
      result = lib.runAutocheck(e.app);
      lib.recordRun(e.app, 'journey_autocheck', 'ok', result.completed.length + ' step(s) auto-completed');
    } else if (workflow === 'stage_check') {
      result = lib.runStageCheck(e.app);
      lib.recordRun(e.app, 'stage_check', 'ok', result.suggested ? 'Suggested stage: ' + result.suggested : 'No change suggested');
    } else if (workflow === 'attention_sweep') {
      result = lib.runAttentionSweep(e.app);
      lib.recordRun(e.app, 'attention_sweep', 'ok', result.created + ' suggestion(s) created');
    } else {
      return e.json(400, { error: 'Unknown workflow: ' + workflow });
    }
    return e.json(200, { workflow: workflow, result: result });
  } catch (err) {
    console.error('workflows-run failed:', err);
    try {
      const lib2 = require(`${__hooks}/lib_company.js`);
      lib2.recordRun(e.app, workflow, 'error', String(err));
    } catch {
      /* recording is best-effort */
    }
    return e.json(500, { error: String(err) });
  }
});

// ai.draft-plan, draft EMPTY one-page-plan fields from the onboarding
// answers via the CraftBot bridge. Draft-only; degrades to 503 honestly.
routerAdd('POST', '/api/ops/ai-draft-plan', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  try {
    const company = lib.getCompany(e.app);
    if (company === null) return e.json(400, { error: 'No company yet' });
    const raw = bridge.callLLM(
      'Company name: ' + company.getString('name') +
        '\nWhat it does: ' + company.getString('what_it_does') +
        '\nType: ' + company.getString('company_type') +
        '\nStage: ' + company.getString('stage'),
      'Draft a one-page plan for this small company. Reply with STRICT JSON only: ' +
        '{"mission": "...", "who_we_serve": "...", "offer": "...", "how_money": "..."}. ' +
        'One or two plain, friendly sentences per field. No jargon.',
    );
    if (typeof raw !== 'string' || raw.trim() === '') {
      return e.json(503, { error: 'AI assist unavailable, the app works fine without it' });
    }
    let parsed;
    try {
      const cleaned = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return e.json(502, { error: 'AI returned an unusable draft, try again' });
    }
    const filled = [];
    for (const field of ['mission', 'who_we_serve', 'offer', 'how_money']) {
      if (
        String(company.getString(field)).trim() === '' &&
        typeof parsed[field] === 'string' &&
        parsed[field].trim() !== ''
      ) {
        company.set(field, parsed[field].trim());
        filled.push(field);
      }
    }
    if (filled.length > 0) e.app.save(company);
    return e.json(200, { filled: filled });
  } catch (err) {
    console.error('ai-draft-plan failed:', err);
    return e.json(500, { error: String(err) });
  }
});

// marketing.ai_campaign_ideas, draft a few campaign ideas for a funnel goal
// from the company profile via the CraftBot LLM. Suggestions only; 503 when
// the bridge is absent so the page works fine without it.
routerAdd('POST', '/api/ops/ai-campaign-ideas', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  try {
    const company = lib.getCompany(e.app);
    if (company === null) return e.json(400, { error: 'No company yet' });
    const body = e.requestInfo().body || {};
    const GOAL_TEXT = {
      awareness: 'get known (reach new people)',
      leads: 'get leads (people who show interest)',
      sales: 'get sales (turn interest into money)',
      loyalty: 'keep customers (repeat business and referrals)',
    };
    const goal = GOAL_TEXT[body.goal] ? body.goal : 'leads';
    const channelNames = app => {
      const rows = app.findRecordsByFilter('channels', "active = true", 'name', 0, 20);
      return rows.map((r) => r.getString('name')).filter((n) => n !== '');
    };
    const chans = channelNames(e.app);
    const raw = bridge.callLLM(
      'Company: ' + company.getString('name') +
        '\nWhat it does: ' + company.getString('what_it_does') +
        '\nWho we serve: ' + company.getString('who_we_serve') +
        '\nOffer: ' + company.getString('offer') +
        '\nStage: ' + company.getString('stage') +
        '\nChannels they already use: ' + (chans.length ? chans.join(', ') : 'none yet') +
        '\nMarketing goal for these ideas: ' + GOAL_TEXT[goal],
      'You help a very small business plan marketing. Suggest 3 concrete, low-cost campaign ideas for the stated goal. ' +
        'Reply with STRICT JSON only: {"ideas":[{"name":"short catchy name","angle":"one plain sentence on the idea","first_step":"one small first action"}]}. ' +
        'No jargon, no budgets over what a small business can afford, nothing requiring a big team.',
    );
    if (typeof raw !== 'string' || raw.trim() === '') {
      return e.json(503, { error: 'AI assist unavailable, plan campaigns manually for now' });
    }
    let parsed;
    try {
      const cleaned = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return e.json(502, { error: 'AI returned an unusable draft, try again' });
    }
    const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.slice(0, 5).filter((i) => i && typeof i.name === 'string') : [];
    if (ideas.length === 0) return e.json(502, { error: 'AI returned no usable ideas, try again' });
    return e.json(200, { goal: goal, ideas: ideas });
  } catch (err) {
    console.error('ai-campaign-ideas failed:', err);
    return e.json(500, { error: String(err) });
  }
});

// marketing.ai_content_draft, draft copy for one content piece via the LLM.
// Returns the copy; also saves it onto the promo when `promoId` is given and
// its note is still empty. 503 when the bridge is absent.
routerAdd('POST', '/api/ops/ai-content-draft', (e) => {
  const lib = require(`${__hooks}/lib_company.js`);
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  if (!e.auth) return e.json(401, { error: 'Sign in required' });
  try {
    const company = lib.getCompany(e.app);
    if (company === null) return e.json(400, { error: 'No company yet' });
    const body = e.requestInfo().body || {};
    let promo = null;
    let title = String(body.title || '').trim();
    let format = String(body.format || '').trim();
    if (body.promoId) {
      try {
        promo = e.app.findRecordById('promos', String(body.promoId));
        if (title === '') title = promo.getString('title');
        if (format === '') format = promo.getString('format');
      } catch {
        /* fall back to raw params */
      }
    }
    if (title === '') return e.json(400, { error: 'A title is required to draft copy' });
    const FORMAT_TEXT = {
      post: 'a short social media post (a few lines, friendly, one call to action)',
      email: 'a short marketing email (subject line on the first line, then 2-3 short paragraphs)',
      ad: 'a short ad (one punchy headline, one line of body, one call to action)',
      article: 'a blog article outline (a title and 4-6 bullet section headings)',
      event: 'a short event announcement (what, when, why come)',
      other: 'a short piece of marketing copy',
    };
    const raw = bridge.callLLM(
      'Business: ' + company.getString('name') +
        '\nWhat it does: ' + company.getString('what_it_does') +
        '\nWho we serve: ' + company.getString('who_we_serve') +
        '\nOffer: ' + company.getString('offer') +
        '\nContent title/topic: ' + title,
      'Write ' + (FORMAT_TEXT[format] || FORMAT_TEXT.other) + ' for this small business. ' +
        'Plain, warm, human. No hashtags spam, no jargon, no emojis unless natural. Return ONLY the copy, no preamble.',
    );
    if (typeof raw !== 'string' || raw.trim() === '') {
      return e.json(503, { error: 'AI assist unavailable, write the copy yourself for now' });
    }
    const copy = raw.trim();
    let saved = false;
    if (promo !== null && String(promo.getString('note')).trim() === '') {
      promo.set('note', copy);
      e.app.save(promo);
      saved = true;
    }
    return e.json(200, { copy: copy, saved: saved });
  } catch (err) {
    console.error('ai-content-draft failed:', err);
    return e.json(500, { error: String(err) });
  }
});

// Daily tick: journey autocheck + stage check + attention sweep. Suggestion
// cards only, nothing outward, nothing applied without the user.
cronAdd('companyOsDailyTick', '0 6 * * *', () => {
  const lib = require(`${__hooks}/lib_company.js`);
  try {
    if (lib.getCompany($app) === null) return;
    const a = lib.runAutocheck($app);
    lib.recordRun($app, 'journey_autocheck', 'ok', a.completed.length + ' step(s) auto-completed');
    const s = lib.runStageCheck($app);
    lib.recordRun($app, 'stage_check', 'ok', s.suggested ? 'Suggested stage: ' + s.suggested : 'No change suggested');
    const w = lib.runAttentionSweep($app);
    lib.recordRun($app, 'attention_sweep', 'ok', w.created + ' suggestion(s) created');
  } catch (err) {
    console.error('companyOsDailyTick failed:', err);
  }
});
