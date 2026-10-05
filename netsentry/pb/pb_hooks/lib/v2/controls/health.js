/**
 * Is it running well? (v3 plan §7.2) — restart loops, failed services,
 * memory, failing disks, runaway logs, a pending restart, heat, and a monitor
 * older than NetSentry. Pure evaluators over the machine's observations and
 * its last 30 minutes of numbers (machine.metrics: { machine | <container>: [{t, ...}] }).
 */
const { span, plural } = require('../content.js');

function one(m, kind, subject) {
  return m.obs(kind).find((o) => (subject ? o.subject === subject : true)) || null;
}

function samplesOf(m, subject) {
  return ((m.metrics || {})[subject] || []).filter((s) => s && s.t);
}

function gb(bytes) {
  return Math.round((bytes / 1e9) * 10) / 10;
}

// ------------------------------------------------------------------ restart loop

const LOOP_RESTARTS = 3;
const LOOP_MINUTES = 15;

const restartLoop = {
  id: 'UP-RESTART-LOOP',
  version: 1,
  outcome: 'uptime',
  subject: 'app',
  title: 'The app keeps restarting',
  appliesTo: (app, ctx) => !!app.container && ctx.machine.sources.some((s) => s.collector === 'host.container_stats' && s.last_run),
  evaluate(app, ctx) {
    const recent = samplesOf(ctx.machine, app.container).filter((s) => Date.parse(ctx.now) - Date.parse(s.t) <= LOOP_MINUTES * 60000);
    if (recent.length < 2) return { state: 'unknown', reason: 'not enough recent readings yet', facts: {} };
    const counts = recent.map((s) => s.restarts).filter((n) => typeof n === 'number');
    const restarts = counts.length ? Math.max.apply(null, counts) - Math.min.apply(null, counts) : 0;
    const restarting = recent.filter((s) => s.state === 'restarting').length;
    const facts = { restarts, minutes: LOOP_MINUTES };
    const evidence = { samples: recent.length, restarts, restarting };
    if (restarts >= LOOP_RESTARTS || restarting >= 2) {
      const health = one(ctx.machine, 'container.health', app.container);
      const d = (health && health.data) || {};
      facts.exit_code = typeof d.exit_code === 'number' ? d.exit_code : null;
      facts.oom = !!d.oom_killed;
      return { state: 'fail', severity: app.importance === 'critical' ? 'high' : 'medium', factors: [`restarted ${plural(Math.max(restarts, restarting), 'time')} in ${LOOP_MINUTES} minutes`], facts, evidence };
    }
    return { state: 'pass', facts, evidence };
  },
  text: {
    title: (f, app) => `${app.name} keeps restarting`,
    saw: (f, app) =>
      [`${app.name} restarted ${plural(Math.max(f.restarts, 2), 'time')} in the last ${f.minutes} minutes.`].concat(
        f.oom ? ['It ran out of memory the last time it stopped.'] : f.exit_code ? [`The last time it stopped, it ended with error code ${f.exit_code}.`] : [],
      ),
    means: (f, app) => `${app.name} starts, fails and starts again, so it's down most of the time and may be damaging its own data.`,
    steps: (f, app) => ({
      variant: app.compose_project ? 'docker_compose' : 'docker_run',
      list: [
        `Read why it fails: open ${app.name} in NetSentry → Logs (or: docker logs --tail 80 ${app.container}).`,
        f.oom ? `It needs more memory than it gets: raise or remove its memory limit, or stop something else on the server.` : 'Fix what the last lines of its log complain about (a missing folder, a wrong setting, a port already in use).',
        `If it began after an update: ${app.name} → Updates → Roll back.`,
      ],
    }),
    verify: () => 'This turns green after 15 minutes without a restart.',
    pass: (f, app) => `${app.name} runs steadily`,
    unknown: (f, app) => `We haven't watched ${app.name} long enough yet`,
  },
  references: [],
};

// ------------------------------------------------------------------ failed services

const serviceFailed = {
  id: 'UP-SERVICE-FAILED',
  version: 1,
  outcome: 'uptime',
  subject: 'machine',
  title: 'A service on the server failed',
  appliesTo: (m) => m.sources.some((s) => s.collector === 'host.services' && s.last_run),
  evaluate(m) {
    const problems = m.obs('service.problem').map((o) => o.data || {}).filter((d) => d.unit);
    const facts = { services: problems.map((d) => ({ unit: d.unit, description: d.description || '', looping: d.sub === 'auto-restart', exit: d.exit_status || '' })) };
    if (!problems.length) return { state: 'pass', facts, evidence: {} };
    return { state: 'fail', severity: 'medium', factors: [`${plural(problems.length, 'service')} failed`], facts, evidence: { services: problems } };
  },
  text: {
    title: (f, m) => (f.services.length === 1 ? `${f.services[0].unit.replace(/\.service$/, '')} failed on ${m.name}` : `${f.services.length} services failed on ${m.name}`),
    saw: (f) =>
      f.services.slice(0, 5).map((s) => `${s.unit.replace(/\.service$/, '')}${s.description ? ` (${s.description})` : ''} ${s.looping ? 'keeps restarting' : 'stopped with an error'}${s.exit && s.exit !== '0' ? ` — code ${s.exit}` : ''}.`),
    means: () => 'Whatever these services do on the server is not happening until they run again.',
    steps: (f, m) => ({
      variant: m.variant,
      list:
        m.variant === 'windows_gui'
          ? ['Open Services (Win + R, services.msc), find the service, read its status and start it.', 'If it stops again, look in Event Viewer → Windows Logs → System for its error.']
          : [
              `See why: sudo systemctl status ${f.services[0].unit} and sudo journalctl -u ${f.services[0].unit} -n 50`,
              `Start it again once fixed: sudo systemctl restart ${f.services[0].unit}`,
              `If you don't need it: sudo systemctl disable --now ${f.services[0].unit}`,
            ],
    }),
    verify: () => 'NetSentry looks every two minutes; this turns green once they run (or are switched off).',
    pass: (f, m) => `Every service on ${m.name} is running`,
    unknown: (f, m) => `We haven't looked at the services on ${m.name} yet`,
  },
  references: [],
};

// ------------------------------------------------------------------ memory

const MEM_FULL = 0.92;
const MEM_MINUTES = 20;

const memory = {
  id: 'HL-MEMORY',
  version: 1,
  outcome: 'health',
  subject: 'machine',
  title: 'The server is out of memory',
  appliesTo: (m) => samplesOf(m, 'machine').length > 0,
  evaluate(m, ctx) {
    const recent = samplesOf(m, 'machine').filter((s) => Date.parse(ctx.now) - Date.parse(s.t) <= MEM_MINUTES * 60000 && s.mem_total > 0);
    if (recent.length < 10) return { state: 'unknown', reason: 'not enough recent readings yet', facts: {} };
    const ratios = recent.map((s) => s.mem_used / s.mem_total);
    const low = Math.min.apply(null, ratios);
    const last = recent[recent.length - 1];
    // Which app holds most of it (the latest reading of each container).
    let top = null;
    for (const subject of Object.keys(m.metrics || {})) {
      if (subject === 'machine') continue;
      const s = samplesOf(m, subject);
      const mem = s.length ? s[s.length - 1].mem : null;
      if (typeof mem === 'number' && (!top || mem > top.mem)) top = { name: subject, mem };
    }
    const facts = { pct: Math.round(low * 100), total_gb: gb(last.mem_total), minutes: MEM_MINUTES, top: top ? top.name : '', top_gb: top ? gb(top.mem) : 0 };
    if (low >= MEM_FULL) return { state: 'fail', severity: low >= 0.97 ? 'high' : 'medium', factors: [`${facts.pct}% memory used for ${MEM_MINUTES} minutes`], facts, evidence: { samples: recent.length, low } };
    return { state: 'pass', facts, evidence: { samples: recent.length } };
  },
  text: {
    title: (f, m) => `${m.name} is almost out of memory (${f.pct}%)`,
    saw: (f) =>
      [`At least ${f.pct}% of its ${f.total_gb} GB of memory has been in use for ${f.minutes} minutes.`].concat(f.top ? [`The app using most: ${f.top} (${f.top_gb} GB).`] : []),
    means: () => 'When memory runs out, the server stops apps to survive — usually the biggest one, often in the middle of something.',
    steps: (f) => ({
      variant: 'generic',
      list: [
        f.top ? `Look at ${f.top} first: restart it if it grew by itself, or give it a memory limit.` : 'Find what uses the memory: NetSentry → Server.',
        'Stop apps you no longer use.',
        'If everything is needed, the server needs more memory.',
      ],
    }),
    verify: () => 'This turns green once memory use stays below 92%.',
    pass: (f, m) => `${m.name} has memory to spare`,
    unknown: (f, m) => `We haven't measured ${m.name}'s memory long enough yet`,
  },
  references: [],
};

// ------------------------------------------------------------------ disk health

const diskHealth = {
  id: 'HL-DISK-HEALTH',
  version: 1,
  outcome: 'health',
  subject: 'machine',
  title: 'A disk is failing',
  appliesTo: (m) => m.obs('disk.smart').length + m.obs('disk.raid').length + m.obs('disk.pool').length > 0,
  evaluate(m) {
    const bad = [];
    for (const o of m.obs('disk.smart')) {
      const d = o.data || {};
      if (d.verdict === 'failing' || d.verdict === 'warning') {
        bad.push({ what: 'disk', name: d.model ? `${d.model}${d.serial_tail ? ` (…${d.serial_tail})` : ''}` : o.subject, level: d.verdict, detail: d.passed === false ? 'the disk reports itself as failing' : d.pending || d.uncorrectable ? `${(d.pending || 0) + (d.uncorrectable || 0)} unreadable areas` : d.media_errors ? `${d.media_errors} read errors` : d.reallocated ? `${d.reallocated} worn-out areas replaced` : 'it is near the end of its life' });
      }
    }
    for (const o of m.obs('disk.raid')) {
      const d = o.data || {};
      if (d.state === 'degraded') bad.push({ what: 'raid', name: o.subject, level: 'failing', detail: 'one of its disks dropped out' });
    }
    for (const o of m.obs('disk.pool')) {
      const d = o.data || {};
      if (d.health && d.health !== 'ONLINE') bad.push({ what: 'pool', name: o.subject, level: d.health === 'DEGRADED' ? 'failing' : 'failing', detail: `its state is ${d.health.toLowerCase()}` });
    }
    const facts = { bad };
    if (!bad.length) return { state: 'pass', facts, evidence: {} };
    const failing = bad.some((b) => b.level === 'failing');
    return { state: 'fail', severity: failing ? 'high' : 'low', factors: bad.map((b) => `${b.name}: ${b.detail}`), facts, evidence: { bad } };
  },
  text: {
    title: (f, m) => (f.bad.some((b) => b.level === 'failing') ? `A disk in ${m.name} is failing` : `A disk in ${m.name} is wearing out`),
    saw: (f) => f.bad.slice(0, 5).map((b) => `${b.what === 'raid' ? 'Disk group' : b.what === 'pool' ? 'Storage pool' : 'Disk'} ${b.name}: ${b.detail}.`),
    means: (f) =>
      f.bad.some((b) => b.level === 'failing')
        ? 'A failing disk can stop working at any moment and take what is on it with it. A disk group with a missing disk has no spare left.'
        : 'The disk still works, but it has started to wear out; plan to replace it.',
    steps: () => ({
      variant: 'storage',
      list: [
        'Copy anything you can\'t lose off it now (your app backups, photos, documents).',
        'Replace the disk; in a disk group, add the new disk so it rebuilds.',
        'Check that your backups restore before you rely on them.',
      ],
    }),
    verify: () => 'NetSentry reads the disks every 15 minutes; this turns green when they report healthy.',
    pass: (f, m) => `The disks in ${m.name} report healthy`,
    unknown: (f, m) => `We can't read the disks' health on ${m.name}`,
  },
  references: [],
};

// ------------------------------------------------------------------ runaway logs

const LOG_GB = 1;

const dockerLogs = {
  id: 'HL-DOCKER-LOGS',
  version: 1,
  outcome: 'storage',
  subject: 'app',
  title: "An app's log is eating the disk",
  appliesTo: (app, ctx) => !!app.container && !!one(ctx.machine, 'container.logs', app.container),
  evaluate(app, ctx) {
    const d = one(ctx.machine, 'container.logs', app.container).data || {};
    const facts = { size_gb: d.size_gb, limited: !!d.max_size, driver: d.driver || '' };
    if (typeof d.size_gb !== 'number') return { state: 'unknown', reason: "the monitor can't see Docker's log files (a monitor running in a container needs /var/lib/docker/containers, read-only)", facts };
    if (d.size_gb >= LOG_GB) return { state: 'fail', severity: d.size_gb >= 10 ? 'medium' : 'low', factors: [`log is ${d.size_gb} GB`], facts, evidence: d };
    return { state: 'pass', facts, evidence: d };
  },
  text: {
    title: (f, app) => `${app.name}'s log has grown to ${f.size_gb} GB`,
    saw: (f, app) => [`${app.name} has written ${f.size_gb} GB of log.`, f.limited ? 'Its log has a size limit, but it is set high.' : 'Nothing limits how big its log can grow.'],
    means: () => 'Logs nobody reads keep filling the disk until apps can no longer save anything.',
    steps: (f, app) => ({
      variant: app.compose_project ? 'docker_compose' : 'docker_run',
      list: app.compose_project
        ? ["Let NetSentry limit it (Fix it for me), or add to the app in its compose file: logging: { driver: local, options: { max-size: \"20m\" } }", `Then: docker compose up -d ${app.compose_service}`]
        : ['Let NetSentry limit it (Fix it for me), or recreate the container with --log-opt max-size=20m.'],
    }),
    verify: () => 'This turns green once the log is under 1 GB.',
    pass: (f, app) => `${app.name}'s log is a sensible size`,
    unknown: (f, app) => `We can't see how big ${app.name}'s log is`,
  },
  references: [],
};

// ------------------------------------------------------------------ restart pending

const rebootNeeded = {
  id: 'HL-REBOOT-NEEDED',
  version: 1,
  outcome: 'updates',
  subject: 'machine',
  title: 'A restart is waiting to finish updates',
  appliesTo: (m) => !!one(m, 'host.health', 'machine'),
  evaluate(m) {
    const d = one(m, 'host.health', 'machine').data || {};
    if (d.reboot_required === null || d.reboot_required === undefined) return { state: 'unknown', reason: "this server doesn't say", facts: {} };
    if (!d.reboot_required) return { state: 'pass', facts: {}, evidence: {} };
    return { state: 'fail', severity: 'low', factors: ['restart pending'], facts: {}, evidence: { reboot_required: true } };
  },
  text: {
    title: (f, m) => `${m.name} needs a restart to finish installing updates`,
    saw: () => ['Updates were installed that only take effect after a restart.'],
    means: () => 'Until it restarts, the old (unpatched) versions keep running.',
    steps: (f, m) => ({
      variant: m.variant,
      list: [`Pick a quiet moment and restart ${m.name} (NetSentry can schedule it: Server → Overview → Restart the server…).`, 'Apps set to start automatically come back by themselves; check Home afterwards.'],
    }),
    verify: () => 'This turns green once the server has restarted.',
    pass: (f, m) => `${m.name} has no restart waiting`,
    unknown: (f, m) => `We can't tell whether ${m.name} needs a restart`,
  },
  references: [],
};

// ------------------------------------------------------------------ heat

const HOT_MINUTES = 10;

const hot = {
  id: 'HL-HOT',
  version: 1,
  outcome: 'health',
  subject: 'machine',
  title: 'The server runs too hot',
  appliesTo: (m) => samplesOf(m, 'machine').some((s) => typeof s.temp_c === 'number'),
  evaluate(m, ctx) {
    const recent = samplesOf(m, 'machine').filter((s) => typeof s.temp_c === 'number' && Date.parse(ctx.now) - Date.parse(s.t) <= HOT_MINUTES * 60000);
    if (recent.length < 5) return { state: 'unknown', reason: 'not enough recent readings yet', facts: {} };
    const coolest = Math.min.apply(null, recent.map((s) => s.temp_c));
    const crit = recent[recent.length - 1].temp_crit;
    const limit = typeof crit === 'number' && crit > 50 ? crit - 5 : 90;
    const facts = { temp: Math.round(coolest), limit: Math.round(limit), minutes: HOT_MINUTES };
    if (coolest >= limit) return { state: 'fail', severity: 'medium', factors: [`${facts.temp} °C for ${HOT_MINUTES} minutes`], facts, evidence: { samples: recent.length } };
    return { state: 'pass', facts, evidence: {} };
  },
  text: {
    title: (f, m) => `${m.name} is running hot (${f.temp} °C)`,
    saw: (f) => [`Its processor has been at ${f.temp} °C or more for ${f.minutes} minutes; it slows itself down from about ${f.limit + 5} °C.`],
    means: () => 'A server this hot slows down to protect itself and wears out sooner.',
    steps: () => ({ variant: 'generic', list: ['Make sure air can get in and out (dust, a closed cupboard, a blocked fan).', 'Check which app keeps the processor busy (NetSentry → Server).'] }),
    verify: () => 'This turns green once it stays cooler.',
    pass: (f, m) => `${m.name}'s temperature is fine`,
    unknown: (f, m) => `We can't read ${m.name}'s temperature`,
  },
  references: [],
};

module.exports = [restartLoop, serviceFailed, memory, diskHealth, dockerLogs, rebootNeeded, hot];
