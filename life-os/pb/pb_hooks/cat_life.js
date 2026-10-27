/**
 * Catalog: the areas of life and their goals, the board (cards and
 * projects), habits, days and the journal.
 */
const S = (desc, o) => Object.assign({ type: 'string', desc: desc }, o || {});
const N = (desc, o) => Object.assign({ type: 'number', desc: desc }, o || {});
const B = (desc, o) => Object.assign({ type: 'boolean', desc: desc }, o || {});
const KINDS = ['health', 'money', 'relationships', 'work', 'home', 'growth', 'fun', 'mind'];
const AREA = (desc) => S(desc || 'Area of life', { enum: KINDS });
const MEASURES = ['number_up', 'number_down', 'milestones', 'tasks', 'habits', 'pot', 'books', 'weight', 'none'];
const COLUMNS = ['inbox', 'today', 'coming', 'later'];

const goalFields = {
  title: S('What the goal is'),
  area: AREA(),
  measure: S('How it measures itself: pot (a savings pot), books (books finished), weight (weigh-ins), habits, tasks, milestones, number_up / number_down (check-ins), none', { enum: MEASURES }),
  target: S('Target (an amount for pot, a number of books, a weight, a number)'),
  baseline: S('Where it starts (number goals and weight; an amount already saved for pot)'),
  unit: S('Unit for number goals, e.g. km'),
  pot: S('Savings pot id for a pot goal (a new pot is made when none is given)'),
  milestones: S('JSON list of milestone texts'),
  start_date: S('When it starts'),
  deadline: S('By when'),
  purpose: S('Why it matters'),
};

const taskFields = {
  title: S('What to do'),
  notes: S('Notes'),
  area: AREA(),
  project: S('Project id'),
  goal: S('Goal id'),
  person: S('Person id (finishing it counts as being in touch)'),
  column: S('Which list: inbox, today, coming (next 7 days), later', { enum: COLUMNS }),
  do_date: S('The day to do it (YYYY-MM-DD, today, tomorrow)'),
  due_date: S('A real deadline'),
  someday: B('Someday (in Later, no day)'),
  start_time: S('HH:MM'),
  duration_min: N('Minutes it takes'),
  stage: S('In a project: todo or doing', { enum: ['todo', 'doing'] }),
  recurrence: S('JSON {"every":1,"unit":"day|week|month","weekdays":[1,3]} or "" to stop repeating'),
  checklist: S('JSON list of checklist lines'),
  top: B("One of today's top three"),
};

module.exports = [
  /* ---------------------------------------------------------- the areas */
  { name: 'life.overview', method: 'GET', fn: 'lib_life.overview', effect: 'read', desc: 'Every area (on and off) with its pulse from its own data, and the goals across them.', params: {} },
  { name: 'life.area', method: 'GET', fn: 'lib_life.area', effect: 'read', desc: "One area's page: its pulse, goals, habits, open cards and projects.", params: { area: AREA() } },
  { name: 'areas.set', method: 'POST', fn: 'lib_life.set', effect: 'shape', agent: 'propose', preview: 'lib_life.preview', desc: 'Switch an area of life on or off. From your AI agent it waits as a proposal.', params: { area: AREA(), enabled: B('On or off') } },
  { name: 'areas.reorder', method: 'POST', fn: 'lib_life.reorder', effect: 'shape', agent: 'propose', preview: 'lib_life.preview', desc: 'Put the areas in a new order. From your AI agent it waits as a proposal.', params: { areas: S('JSON list of area kinds', { required: true }) } },

  /* -------------------------------------------------------------- goals */
  { name: 'goals.list', method: 'GET', fn: 'lib_goals.list', effect: 'read', desc: 'Goals with progress and pace (live ones by default).', params: { area: AREA(), state: S('Which', { enum: ['active', 'paused', 'done', 'dropped', 'live', 'all'] }) } },
  { name: 'goals.get', method: 'GET', fn: 'lib_goals.get', effect: 'read', desc: 'One goal with its cards, habits, projects and check-ins.', params: { goal: S('Goal id', { required: true }) } },
  { name: 'goals.create', method: 'POST', fn: 'lib_goals.create', effect: 'shape', agent: 'propose', preview: 'lib_goals.preview', desc: 'A new goal in an area. Where it can it measures itself (pot, books, weight, habits, tasks).', params: Object.assign({}, goalFields, { title: S('What the goal is', { required: true }), area: S('Area of life', { required: true, enum: KINDS }) }) },
  { name: 'goals.update', method: 'POST', fn: 'lib_goals.update', effect: 'shape', agent: 'propose', preview: 'lib_goals.preview', desc: 'Change a goal.', params: Object.assign({ goal: S('Goal id', { required: true }) }, goalFields) },
  { name: 'goals.set-state', method: 'POST', fn: 'lib_goals.setState', effect: 'shape', agent: 'propose', preview: 'lib_goals.preview', desc: 'Take a goal up, pause it, mark it done or let it go.', params: { goal: S('Goal id', { required: true }), state: S('active, paused, done or dropped', { required: true, enum: ['active', 'paused', 'done', 'dropped'] }) } },
  { name: 'goals.checkin', method: 'POST', fn: 'lib_goals.checkin', effect: 'capture', desc: 'A number for a number goal (the latest counts).', params: { goal: S('Goal id', { required: true }), value: N('The number now', { required: true }), date: S('The day'), note: S('A note') } },
  { name: 'goals.uncheckin', method: 'POST', fn: 'lib_goals.uncheckin', effect: 'capture', desc: 'Take a check-in back.', params: { checkin: S('Check-in id', { required: true }) } },
  { name: 'goals.milestone', method: 'POST', fn: 'lib_goals.milestone', effect: 'capture', desc: 'Add a milestone (--text), tick or untick one (--item, --done), or remove one (--item --remove true).', params: { goal: S('Goal id', { required: true }), text: S('A new milestone'), item: S('Milestone id'), done: B('Done or not'), remove: B('Remove it') } },
  { name: 'goals.delete', method: 'POST', fn: 'lib_goals.remove', effect: 'shape', agent: 'propose', preview: 'lib_goals.preview', destructive: true, desc: 'Delete a goal; its cards, habits and projects stay, unlinked.', params: { goal: S('Goal id', { required: true }) } },
  { name: 'goals.breakdown', method: 'POST', fn: 'lib_goals.breakdown', effect: 'shape', agent: 'propose', preview: 'lib_goals.breakdownPreview', pick: 'lib_goals.breakdownPick', desc: 'First steps for a goal in one go: cards, habits, milestones, a project.', params: { goal: S('Goal id', { required: true }), items: S('JSON list: [{"kind":"task|habit|milestone|project","title":"..", "do_date":"..", "schedule":"daily|weekdays|per_week", "times":3, "art":"run", "cue":".."}]', { required: true }) } },

  /* -------------------------------------------------------------- board */
  { name: 'board.get', method: 'GET', fn: 'lib_tasks.board', effect: 'read', desc: "The board: Inbox, Today, Coming up (next 7 days), Later and Done (last 7 days), with today's weather, minutes planned and events.", params: { area: AREA() } },
  { name: 'board.week', method: 'GET', fn: 'lib_tasks.week', effect: 'read', desc: 'Seven days with their cards, calendar events, plans and weather, and the inbox: the next seven from today, from --start, or the calendar week around --date.', params: { start: S('First of the seven days (default today)'), date: S('A day in the calendar week to show instead') } },
  { name: 'board.plan', method: 'POST', fn: 'lib_tasks.plan', effect: 'plan', agent: 'propose', preview: 'lib_tasks.planPreview', pick: 'lib_tasks.planPick', desc: 'A plan for the day in one step: card moves, today\'s top three, new cards, a note on Home.', params: { moves: S('JSON list [{"task":"<id>","column":"today|coming|inbox|later","do_date":"YYYY-MM-DD"}]'), top: S('JSON list of card ids to star'), new_tasks: S('JSON list [{"title":"..","column":"today","area":"family"}]'), note: S('A note for Home') } },
  { name: 'tasks.list', method: 'GET', fn: 'lib_tasks.list', effect: 'read', desc: 'Cards by list or filter.', params: { column: S('Which list', { enum: ['inbox', 'today', 'coming', 'later', 'done', 'open', 'all'] }), area: AREA(), project: S('Project id'), goal: S('Goal id'), person: S('Person id'), q: S('Words'), limit: N('How many'), offset: N('Skip') } },
  { name: 'tasks.get', method: 'GET', fn: 'lib_tasks.get', effect: 'read', desc: 'One card with its history.', params: { task: S('Card id', { required: true }) } },
  { name: 'tasks.create', method: 'POST', fn: 'lib_tasks.create', effect: 'capture', desc: 'A new card.', params: Object.assign({}, taskFields, { title: S('What to do', { required: true }) }) },
  { name: 'tasks.add-many', method: 'POST', fn: 'lib_tasks.addMany', effect: 'capture', desc: 'Several cards in one call (one batch; activity.undo --batch takes them all back).', params: { items: S('JSON list of 1 to 20 cards, each with title and any of notes, area, project, goal, person, column, do_date, due_date, someday, start_time, duration_min, top', { required: true }) } },
  { name: 'tasks.update', method: 'POST', fn: 'lib_tasks.update', effect: 'capture', desc: 'Change a card.', params: Object.assign({ task: S('Card id', { required: true }) }, taskFields) },
  { name: 'tasks.move', method: 'POST', fn: 'lib_tasks.move', effect: 'plan', desc: 'Drop a card in a list (its day follows: today, tomorrow for Coming up, none for Inbox and Later), with the new order of that list.', params: { task: S('Card id', { required: true }), column: S('The list', { required: true, enum: ['inbox', 'today', 'coming', 'later', 'done'] }), do_date: S('An exact day instead'), order: S('JSON list of the card ids in that list, in order') } },
  { name: 'tasks.complete', method: 'POST', fn: 'lib_tasks.complete', effect: 'capture', desc: 'Done (or --done false to open again). A repeating card makes its next one.', params: { task: S('Card id', { required: true }), done: B('Done or not') } },
  { name: 'tasks.top', method: 'POST', fn: 'lib_tasks.top', effect: 'plan', desc: "Star a card as one of today's top three (or not).", params: { task: S('Card id', { required: true }), top: B('Starred or not') } },
  { name: 'tasks.check', method: 'POST', fn: 'lib_tasks.check', effect: 'capture', desc: 'Checklist: add a line (--text), tick or untick (--item, --done), rename (--item --text), remove (--item --remove true).', params: { task: S('Card id', { required: true }), item: S('Line id'), text: S('Text'), done: B('Done or not'), remove: B('Remove it') } },
  { name: 'tasks.reorder', method: 'POST', fn: 'lib_tasks.reorder', effect: 'plan', desc: 'Cards in a new order.', params: { tasks: S('JSON list of card ids', { required: true }) } },
  { name: 'tasks.delete', method: 'POST', fn: 'lib_tasks.remove', effect: 'capture', destructive: true, desc: 'Delete a card.', params: { task: S('Card id', { required: true }) } },

  { name: 'projects.list', method: 'GET', fn: 'lib_tasks.projectList', effect: 'read', desc: 'Projects with their steps and progress.', params: { state: S('Which', { enum: ['active', 'someday', 'done', 'dropped', 'all'] }), area: AREA() } },
  { name: 'projects.get', method: 'GET', fn: 'lib_tasks.projectGet', effect: 'read', desc: 'One project with its steps to do, doing and done.', params: { project: S('Project id', { required: true }) } },
  { name: 'projects.create', method: 'POST', fn: 'lib_tasks.projectCreate', effect: 'shape', agent: 'propose', preview: 'lib_tasks.preview', desc: 'A new project.', params: { title: S('Project', { required: true }), area: AREA(), goal: S('Goal id it serves'), deadline: S('By when'), notes: S('Notes'), look: N('Cover 0 to 7') } },
  { name: 'projects.update', method: 'POST', fn: 'lib_tasks.projectUpdate', effect: 'shape', agent: 'propose', preview: 'lib_tasks.preview', desc: 'Change a project.', params: { project: S('Project id', { required: true }), title: S('Title'), area: AREA(), goal: S('Goal id'), deadline: S('By when'), notes: S('Notes'), look: N('Cover 0 to 7') } },
  { name: 'projects.set-state', method: 'POST', fn: 'lib_tasks.projectSetState', effect: 'shape', agent: 'propose', preview: 'lib_tasks.preview', desc: 'Active, someday, done or dropped.', params: { project: S('Project id', { required: true }), state: S('The state', { required: true, enum: ['active', 'someday', 'done', 'dropped'] }) } },
  { name: 'projects.reorder', method: 'POST', fn: 'lib_tasks.projectReorder', effect: 'plan', desc: 'Projects in a new order.', params: { projects: S('JSON list of project ids', { required: true }) } },
  { name: 'projects.delete', method: 'POST', fn: 'lib_tasks.projectRemove', effect: 'shape', agent: 'propose', preview: 'lib_tasks.preview', destructive: true, desc: 'Delete a project; its steps stay as cards unless --with_tasks true.', params: { project: S('Project id', { required: true }), with_tasks: B('Delete its steps too') } },

  /* ------------------------------------------------------------- habits */
  { name: 'habits.list', method: 'GET', fn: 'lib_habits.list', effect: 'read', desc: 'Habits with today, the streak, the best streak, the 30-day rate and the last 14 days.', params: { area: AREA(), archived: B('Archived ones'), date: S('As of this day') } },
  { name: 'habits.get', method: 'GET', fn: 'lib_habits.get', effect: 'read', desc: 'One habit with its days (the last year, or --days) and notes.', params: { habit: S('Habit id', { required: true }), days: N('How many days back, 7 to 365 (365)') } },
  { name: 'habits.create', method: 'POST', fn: 'lib_habits.create', effect: 'shape', agent: 'propose', preview: 'lib_habits.preview', desc: 'A new habit.', params: { name: S('The habit', { required: true }), art: S('Its drawing (app.guide --part arts)'), area: AREA(), goal: S('Goal id'), schedule: S('daily, weekdays or per_week', { enum: ['daily', 'weekdays', 'per_week'] }), days: S('JSON weekdays for weekdays (0 Sunday)'), times: N('Times a week for per_week'), target: N('How many a day for a counted habit (e.g. 8 glasses)'), unit: S('Unit for a counted habit'), time_of_day: S('morning, afternoon, evening or anytime', { enum: ['morning', 'afternoon', 'evening', 'anytime'] }), cue: S('When it happens, e.g. After morning coffee'), source: S('Counts itself from the body log: water (glasses) or mind_min (calm minutes); empty to stop', { enum: ['water', 'mind_min', ''] }), started_on: S('Start day') } },
  { name: 'habits.update', method: 'POST', fn: 'lib_habits.update', effect: 'shape', agent: 'propose', preview: 'lib_habits.preview', desc: 'Change a habit (or archive it with --archived true).', params: { habit: S('Habit id', { required: true }), name: S('Name'), art: S('Drawing'), area: AREA(), goal: S('Goal id'), schedule: S('Schedule', { enum: ['daily', 'weekdays', 'per_week'] }), days: S('JSON weekdays'), times: N('Times a week'), target: N('How many a day'), unit: S('Unit'), time_of_day: S('Time of day', { enum: ['morning', 'afternoon', 'evening', 'anytime'] }), cue: S('Cue'), source: S('Counts itself from the body log: water (glasses) or mind_min (calm minutes); empty to stop', { enum: ['water', 'mind_min', ''] }), archived: B('Archived') } },
  { name: 'habits.reorder', method: 'POST', fn: 'lib_habits.reorder', effect: 'plan', desc: 'Habits in a new order.', params: { habits: S('JSON list of habit ids', { required: true }) } },
  { name: 'habits.tap', method: 'POST', fn: 'lib_habits.tap', effect: 'capture', desc: 'The one-tap log: a check habit flips done; a counted one adds one.', params: { habit: S('Habit id', { required: true }), date: S('The day (today by default)') } },
  { name: 'habits.log', method: 'POST', fn: 'lib_habits.log', effect: 'capture', desc: 'Set a day exactly: done (default), skipped, a value, --add n, a note.', params: { habit: S('Habit id', { required: true }), date: S('The day'), state: S('done or skipped', { enum: ['done', 'skipped'] }), value: N('The count'), add: N('Add to the count'), note: S('A note') } },
  { name: 'habits.unlog', method: 'POST', fn: 'lib_habits.unlog', effect: 'capture', desc: 'Clear a day.', params: { habit: S('Habit id', { required: true }), date: S('The day') } },
  { name: 'habits.delete', method: 'POST', fn: 'lib_habits.remove', effect: 'shape', agent: 'propose', preview: 'lib_habits.preview', destructive: true, desc: 'Delete a habit and its logged days.', params: { habit: S('Habit id', { required: true }) } },

  /* -------------------------------------------------------- days, journal */
  { name: 'days.get', method: 'GET', fn: 'lib_days.get', effect: 'read', desc: "A day's mood, energy and your AI agent's note.", params: { date: S('The day') } },
  { name: 'days.month', method: 'GET', fn: 'lib_days.month', effect: 'read', desc: 'Every day of a month: mood, cards done, habits done, journal, movement, events.', params: { month: S('YYYY-MM') } },
  { name: 'days.mood', method: 'POST', fn: 'lib_days.mood', effect: 'reflect', agent: 'deny', desc: 'How the day feels (the person only).', params: { date: S('The day'), mood: N('1 to 5 (0 clears)'), energy: N('1 to 5 (0 clears)') } },
  { name: 'days.note', method: 'POST', fn: 'lib_days.note', effect: 'capture', desc: "Your AI agent's note for the day on Home (empty text clears it).", params: { text: S('The note'), date: S('The day') } },
  { name: 'journal.list', method: 'GET', fn: 'lib_journal.list', effect: 'read', desc: 'Journal entries, newest first. Your AI agent sees only shared ones, plus private_days: the days with a private page (never their words).', params: { from: S('From'), to: S('To'), tag: AREA('An area'), photos: B('Only with photos'), q: S('Words'), limit: N('How many'), offset: N('Skip') } },
  { name: 'journal.get', method: 'GET', fn: 'lib_journal.get', effect: 'read', desc: 'One entry.', params: { entry: S('Entry id', { required: true }) } },
  { name: 'journal.write', method: 'POST', fn: 'lib_journal.write', effect: 'reflect', agent: 'deny', files: ['photo'], bodyLimit: 16777216, desc: 'Write (the person only): the first save makes the entry, later saves (with --entry) update it.', params: { entry: S('Entry id (to update)'), date: S('The day'), body: S('The writing'), mood: N('1 to 5'), tags: S('JSON list of areas'), privacy: S('private or shared_with_agent', { enum: ['private', 'shared_with_agent'] }), remove_photo: B('Remove the photo') } },
  { name: 'journal.delete', method: 'POST', fn: 'lib_journal.remove', effect: 'reflect', agent: 'deny', destructive: true, desc: 'Delete an entry (the person only).', params: { entry: S('Entry id', { required: true }) } },
  { name: 'journal.photo', method: 'GET', fn: 'lib_journal.photo', effect: 'read', desc: "An entry's photo (your AI agent gets its path on disk, for shared entries).", params: { entry: S('Entry id', { required: true }), v: S('Cache key') } },
  { name: 'journal.memories', method: 'GET', fn: 'lib_journal.memories', effect: 'read', desc: 'Entries from this day in earlier months and years.', params: { date: S('The day') } },
  { name: 'journal.heat', method: 'GET', fn: 'lib_journal.heat', effect: 'read', desc: 'How much was written each day (the last year, or --days), and the writing streak.', params: { days: N('How many days back, 7 to 365 (365)') } },
  { name: 'recap.week', method: 'GET', fn: 'lib_journal.recap', effect: 'read', desc: "A week in numbers, the mood by day, wins, goals that moved, and your AI agent's paragraph.", params: { date: S('A day in the week') } },
  { name: 'recap.write', method: 'POST', fn: 'lib_journal.recapWrite', effect: 'capture', desc: "Your AI agent's paragraph for a week's recap (empty text clears it).", params: { date: S('A day in the week'), text: S('The paragraph') } },
];
