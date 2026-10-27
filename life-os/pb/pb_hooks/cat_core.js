/**
 * Catalog: the app itself (guide, status, Home, search), settings and the
 * first run, activity and undo, export, the calendar mirror, routines, the
 * world outside (place, weather, news) and working with your AI agent
 * (requests, questions, proposals, suggestions).
 */
const S = (desc, o) => Object.assign({ type: 'string', desc: desc }, o || {});
const N = (desc, o) => Object.assign({ type: 'number', desc: desc }, o || {});
const B = (desc, o) => Object.assign({ type: 'boolean', desc: desc }, o || {});

module.exports = [
  { name: 'app.guide', method: 'GET', fn: 'lib_guide.guide', effect: 'read', desc: 'Start here: how a life is kept in this app, what your AI agent may do, the error codes, and recipes (--topic day_plan|inbox|breakdown|habit_help|recap|morning_note|question|evening_checkin|logging; --part arts for habit drawings).', params: { topic: S('A recipe'), part: S('arts', { enum: ['arts'] }) } },
  { name: 'app.status', method: 'GET', fn: 'lib_settings.status', effect: 'read', desc: 'What the frame shows: badges, the areas switched on, goals, projects and people for pickers, currency, units, the place, today\'s writing prompt.', params: {} },
  { name: 'home.summary', method: 'GET', fn: 'lib_dash.summary', effect: 'read', desc: "Home in one read: today's cards, habits, the body, money this month, people to reach and birthdays, what is coming in 7 days, the latest journal moment, goals, nudges.", params: {} },
  { name: 'find.all', method: 'GET', fn: 'lib_guide.find', effect: 'read', desc: 'Search cards, goals, habits, people, projects, books (and, for the person, the journal).', params: { q: S('What to find', { required: true, example: 'run' }), limit: N('At most this many per kind') } },

  { name: 'settings.get', method: 'GET', fn: 'lib_settings.get', effect: 'read', desc: 'The settings and the currencies the app knows.', params: {} },
  {
    name: 'settings.update',
    method: 'POST',
    fn: 'lib_settings.update',
    effect: 'shape',
    agent: 'propose',
    preview: 'lib_settings.preview',
    desc: 'Change settings. From your AI agent it waits as a proposal the person keeps.',
    params: {
      owner_name: S('Their name'),
      day_starts_hour: N('When a day starts, 0 to 6'),
      week_starts_on: S('monday or sunday', { enum: ['monday', 'sunday'] }),
      units: S('metric or imperial', { enum: ['metric', 'imperial'] }),
      currency: S('ISO currency code, e.g. EUR'),
      month_budget: S('Monthly spending budget, e.g. 2000 (0 for none)'),
      water_goal: N('Glasses of water a day'),
      sleep_goal: N('Hours of sleep a night'),
      steps_goal: N('Steps a day'),
      reflections_to_agent: S('never or when_shared', { enum: ['never', 'when_shared'] }),
      agent_autonomy: S('as_designed or propose_all', { enum: ['as_designed', 'propose_all'] }),
      quiet_start: S('Quiet hours start HH:MM'),
      quiet_end: S('Quiet hours end HH:MM'),
      calendar_enabled: B('Mirror Google Calendar (read only)'),
      calendar_id: S('Which calendar (primary by default)'),
      home_rows: S('JSON order of the rows of Home: every one of today, habits, goals, days, news once'),
    },
  },
  { name: 'onboarding.complete', method: 'POST', fn: 'lib_settings.onboard', effect: 'admin', agent: 'deny', desc: 'The first run in one step: a name, the areas that are theirs, currency and units, a first goal, a few habits, the rhythm.', params: { owner_name: S('Their name'), areas: S('JSON list of area kinds to switch on, e.g. ["health","money","family"]'), currency: S('ISO currency code'), units: S('metric or imperial', { enum: ['metric', 'imperial'] }), week_starts_on: S('monday or sunday', { enum: ['monday', 'sunday'] }), goal: S('JSON first goal: {"title":"Run a half marathon","area":"health","measure":"number_up","target":21,"unit":"km","deadline":"2027-04-01","purpose":"..."}'), habits: S('JSON list of habits: [{"name":"Drink water","art":"water","target":8,"unit":"glasses","cue":"After breakfast","for_goal":true}]'), routines: S('JSON of routines to switch on: {"morning_note":true,"evening_checkin":true,"weekly_recap":true}') } },

  { name: 'activity.list', method: 'GET', fn: 'lib_activity.list', effect: 'read', desc: 'What was done, by whom, newest first.', params: { actor: S('person, agent or system', { enum: ['person', 'agent', 'system'] }), target: S('A collection'), record: S('A record id'), since: S('Since a timestamp'), limit: N('How many'), offset: N('Skip this many') } },
  { name: 'activity.undo', method: 'POST', fn: 'lib_activity.undo', effect: 'capture', always: true, desc: 'Undo one write (or a batch). Your AI agent can undo only its own.', params: { entry: S('Activity id'), batch: S('A batch id') } },
  { name: 'activity.last', method: 'GET', fn: 'lib_activity.last', effect: 'read', desc: "The caller's newest undoable write.", params: {} },
  { name: 'export.json', method: 'GET', fn: 'lib_settings.exportAll', effect: 'read', agent: 'deny', desc: 'Everything as one JSON file (the person only).', params: {} },

  { name: 'calendar.status', method: 'GET', fn: 'lib_calendar.status', effect: 'read', desc: 'Whether the Google Calendar mirror is on and its last sync.', params: {} },
  { name: 'calendar.events', method: 'GET', fn: 'lib_calendar.events', effect: 'read', desc: 'Mirrored calendar events between two days.', params: { from: S('First day'), to: S('Last day') } },
  { name: 'calendar.sync', method: 'POST', fn: 'lib_calendar.syncOp', effect: 'capture', always: true, desc: 'Sync the calendar mirror now.', params: {} },

  { name: 'routines.list', method: 'GET', fn: 'lib_routines.list', effect: 'read', desc: 'The routines that ask your AI agent (morning note, evening check-in, weekly recap): on or off, time, days, last runs.', params: {} },
  { name: 'routines.update', method: 'POST', fn: 'lib_routines.update', effect: 'admin', agent: 'deny', desc: 'Switch a routine on or off, set its time and days (the person only).', params: { routine: S('morning_note, evening_checkin or weekly_recap', { required: true }), enabled: B('On or off'), time: S('HH:MM'), days: S('JSON list of weekdays 0 (Sunday) to 6') } },
  { name: 'routines.run-now', method: 'POST', fn: 'lib_routines.runNow', effect: 'admin', agent: 'deny', desc: 'Run a routine now, to try it.', params: { routine: S('The routine', { required: true }) } },

  { name: 'world.place', method: 'GET', fn: 'lib_world.place', effect: 'read', desc: 'Where the weather and news are for (found from the internet address the first time).', params: {} },
  { name: 'world.places', method: 'GET', fn: 'lib_world.places', effect: 'read', desc: 'Towns matching a name, to choose one.', params: { q: S('A town name', { required: true }) } },
  { name: 'world.set-place', method: 'POST', fn: 'lib_world.setPlace', effect: 'admin', agent: 'deny', desc: 'Use this town for the weather and news (the person only).', params: { city: S('Town', { required: true }), region: S('Region'), country: S('Country code'), lat: N('Latitude', { required: true }), lon: N('Longitude', { required: true }), timezone: S('Time zone') } },
  { name: 'world.weather', method: 'GET', fn: 'lib_world.weather', effect: 'read', desc: 'The weather now, the next 24 hours and 7 days where the person lives.', params: {} },
  { name: 'world.news', method: 'GET', fn: 'lib_world.news', effect: 'read', desc: 'Headlines for a topic.', params: { topic: S('Topic', { enum: ['top', 'world', 'nation', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'] }), limit: N('How many') } },

  { name: 'agent.request', method: 'POST', fn: 'lib_agent.request', effect: 'confirm', agent: 'deny', desc: 'A person asks your AI agent for a piece of work from a screen.', params: { kind: S('What', { required: true, enum: ['day_plan', 'inbox', 'breakdown', 'habit_help', 'recap'] }), date: S('The day'), goal: S('Goal id (breakdown)'), habit: S('Habit id (habit_help)'), brief: S('Anything to add') } },
  { name: 'agent.brief', method: 'GET', fn: 'lib_agent.brief', effect: 'read', desc: "The person's life today in one read, for your AI agent's first call.", params: {} },
  { name: 'agent.status', method: 'GET', fn: 'lib_agent.status', effect: 'read', desc: 'Counts of what waits: proposals, suggestions, questions.', params: {} },

  { name: 'asks.create', method: 'POST', fn: 'lib_agent.askCreate', effect: 'confirm', agent: 'deny', desc: 'A person asks your AI agent a question.', params: { question: S('The question', { required: true }), about: S('What it is about', { enum: ['life', 'area', 'goal', 'habit', 'person'] }), target: S('The area kind, goal, habit or person id') } },
  { name: 'asks.list', method: 'GET', fn: 'lib_agent.askList', effect: 'read', desc: 'Questions and answers, newest first.', params: { status: S('waiting, working, answered or failed', { enum: ['waiting', 'working', 'answered', 'failed'] }), limit: N('How many') } },
  { name: 'asks.get', method: 'GET', fn: 'lib_agent.askGet', effect: 'read', desc: 'One question.', params: { ask: S('Question id', { required: true }) } },
  { name: 'asks.working', method: 'POST', fn: 'lib_agent.askWorking', effect: 'capture', always: true, desc: 'Your AI agent is working on the answer.', params: { ask: S('Question id', { required: true }) } },
  { name: 'asks.answer', method: 'POST', fn: 'lib_agent.askAnswer', effect: 'capture', always: true, desc: 'The answer, in plain text with the numbers.', params: { ask: S('Question id', { required: true }), answer: S('The answer', { required: true }) } },
  { name: 'asks.fail', method: 'POST', fn: 'lib_agent.askFail', effect: 'capture', always: true, desc: 'Say the question cannot be answered, and why.', params: { ask: S('Question id', { required: true }), reason: S('Why', { required: true }) } },
  { name: 'asks.delete', method: 'POST', fn: 'lib_agent.askDelete', effect: 'confirm', agent: 'deny', destructive: true, desc: 'Delete a question.', params: { ask: S('Question id', { required: true }) } },

  { name: 'proposals.list', method: 'GET', fn: 'lib_agent.proposals', effect: 'read', desc: 'Proposals (waiting by default).', params: { status: S('Which', { enum: ['waiting', 'approved', 'partly_approved', 'rejected', 'returned', 'withdrawn', 'stale', 'all'] }), kind: S('A kind'), limit: N('How many') } },
  { name: 'proposals.approve', method: 'POST', fn: 'lib_agent.approve', effect: 'confirm', agent: 'deny', desc: 'Keep a proposal (all of it, or only the items ticked).', params: { proposal: S('Proposal id', { required: true }), items: S('JSON list of item keys to keep') } },
  { name: 'proposals.reject', method: 'POST', fn: 'lib_agent.reject', effect: 'confirm', agent: 'deny', desc: 'Decline a proposal.', params: { proposal: S('Proposal id', { required: true }), note: S('Why') } },
  { name: 'proposals.return', method: 'POST', fn: 'lib_agent.returnBack', effect: 'confirm', agent: 'deny', desc: 'Send a proposal back with what to change.', params: { proposal: S('Proposal id', { required: true }), note: S('What to change', { required: true }) } },
  { name: 'proposals.withdraw', method: 'POST', fn: 'lib_agent.withdraw', effect: 'capture', always: true, desc: 'Your AI agent takes one of its proposals back.', params: { proposal: S('Proposal id', { required: true }), note: S('Why') } },

  { name: 'suggestions.list', method: 'GET', fn: 'lib_agent.suggestionList', effect: 'read', desc: 'Field suggestions (open by default).', params: { status: S('Which', { enum: ['open', 'accepted', 'dismissed', 'stale', 'all'] }), target_kind: S('tasks, habits or goals', { enum: ['tasks', 'habits', 'goals'] }), target_id: S('A record id'), limit: N('How many') } },
  { name: 'suggestions.create', method: 'POST', fn: 'lib_agent.suggestionCreate', effect: 'capture', always: true, desc: 'Suggest one field of one record (or many with --items): shown as a dashed chip the person keeps or dismisses.', params: { target_kind: S('tasks, habits or goals', { enum: ['tasks', 'habits', 'goals'] }), target_id: S('Record id'), field: S('Field (tasks: do_date, due_date, area, goal, project, person, duration_min; habits: goal, area, cue, time_of_day; goals: area, deadline, purpose)'), value: S('The value'), why: S('Why, briefly'), items: S('JSON list of {target_kind, target_id, field, value, why}') } },
  { name: 'suggestions.accept', method: 'POST', fn: 'lib_agent.suggestionAccept', effect: 'confirm', agent: 'deny', desc: 'Keep a suggestion (or a list of them).', params: { suggestion: S('Suggestion id or JSON list', { required: true }) } },
  { name: 'suggestions.dismiss', method: 'POST', fn: 'lib_agent.suggestionDismiss', effect: 'confirm', agent: 'deny', desc: 'Dismiss a suggestion (or a list).', params: { suggestion: S('Suggestion id or JSON list', { required: true }) } },
];
