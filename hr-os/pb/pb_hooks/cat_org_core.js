/**
 * Catalog: organisation (entities, locations, departments, job titles,
 * grades, cost centres, employment types, holiday calendars, work schedules).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const ORG = 'people:full';
const CAL = 'people:full|time:full';

const ENTITY_FIELDS = {
  name: S('Entity name, e.g. Northwind Pte Ltd'),
  code: S('Short code, e.g. SG01'),
  legal_name: S('Registered legal name'),
  region: S('Region code (state, prefecture), e.g. CA, 13, MH'),
  currency: S('Pay currency (default: the country currency)'),
  timezone: S('IANA time zone (default: the country one)'),
  fiscal_year_start: S('MM-DD, e.g. 04-01'),
  week_start: N('First day of the week, 0 = Sunday'),
  tax_ids: S('JSON {label: value}, e.g. {"UEN":"201912345K"}'),
  address: S('JSON {line1, line2, city, region, postcode, country}'),
  registration: S('JSON of registration details'),
  packs: S('JSON list of statutory pack codes'),
  bank: S('JSON employer bank details for bank files'),
  default_calendar: S('Holiday calendar code or id'),
  default_schedule: S('Work schedule name or id'),
  default_pay_schedule: S('Pay schedule id (payroll)'),
  default_leave_policy: S('Leave policy id (leave)'),
  default_onboarding_template: S('Onboarding template id (lifecycle)'),
  active: B('In use'),
};

const ARCH = { archived: B('Archived (hidden from lists, kept on history)') };

module.exports = [
  { name: 'entities.list', method: 'GET', fn: 'lib_org.entitiesList', perm: 'signed', effect: 'read', desc: 'Legal entities the caller may see (country, currency, time zone, fiscal year, packs, people count).', params: { all: B('Include inactive ones') } },
  { name: 'entities.get', method: 'GET', fn: 'lib_org.entitiesGet', perm: 'signed', effect: 'read', desc: 'One entity with its locations and departments.', params: { entity: S('Entity id or name', { required: true }) } },
  { name: 'entities.add', method: 'POST', fn: 'lib_org.entitiesAdd', perm: 'admin:full', agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a legal entity in a country: seeds its public holidays, a standard work week, employment types and statutory packs; modules seed theirs (leave types, pay components).', params: Object.assign({}, ENTITY_FIELDS, { name: S('Entity name', { required: true }), country: S('Country code, e.g. JP', { required: true }) }) },
  { name: 'entities.update', method: 'POST', fn: 'lib_org.entitiesUpdate', perm: 'admin:full', agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'entities', id: 'entity', fields: { name: 'name', code: 'code', legal_name: 'legal_name', region: 'region', timezone: 'timezone', fiscal_year_start: 'fiscal_year_start', active: 'active' } }, desc: 'Change an entity (the currency is fixed once people are paid in it).', params: Object.assign({ entity: S('Entity id or name', { required: true }) }, ENTITY_FIELDS) },

  { name: 'locations.list', method: 'GET', fn: 'lib_org.locationsList', perm: 'signed', effect: 'read', desc: 'Locations (branches, sites) with address, geofence, calendar and kiosk code.', params: Object.assign({ entity: S('Entity id or name') }, ARCH) },
  { name: 'locations.add', method: 'POST', fn: 'lib_org.locationsAdd', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a location of an entity.', params: { entity: S('Entity id or name', { required: true }), name: S('Name', { required: true }), address: S('JSON address'), country: S('Country code (default: the entity one)'), region: S('Region code'), timezone: S('IANA time zone'), lat: N('Latitude'), lng: N('Longitude'), radius_m: N('Geofence radius in metres'), calendar: S('Holiday calendar code or id') } },
  { name: 'locations.update', method: 'POST', fn: 'lib_org.locationsUpdate', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'locations', id: 'location', fields: { name: 'name', region: 'region', timezone: 'timezone', radius_m: 'radius_m', archived: 'archived' } }, desc: 'Change a location.', params: Object.assign({ location: S('Location id or name', { required: true }), name: S('Name'), address: S('JSON address'), country: S('Country code'), region: S('Region code'), timezone: S('IANA time zone'), lat: N('Latitude'), lng: N('Longitude'), radius_m: N('Geofence radius in metres'), calendar: S('Holiday calendar code or id') }, ARCH) },
  { name: 'locations.delete', method: 'POST', fn: 'lib_org.locationsDelete', perm: ORG, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a location nobody uses (else archive it).', params: { location: S('Location id or name', { required: true }) } },
  { name: 'locations.kiosk-code', method: 'POST', fn: 'lib_org.locationsKiosk', perm: 'people:full|time:full', agent: 'deny', effect: 'write', desc: 'A new kiosk code for the time clock at a location (the old one stops working).', params: { location: S('Location id or name', { required: true }) } },

  { name: 'departments.list', method: 'GET', fn: 'lib_org.departmentsList', perm: 'signed', effect: 'read', desc: 'Departments with parent, head, approver, cost centre and people count.', params: Object.assign({ entity: S('Entity id or name (also lists company-wide ones)') }, ARCH) },
  { name: 'departments.add', method: 'POST', fn: 'lib_org.departmentsAdd', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a department.', params: { name: S('Name', { required: true }), code: S('Code'), entity: S('Entity id or name (empty = company-wide)'), parent: S('Parent department'), head: S('Head (employee number or id)'), approver: S('Approver (employee number or id)'), cost_center: S('Cost centre code or id') } },
  { name: 'departments.update', method: 'POST', fn: 'lib_org.departmentsUpdate', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'departments', id: 'department', fields: { name: 'name', code: 'code', head: 'head', approver: 'approver', archived: 'archived' } }, desc: 'Change a department (head, approver, parent).', params: Object.assign({ department: S('Department id or name', { required: true }), name: S('Name'), code: S('Code'), entity: S('Entity'), parent: S('Parent department'), head: S('Head'), approver: S('Approver'), cost_center: S('Cost centre') }, ARCH) },
  { name: 'departments.delete', method: 'POST', fn: 'lib_org.departmentsDelete', perm: ORG, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a department nobody is in (else archive it).', params: { department: S('Department id or name', { required: true }) } },

  { name: 'titles.list', method: 'GET', fn: 'lib_org.titlesList', perm: 'signed', effect: 'read', desc: 'Job titles (designations) with family and grade.', params: ARCH },
  { name: 'titles.add', method: 'POST', fn: 'lib_org.titlesAdd', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a job title.', params: { name: S('Title', { required: true }), family: S('Job family'), grade: S('Grade code or id'), description: S('Description') } },
  { name: 'titles.update', method: 'POST', fn: 'lib_org.titlesUpdate', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'job_titles', id: 'title', fields: { name: 'name', family: 'family', description: 'description', archived: 'archived' } }, desc: 'Change a job title.', params: Object.assign({ title: S('Job title id or name', { required: true }), name: S('Title'), family: S('Job family'), grade: S('Grade'), description: S('Description') }, ARCH) },
  { name: 'titles.delete', method: 'POST', fn: 'lib_org.titlesDelete', perm: ORG, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a job title nobody holds (else archive it).', params: { title: S('Job title id or name', { required: true }) } },

  { name: 'grades.list', method: 'GET', fn: 'lib_org.gradesList', perm: 'signed', effect: 'read', desc: 'Grades (bands) with currency and pay range.', params: Object.assign({ entity: S('Entity') }, ARCH) },
  { name: 'grades.add', method: 'POST', fn: 'lib_org.gradesAdd', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a grade with an optional pay range (major units in its currency).', params: { code: S('Code, e.g. G5', { required: true }), name: S('Name', { required: true }), entity: S('Entity (empty = company-wide)'), currency: S('Currency of the range'), pay_min: S('Range minimum, e.g. 60000'), pay_max: S('Range maximum'), sort: N('Order') } },
  { name: 'grades.update', method: 'POST', fn: 'lib_org.gradesUpdate', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'grades', id: 'grade', fields: { name: 'name', code: 'code', archived: 'archived' } }, desc: 'Change a grade.', params: Object.assign({ grade: S('Grade code or id', { required: true }), code: S('Code'), name: S('Name'), entity: S('Entity'), currency: S('Currency'), pay_min: S('Range minimum'), pay_max: S('Range maximum'), sort: N('Order') }, ARCH) },
  { name: 'grades.delete', method: 'POST', fn: 'lib_org.gradesDelete', perm: ORG, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an unused grade.', params: { grade: S('Grade code or id', { required: true }) } },

  { name: 'cost-centers.list', method: 'GET', fn: 'lib_org.costCentersList', perm: 'signed', effect: 'read', desc: 'Cost centres.', params: Object.assign({ entity: S('Entity') }, ARCH) },
  { name: 'cost-centers.add', method: 'POST', fn: 'lib_org.costCentersAdd', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a cost centre.', params: { code: S('Code', { required: true }), name: S('Name', { required: true }), entity: S('Entity') } },
  { name: 'cost-centers.update', method: 'POST', fn: 'lib_org.costCentersUpdate', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'cost_centers', id: 'cost_center', fields: { code: 'code', name: 'name', archived: 'archived' } }, desc: 'Change a cost centre.', params: Object.assign({ cost_center: S('Cost centre code or id', { required: true }), code: S('Code'), name: S('Name'), entity: S('Entity') }, ARCH) },
  { name: 'cost-centers.delete', method: 'POST', fn: 'lib_org.costCentersDelete', perm: ORG, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an unused cost centre.', params: { cost_center: S('Cost centre code or id', { required: true }) } },

  { name: 'employment-types.list', method: 'GET', fn: 'lib_org.employmentTypesList', perm: 'signed', effect: 'read', desc: 'Employment types (full time, part time, contractor...) with statutory notes per country.', params: ARCH },
  { name: 'employment-types.add', method: 'POST', fn: 'lib_org.employmentTypesAdd', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add an employment type.', params: { code: S('Code, e.g. casual', { required: true }), name: S('Name', { required: true }), statutory: S('JSON {country: notes}'), sort: N('Order') } },
  { name: 'employment-types.update', method: 'POST', fn: 'lib_org.employmentTypesUpdate', perm: ORG, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'employment_types', id: 'employment_type', fields: { name: 'name', archived: 'archived' } }, desc: 'Change an employment type.', params: Object.assign({ employment_type: S('Code or id', { required: true }), code: S('Code'), name: S('Name'), statutory: S('JSON'), sort: N('Order') }, ARCH) },
  { name: 'employment-types.delete', method: 'POST', fn: 'lib_org.employmentTypesDelete', perm: ORG, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an unused employment type.', params: { employment_type: S('Code or id', { required: true }) } },

  { name: 'calendars.list', method: 'GET', fn: 'lib_calendar.calendarsList', perm: 'signed', effect: 'read', desc: 'Holiday calendars with the holiday count of a year and where they are used.', params: Object.assign({ year: N('Year (default this year)') }, ARCH) },
  { name: 'calendars.get', method: 'GET', fn: 'lib_calendar.calendarsGet', perm: 'signed', effect: 'read', desc: 'One calendar with its holidays of a year.', params: { calendar: S('Calendar code or id', { required: true }), year: N('Year (default this year)') } },
  { name: 'calendars.add', method: 'POST', fn: 'lib_calendar.calendarsAdd', perm: CAL, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a holiday calendar (company holidays), optionally copying another.', params: { code: S('Code, e.g. SG-OFFICE', { required: true }), name: S('Name', { required: true }), country: S('Country code'), region: S('Region code'), entity: S('Entity'), copy_from: S('Calendar to copy holidays from') } },
  { name: 'calendars.update', method: 'POST', fn: 'lib_calendar.calendarsUpdate', perm: CAL, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'holiday_calendars', id: 'calendar', fields: { name: 'name', archived: 'archived' } }, desc: 'Rename or archive a calendar.', params: Object.assign({ calendar: S('Calendar code or id', { required: true }), name: S('Name') }, ARCH) },
  { name: 'calendars.delete', method: 'POST', fn: 'lib_calendar.calendarsDelete', perm: CAL, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an unused calendar with its holidays.', params: { calendar: S('Calendar code or id', { required: true }) } },
  { name: 'calendars.seed', method: 'POST', fn: 'lib_calendar.calendarsSeed', perm: CAL, effect: 'write', desc: "Add public holidays of the given years from the country data to a country calendar (holidays already there are kept).", params: { calendar: S('Calendar code or id', { required: true }), years: S('JSON list of years, e.g. [2027] (default: every year the data has)') } },
  { name: 'calendars.working-days', method: 'GET', fn: 'lib_calendar.workingDaysOp', perm: 'signed', effect: 'read', desc: "Working days of one employment between two days (its schedule and holiday calendar as of each day).", params: { employment: S('Employment (or employee) number or id', { required: true }), from: S('From day (default today)'), to: S('To day (default from + 30)') } },
  { name: 'holidays.add', method: 'POST', fn: 'lib_calendar.holidaysAdd', perm: CAL, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a holiday to a calendar.', params: { calendar: S('Calendar code or id', { required: true }), day: S('Day', { required: true }), name: S('Name', { required: true }), kind: S('public | company | optional | observed', { enum: ['public', 'company', 'optional', 'observed'] }), half: B('Half day') } },
  { name: 'holidays.update', method: 'POST', fn: 'lib_calendar.holidaysUpdate', perm: CAL, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'holidays', id: 'holiday', fields: { day: 'day', name: 'name', kind: 'kind', half: 'half' } }, desc: 'Change a holiday.', params: { holiday: S('Holiday id', { required: true }), day: S('Day'), name: S('Name'), kind: S('public | company | optional | observed', { enum: ['public', 'company', 'optional', 'observed'] }), half: B('Half day') } },
  { name: 'holidays.delete', method: 'POST', fn: 'lib_calendar.holidaysDelete', perm: CAL, agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a holiday from a calendar.', params: { holiday: S('Holiday id', { required: true }) } },
  { name: 'holidays.import', method: 'POST', fn: 'lib_calendar.holidaysImport', perm: CAL, agent: 'deny', effect: 'write', files: ['file'], desc: 'Import holidays from CSV (columns day, name, kind, half): --dry_run true (default) reports, false adds them.', params: { calendar: S('Calendar code or id', { required: true }), csv: S('CSV text (or upload a file)'), dry_run: B('Only check (default true)') } },

  { name: 'schedules.list', method: 'GET', fn: 'lib_calendar.schedulesList', perm: 'signed', effect: 'read', desc: 'Work schedules (the week with start, end and break per weekday, hours per week, grace, night hours).', params: ARCH },
  { name: 'schedules.add', method: 'POST', fn: 'lib_calendar.schedulesAdd', perm: CAL, agent: 'propose', kind: 'people', effect: 'write', desc: 'Add a work schedule.', params: { name: S('Name', { required: true }), entity: S('Entity'), week: S('JSON list [{"dow":1,"start":"09:00","end":"18:00","break_min":60}]', { required: true }), flexible: B('Flexible hours'), grace_min: N('Grace minutes for late arrival'), night_from: S('Night hours start HH:MM'), night_to: S('Night hours end HH:MM') } },
  { name: 'schedules.update', method: 'POST', fn: 'lib_calendar.schedulesUpdate', perm: CAL, agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'work_schedules', id: 'schedule', fields: { name: 'name', week: 'week', flexible: 'flexible', grace_min: 'grace_min', archived: 'archived' } }, desc: 'Change a work schedule.', params: Object.assign({ schedule: S('Schedule id or name', { required: true }), name: S('Name'), entity: S('Entity'), week: S('JSON list of week rows'), flexible: B('Flexible hours'), grace_min: N('Grace minutes'), night_from: S('HH:MM'), night_to: S('HH:MM') }, ARCH) },
  { name: 'schedules.delete', method: 'POST', fn: 'lib_calendar.schedulesDelete', perm: CAL, agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an unused work schedule.', params: { schedule: S('Schedule id or name', { required: true }) } },
];
