/**
 * Catalog: the tools of each area of life. People (partner, family and
 * friends), health, money, growth, fun, home and work.
 */
const S = (desc, o) => Object.assign({ type: 'string', desc: desc }, o || {});
const N = (desc, o) => Object.assign({ type: 'number', desc: desc }, o || {});
const B = (desc, o) => Object.assign({ type: 'boolean', desc: desc }, o || {});
const KINDS = ['health', 'money', 'relationships', 'work', 'home', 'growth', 'fun', 'mind'];
const AREA = (desc) => S(desc || 'Area of life', { enum: KINDS });
const CIRCLES = ['partner', 'friends', 'family'];
const SPEND = ['food', 'groceries', 'transport', 'home', 'bills', 'fun', 'health', 'shopping', 'gifts', 'other', 'salary', 'extra'];

const personFields = { name: S('Name'), circle: S('partner, friends or family', { enum: CIRCLES }), relation: S('e.g. Mum, best friend'), birthday: S('MM-DD, or YYYY-MM-DD when the year is known'), keep_in_touch_days: N('Every how many days to be in touch (0 for no nudge)'), notes: S('Notes'), look: N('Their little face (a number)'), archived: B('Archived') };

module.exports = [
  /* ------------------------------------------------------------- people */
  { name: 'people.list', method: 'GET', fn: 'lib_people.list', effect: 'read', desc: 'People (one circle or one area), with last contact, keep-in-touch due and the next birthday.', params: { circle: S('Circle', { enum: CIRCLES }), area: AREA(), archived: B('Archived ones') } },
  { name: 'people.get', method: 'GET', fn: 'lib_people.get', effect: 'read', desc: 'One person with the times you were in touch, plans with them and cards about them.', params: { person: S('Person id', { required: true }) } },
  { name: 'people.reach', method: 'GET', fn: 'lib_people.reach', effect: 'read', desc: 'Who to reach out to (most overdue first) and birthdays in the next days.', params: { days: N('Birthdays within this many days') } },
  { name: 'people.create', method: 'POST', fn: 'lib_people.create', effect: 'shape', agent: 'propose', preview: 'lib_people.preview', desc: 'Add a person (--links: the people they know, joined on the connection map).', params: Object.assign({}, personFields, { name: S('Name', { required: true }), links: S('Ids of people they know (JSON list or comma separated)') }) },
  { name: 'people.update', method: 'POST', fn: 'lib_people.update', effect: 'shape', agent: 'propose', preview: 'lib_people.preview', desc: 'Change a person.', params: Object.assign({ person: S('Person id', { required: true }) }, personFields) },
  { name: 'people.link', method: 'POST', fn: 'lib_people.link', effect: 'capture', desc: 'Connect two people on the connection map (they know each other), or take the line away with --linked false.', params: { person: S('Person id', { required: true }), other: S('The other person id', { required: true }), linked: B('true to connect (default), false to take the line away') } },
  { name: 'people.touch', method: 'POST', fn: 'lib_people.touch', effect: 'capture', desc: 'You were in touch with someone (today by default).', params: { person: S('Person id', { required: true }), kind: S('talk, message, meet, gift or other', { enum: ['talk', 'message', 'meet', 'gift', 'other'] }), date: S('The day'), note: S('A note') } },
  { name: 'people.untouch', method: 'POST', fn: 'lib_people.untouch', effect: 'capture', desc: 'Take a note of being in touch back.', params: { interaction: S('Interaction id', { required: true }) } },
  { name: 'people.delete', method: 'POST', fn: 'lib_people.remove', effect: 'shape', agent: 'propose', preview: 'lib_people.preview', destructive: true, desc: 'Remove a person and their history.', params: { person: S('Person id', { required: true }) } },
  { name: 'events.list', method: 'GET', fn: 'lib_people.eventList', effect: 'read', desc: 'Plans (family dinners, meetups, birthdays out) from today on.', params: { from: S('From'), to: S('To'), area: AREA() } },
  { name: 'events.create', method: 'POST', fn: 'lib_people.eventCreate', effect: 'capture', desc: 'A plan on a day, in an area, maybe with someone.', params: { title: S('What', { required: true }), date: S('The day', { required: true }), time: S('HH:MM'), area: S('Area of life', { required: true, enum: KINDS }), place: S('Where'), person: S('Person id') } },
  { name: 'events.update', method: 'POST', fn: 'lib_people.eventUpdate', effect: 'capture', desc: 'Change a plan.', params: { event: S('Plan id', { required: true }), title: S('What'), date: S('The day'), time: S('HH:MM'), area: AREA(), place: S('Where'), person: S('Person id') } },
  { name: 'events.delete', method: 'POST', fn: 'lib_people.eventRemove', effect: 'capture', destructive: true, desc: 'Delete a plan.', params: { event: S('Plan id', { required: true }) } },

  /* ------------------------------------------------------------- health */
  { name: 'health.day', method: 'GET', fn: 'lib_health.day', effect: 'read', desc: "A day's body log (water, sleep, steps, weight, calm minutes), its workouts and the daily goals.", params: { date: S('The day') } },
  { name: 'health.log', method: 'POST', fn: 'lib_health.log', effect: 'capture', desc: 'Log the body: set water, sleep_h, steps, weight, mind_min, or add with add_water / add_mind.', params: { date: S('The day'), water: N('Glasses'), add_water: N('Glasses to add (minus to take off)'), sleep_h: N('Hours slept'), steps: N('Steps'), weight: N('Weight (kg or lb, by units)'), mind_min: N('Calm minutes'), add_mind: N('Calm minutes to add') } },
  { name: 'health.trend', method: 'GET', fn: 'lib_health.trend', effect: 'read', desc: 'The last days, day by day, with averages (for the charts).', params: { days: N('How many days (7 to 400)'), to: S('Last day') } },
  { name: 'workouts.list', method: 'GET', fn: 'lib_health.workoutList', effect: 'read', desc: 'Workouts between two days.', params: { from: S('From'), to: S('To') } },
  { name: 'workouts.add', method: 'POST', fn: 'lib_health.workoutAdd', effect: 'capture', desc: 'A workout.', params: { kind: S('walk, run, gym, yoga, bike, swim, sport or dance', { required: true, enum: ['walk', 'run', 'gym', 'yoga', 'bike', 'swim', 'sport', 'dance'] }), minutes: N('Minutes', { required: true }), date: S('The day'), note: S('A note') } },
  { name: 'workouts.update', method: 'POST', fn: 'lib_health.workoutUpdate', effect: 'capture', desc: 'Change a workout.', params: { workout: S('Workout id', { required: true }), kind: S('Kind', { enum: ['walk', 'run', 'gym', 'yoga', 'bike', 'swim', 'sport', 'dance'] }), minutes: N('Minutes'), date: S('The day'), note: S('A note') } },
  { name: 'workouts.delete', method: 'POST', fn: 'lib_health.workoutRemove', effect: 'capture', destructive: true, desc: 'Delete a workout.', params: { workout: S('Workout id', { required: true }) } },

  /* -------------------------------------------------------------- money */
  { name: 'money.month', method: 'GET', fn: 'lib_money.month', effect: 'read', desc: 'A month at a glance: spent, income, budget, left per day, by category, day by day, entries, bills and pots.', params: { month: S('YYYY-MM') } },
  { name: 'money.entries', method: 'GET', fn: 'lib_money.entryList', effect: 'read', desc: 'Money entries between two days.', params: { from: S('From'), to: S('To'), category: S('Category', { enum: SPEND }), limit: N('How many') } },
  { name: 'money.add', method: 'POST', fn: 'lib_money.entryAdd', effect: 'capture', desc: 'Money out (spend) or in (income).', params: { amount: S('Amount, e.g. 12.50', { required: true }), kind: S('spend or income', { enum: ['spend', 'income'] }), category: S('Category', { enum: SPEND }), date: S('The day'), note: S('What it was') } },
  { name: 'money.update', method: 'POST', fn: 'lib_money.entryUpdate', effect: 'capture', desc: 'Change an entry.', params: { entry: S('Entry id', { required: true }), amount: S('Amount'), kind: S('spend or income', { enum: ['spend', 'income'] }), category: S('Category', { enum: SPEND }), date: S('The day'), note: S('What it was') } },
  { name: 'money.delete', method: 'POST', fn: 'lib_money.entryRemove', effect: 'capture', destructive: true, desc: 'Delete an entry.', params: { entry: S('Entry id', { required: true }) } },
  { name: 'pots.list', method: 'GET', fn: 'lib_money.potList', effect: 'read', desc: 'Savings pots.', params: {} },
  { name: 'pots.create', method: 'POST', fn: 'lib_money.potCreate', effect: 'capture', desc: 'A savings pot.', params: { name: S('Name', { required: true }), target: S('Target amount'), saved: S('Already saved'), look: N('Jar 0 to 7') } },
  { name: 'pots.update', method: 'POST', fn: 'lib_money.potUpdate', effect: 'capture', desc: 'Change a pot.', params: { pot: S('Pot id', { required: true }), name: S('Name'), target: S('Target'), saved: S('Saved'), look: N('Jar 0 to 7') } },
  { name: 'pots.add', method: 'POST', fn: 'lib_money.potAdd', effect: 'capture', desc: 'Put money in a pot (or take some out with --take true).', params: { pot: S('Pot id', { required: true }), amount: S('Amount', { required: true }), take: B('Take out instead') } },
  { name: 'pots.delete', method: 'POST', fn: 'lib_money.potRemove', effect: 'capture', destructive: true, desc: 'Delete a pot.', params: { pot: S('Pot id', { required: true }) } },
  { name: 'bills.list', method: 'GET', fn: 'lib_money.billList', effect: 'read', desc: "Bills with this month's due day and whether paid.", params: {} },
  { name: 'bills.create', method: 'POST', fn: 'lib_money.billCreate', effect: 'capture', desc: 'A monthly bill.', params: { name: S('Name', { required: true }), amount: S('Amount'), due_day: N('Day of the month it is due', { required: true }), category: S('Category', { enum: ['home', 'bills', 'transport', 'health', 'fun', 'shopping', 'other'] }) } },
  { name: 'bills.update', method: 'POST', fn: 'lib_money.billUpdate', effect: 'capture', desc: 'Change a bill (or stop it with --active false).', params: { bill: S('Bill id', { required: true }), name: S('Name'), amount: S('Amount'), due_day: N('Due day'), category: S('Category', { enum: ['home', 'bills', 'transport', 'health', 'fun', 'shopping', 'other'] }), active: B('Still coming') } },
  { name: 'bills.pay', method: 'POST', fn: 'lib_money.billPay', effect: 'capture', desc: "This month's bill is paid (noted as a spend unless --record false; --paid false unmarks).", params: { bill: S('Bill id', { required: true }), paid: B('Paid or not'), record: B('Note it as a spend') } },
  { name: 'bills.delete', method: 'POST', fn: 'lib_money.billRemove', effect: 'capture', destructive: true, desc: 'Delete a bill.', params: { bill: S('Bill id', { required: true }) } },

  /* ------------------------------------------------------------- growth */
  { name: 'books.shelf', method: 'GET', fn: 'lib_growth.shelf', effect: 'read', desc: 'The bookshelf: reading, want to read, read, and how many this year.', params: {} },
  { name: 'books.list', method: 'GET', fn: 'lib_growth.bookList', effect: 'read', desc: 'Books.', params: { status: S('want, reading or done', { enum: ['want', 'reading', 'done'] }) } },
  { name: 'books.add', method: 'POST', fn: 'lib_growth.bookAdd', effect: 'capture', desc: 'A book.', params: { title: S('Title', { required: true }), author: S('Author'), status: S('want, reading or done', { enum: ['want', 'reading', 'done'] }), pages: N('Pages'), page: N('Page you are on'), look: N('Spine 0 to 7') } },
  { name: 'books.update', method: 'POST', fn: 'lib_growth.bookUpdate', effect: 'capture', desc: 'Change a book (the page you are on finishes it at the last page).', params: { book: S('Book id', { required: true }), title: S('Title'), author: S('Author'), status: S('Status', { enum: ['want', 'reading', 'done'] }), pages: N('Pages'), page: N('Page'), rating: N('0 to 5'), finished_on: S('Day finished') } },
  { name: 'books.delete', method: 'POST', fn: 'lib_growth.bookRemove', effect: 'capture', destructive: true, desc: 'Delete a book.', params: { book: S('Book id', { required: true }) } },
  { name: 'learning.list', method: 'GET', fn: 'lib_growth.learningList', effect: 'read', desc: 'What is being learned.', params: {} },
  { name: 'learning.add', method: 'POST', fn: 'lib_growth.learningAdd', effect: 'capture', desc: 'Something to learn.', params: { name: S('What', { required: true }), kind: S('course, skill or language', { enum: ['course', 'skill', 'language'] }), progress: N('0 to 100'), note: S('A note') } },
  { name: 'learning.update', method: 'POST', fn: 'lib_growth.learningUpdate', effect: 'capture', desc: 'Change it.', params: { item: S('Item id', { required: true }), name: S('What'), kind: S('Kind', { enum: ['course', 'skill', 'language'] }), progress: N('0 to 100'), note: S('A note'), archived: B('Archived') } },
  { name: 'learning.practice', method: 'POST', fn: 'lib_growth.practice', effect: 'capture', desc: 'Practised (today by default); minutes add up.', params: { item: S('Item id', { required: true }), minutes: N('Minutes'), progress: N('Progress now, 0 to 100'), date: S('The day') } },
  { name: 'learning.delete', method: 'POST', fn: 'lib_growth.learningRemove', effect: 'capture', destructive: true, desc: 'Delete it.', params: { item: S('Item id', { required: true }) } },

  /* ---------------------------------------------------------------- fun */
  { name: 'bucket.list', method: 'GET', fn: 'lib_fun.bucketList', effect: 'read', desc: 'The bucket list.', params: {} },
  { name: 'bucket.add', method: 'POST', fn: 'lib_fun.bucketAdd', effect: 'capture', desc: 'Something for the bucket list.', params: { title: S('What', { required: true }), kind: S('place, experience, skill, food or other', { enum: ['place', 'experience', 'skill', 'food', 'other'] }), note: S('A note') } },
  { name: 'bucket.update', method: 'POST', fn: 'lib_fun.bucketUpdate', effect: 'capture', desc: 'Change it, or tick it off with --done true.', params: { item: S('Item id', { required: true }), title: S('What'), kind: S('Kind', { enum: ['place', 'experience', 'skill', 'food', 'other'] }), note: S('A note'), done: B('Done'), date: S('The day it happened') } },
  { name: 'bucket.delete', method: 'POST', fn: 'lib_fun.bucketRemove', effect: 'capture', destructive: true, desc: 'Delete it.', params: { item: S('Item id', { required: true }) } },
  { name: 'trips.list', method: 'GET', fn: 'lib_fun.tripList', effect: 'read', desc: 'Trips with countdowns and packing lists.', params: {} },
  { name: 'trips.add', method: 'POST', fn: 'lib_fun.tripAdd', effect: 'capture', desc: 'A trip. Its packing list starts with the basics (passport, chargers, toothbrush, clothes) plus --packing.', params: { title: S('Trip', { required: true }), place: S('Where'), start_date: S('Leaving'), end_date: S('Back'), packing: S('More to pack: a JSON list, or one per line') } },
  { name: 'trips.update', method: 'POST', fn: 'lib_fun.tripUpdate', effect: 'capture', desc: 'Change a trip.', params: { trip: S('Trip id', { required: true }), title: S('Trip'), place: S('Where'), start_date: S('Leaving'), end_date: S('Back'), notes: S('Notes') } },
  { name: 'trips.pack', method: 'POST', fn: 'lib_fun.pack', effect: 'capture', desc: 'Packing list: add things (--text, one per line or a JSON list), or for one line (--item) exactly one of: --done true|false, --text (rename), --remove true.', params: { trip: S('Trip id', { required: true }), text: S('Things to add (one per line), or the new name with --item'), item: S('Line id (trips.list shows them)'), done: B('Packed or not'), remove: B('Take the line off') } },
  { name: 'trips.delete', method: 'POST', fn: 'lib_fun.tripRemove', effect: 'capture', destructive: true, desc: 'Delete a trip.', params: { trip: S('Trip id', { required: true }) } },

  /* --------------------------------------------------------------- home */
  { name: 'chores.list', method: 'GET', fn: 'lib_house.choreList', effect: 'read', desc: 'Chores, the ones due first.', params: {} },
  { name: 'chores.add', method: 'POST', fn: 'lib_house.choreAdd', effect: 'capture', desc: 'A chore that comes round.', params: { name: S('What', { required: true }), room: S('Room', { enum: ['kitchen', 'bathroom', 'living', 'bedroom', 'laundry', 'outside', 'other'] }), every_days: N('Every how many days'), last_done: S('Last done') } },
  { name: 'chores.update', method: 'POST', fn: 'lib_house.choreUpdate', effect: 'capture', desc: 'Change a chore.', params: { chore: S('Chore id', { required: true }), name: S('What'), room: S('Room', { enum: ['kitchen', 'bathroom', 'living', 'bedroom', 'laundry', 'outside', 'other'] }), every_days: N('Every how many days'), last_done: S('Last done') } },
  { name: 'chores.done', method: 'POST', fn: 'lib_house.choreDone', effect: 'capture', desc: 'Done today (or --date); --done false clears it.', params: { chore: S('Chore id', { required: true }), date: S('The day'), done: B('Done or not') } },
  { name: 'chores.delete', method: 'POST', fn: 'lib_house.choreRemove', effect: 'capture', destructive: true, desc: 'Delete a chore.', params: { chore: S('Chore id', { required: true }) } },
  { name: 'shopping.list', method: 'GET', fn: 'lib_house.shopList', effect: 'read', desc: 'The shopping list.', params: {} },
  { name: 'shopping.add', method: 'POST', fn: 'lib_house.shopAdd', effect: 'capture', desc: 'Things to buy (one per line).', params: { text: S('What to buy', { required: true }) } },
  { name: 'shopping.check', method: 'POST', fn: 'lib_house.shopCheck', effect: 'capture', desc: 'Bought (or not).', params: { item: S('Item id', { required: true }), done: B('Bought') } },
  { name: 'shopping.update', method: 'POST', fn: 'lib_house.shopUpdate', effect: 'capture', desc: 'Rename an item.', params: { item: S('Item id', { required: true }), text: S('Text') } },
  { name: 'shopping.clear', method: 'POST', fn: 'lib_house.shopClear', effect: 'capture', desc: 'Take the bought things off the list.', params: {} },
  { name: 'shopping.delete', method: 'POST', fn: 'lib_house.shopRemove', effect: 'capture', destructive: true, desc: 'Delete an item.', params: { item: S('Item id', { required: true }) } },

  /* --------------------------------------------------------------- work */
  { name: 'focus.week', method: 'GET', fn: 'lib_focus.week', effect: 'read', desc: 'Minutes of focus day by day this week.', params: { date: S('A day in the week') } },
  { name: 'focus.list', method: 'GET', fn: 'lib_focus.sessionList', effect: 'read', desc: 'Focus sessions.', params: { from: S('From'), to: S('To') } },
  { name: 'focus.log', method: 'POST', fn: 'lib_focus.sessionAdd', effect: 'capture', desc: 'A focus session (the timer logs one when it rings).', params: { minutes: N('Minutes', { required: true }), date: S('The day'), task: S('Card id it was for'), note: S('A note') } },
  { name: 'focus.delete', method: 'POST', fn: 'lib_focus.sessionRemove', effect: 'capture', destructive: true, desc: 'Delete a session.', params: { session: S('Session id', { required: true }) } },
  { name: 'wins.list', method: 'GET', fn: 'lib_focus.winList', effect: 'read', desc: 'Wins, newest first.', params: { area: AREA(), limit: N('How many') } },
  { name: 'wins.add', method: 'POST', fn: 'lib_focus.winAdd', effect: 'capture', desc: 'A win, in a line.', params: { text: S('The win', { required: true }), date: S('The day'), area: AREA() } },
  { name: 'wins.update', method: 'POST', fn: 'lib_focus.winUpdate', effect: 'capture', desc: 'Change a win.', params: { win: S('Win id', { required: true }), text: S('The win'), date: S('The day'), area: AREA() } },
  { name: 'wins.delete', method: 'POST', fn: 'lib_focus.winRemove', effect: 'capture', destructive: true, desc: 'Delete a win.', params: { win: S('Win id', { required: true }) } },
];
