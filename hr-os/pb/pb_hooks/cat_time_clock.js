/**
 * Catalog: time, clocking in and out (own clock, kiosk tablets and kiosk
 * PINs, punch corrections).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const KIND = S('in | out | break_start | break_end', { enum: ['in', 'out', 'break_start', 'break_end'] });
const EMPLOYMENT = S('Employment number or id (an employee number means their primary employment)', { required: true });
const OWN = S('One of your employments when you have several (default: the primary one)');

module.exports = [
  { name: 'clock.status', method: 'GET', fn: 'lib_time_clock.clockStatus', perm: 'self', effect: 'read', desc: "The caller's clock: today's shift or work hours, punches today, state (out, in, break), the next punches allowed, worked so far, the location whose area is checked.", params: { employment: OWN } },
  {
    name: 'clock.punch',
    method: 'POST',
    fn: 'lib_time_clock.clockPunch',
    perm: 'self',
    agent: 'deny',
    effect: 'write',
    desc: 'Clock in, start or end a break, or clock out (the next one by default). Location is read only at the punch; outside the area it is flagged, never refused.',
    params: { kind: KIND, lat: N('Latitude at the punch (optional)'), lng: N('Longitude at the punch (optional)'), accuracy_m: N('Location accuracy in metres'), note: S('A note on the punch'), device: S('Short device description'), source: S('web | phone', { enum: ['web', 'phone'] }), employment: OWN },
  },
  { name: 'clock.undo', method: 'POST', fn: 'lib_time_clock.clockUndo', perm: 'self', agent: 'deny', effect: 'write', desc: 'Take back your own latest punch within five minutes of it (a wrong tap); it stays in history as taken out.', params: { punch: S('The punch to undo', { required: true }) } },
  { name: 'checkins.list', method: 'GET', fn: 'lib_time_clock.checkinsList', perm: 'signed', effect: 'read', desc: 'Punches of one person between two days (default the last 7), with source, location, area flags, corrections and taken-out punches. People see their own; managers their team; HR their entities.', params: { employment: S('Employment (default: your own)'), from: S('First day'), to: S('Last day'), voided: B('Include taken-out punches (default true)') } },
  { name: 'checkins.flagged', method: 'GET', fn: 'lib_time_clock.checkinsFlagged', perm: 'signed', effect: 'read', desc: 'Punches made outside their location area (last 14 days by default), newest first, for a look; they were never refused.', params: { entity: S('Entity'), from: S('First day'), to: S('Last day'), team: B('Only my team') } },
  {
    name: 'checkins.add',
    method: 'POST',
    fn: 'lib_time_clock.checkinsAdd',
    perm: 'signed',
    agent: 'propose',
    kind: 'time',
    preview: 'lib_time_clock.previewCheckinAdd',
    effect: 'write',
    desc: "Add a missing punch to a person's day (HR, their manager; your AI agent proposes it). The day's auto attendance is worked out again unless a person set the day by hand.",
    params: { employment: EMPLOYMENT, day: S('Day of the punch', { required: true }), time: S('Local time HH:MM', { required: true }), kind: Object.assign({}, KIND, { required: true }), note: S('Why (for example: forgot to clock out, left at 18:00)', { required: true }) },
  },
  {
    name: 'checkins.void',
    method: 'POST',
    fn: 'lib_time_clock.checkinsVoid',
    perm: 'signed',
    agent: 'propose',
    kind: 'time',
    preview: 'lib_time_clock.previewCheckinVoid',
    effect: 'write',
    desc: 'Take a wrong punch out (it stays in the history with the reason) and work the day out again.',
    params: { checkin: S('Punch id (checkins.list)', { required: true }), reason: S('Why', { required: true }) },
  },
  { name: 'kiosk.start', method: 'POST', fn: 'lib_time_clock.kioskStart', perm: 'time:edit', agent: 'deny', effect: 'write', desc: 'Start this tablet as a location\'s time clock kiosk: answers a device token, shown once, kept by the kiosk page; makes the kiosk code if missing.', params: { location: S('Location id, name or kiosk code', { required: true }), name: S('A name for the tablet, e.g. Front desk') } },
  { name: 'kiosk.devices', method: 'GET', fn: 'lib_time_clock.kioskDevices', perm: 'time:view', effect: 'read', desc: 'Kiosk tablets started at the locations, with when each was last used.', params: { location: S('Location') } },
  { name: 'kiosk.stop', method: 'POST', fn: 'lib_time_clock.kioskStop', perm: 'time:edit', agent: 'deny', effect: 'write', desc: 'Stop a kiosk tablet (it can no longer clock anyone in).', params: { device: S('Kiosk tablet id (kiosk.devices)', { required: true }) } },
  { name: 'kiosk.roster', method: 'GET', fn: 'lib_time_clock.kioskRoster', perm: 'public', agent: 'deny', effect: 'read', desc: 'The kiosk screen: the location and the people who work there today with their clock state. Needs the tablet token in the X-Kiosk-Device header.', params: { code: S('Kiosk code of the location', { required: true }), all: B('Everyone of the location\'s entity, not only this location') } },
  { name: 'kiosk.punch', method: 'POST', fn: 'lib_time_clock.kioskPunch', perm: 'public', agent: 'deny', effect: 'write', desc: 'Clock in or out at a kiosk with a personal PIN. Needs the tablet token in the X-Kiosk-Device header.', params: { code: S('Kiosk code', { required: true }), employee: S('Employee id or number', { required: true }), pin: S('Personal kiosk PIN', { required: true, secret: true }), kind: KIND } },
  { name: 'kiosk.photo', method: 'GET', fn: 'lib_time_clock.kioskPhoto', perm: 'public', agent: 'deny', effect: 'read', desc: 'A person\'s photo for the kiosk screen. Needs the tablet token in the X-Kiosk-Device header.', params: { code: S('Kiosk code', { required: true }), employee: S('Employee id', { required: true }) } },
  { name: 'kiosk.pin-set', method: 'POST', fn: 'lib_time_clock.kioskPinSet', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Set a personal kiosk PIN (4 to 6 digits): your own, or (HR with edit access to Time) anyone\'s, including people without a sign-in.', params: { employee: S('Employee (default: yourself)'), pin: S('4 to 6 digits', { required: true, secret: true }) } },
  { name: 'kiosk.pin-clear', method: 'POST', fn: 'lib_time_clock.kioskPinClear', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Remove a kiosk PIN (yours, or anyone\'s for HR).', params: { employee: S('Employee (default: yourself)') } },
  { name: 'kiosk.pin-status', method: 'GET', fn: 'lib_time_clock.kioskPinStatus', perm: 'signed', effect: 'read', desc: 'Whether a person has a kiosk PIN and whether it is locked after wrong tries.', params: { employee: S('Employee (default: yourself)') } },
];
