/**
 * Freshness (plan §6 trust bar, P5) — pure. Every check rests on some of the
 * monitor's reports. When those reports are older than they should be while
 * the monitor itself is still reporting, a check can't say "fine": it says
 * "can't tell" and names what is out of date. (A failing check keeps its last
 * known state — it was true when last seen, and hiding it would be worse.)
 */

// Which reports each check rests on (prefix match: 'APP-' covers every app check).
const RESTS_ON = [
  ['REACH-BEYOND-INTENT', ['host.containers', 'probe.router']],
  ['APP-', ['probe.apps']],
  ['ACC-', ['probe.accounts']],
  ['UP-APP-DOWN', ['probe.apps']],
  ['HST-SSH-PASSWORD', ['host.ssh']],
  ['HST-FIREWALL-OFF', ['host.posture']],
  ['UPD-OS-SECURITY', ['host.updates']],
  ['STO-FULL-SOON', ['host.storage']],
  ['CLD-', ['host.cloud']],
  // v3 health
  ['UP-RESTART-LOOP', ['host.container_stats']],
  ['UP-SERVICE-FAILED', ['host.services']],
  ['HL-MEMORY', ['host.health']],
  ['HL-HOT', ['host.health']],
  ['HL-REBOOT-NEEDED', ['host.health']],
  ['HL-DISK-HEALTH', ['host.disks']],
  ['HL-DOCKER-LOGS', ['host.disks']],
];

const MIN_SLA_SECONDS = 1800;

/** How old a collector's last report may be: three of its intervals, at least 30 minutes. */
function slaSeconds(intervalSeconds) {
  return Math.max(MIN_SLA_SECONDS, 3 * (Number(intervalSeconds) || 0));
}

function restsOn(control) {
  const hit = RESTS_ON.find(([p]) => control === p || (p.endsWith('-') && control.indexOf(p) === 0));
  return hit ? hit[1] : [];
}

/**
 * sources: [{ collector, label, interval, last_run, enabled }] for this machine.
 * → { [collector]: { label, last_run, sla } } for the ones out of date.
 * Nothing is stale while the monitor itself is silent (NS-MONITOR-SILENT says that).
 */
function staleSources(sources, sensor, now) {
  const out = {};
  if (!sensor || !sensor.online) return out;
  const t = Date.parse(now);
  for (const s of sources || []) {
    if (!s.enabled || !s.interval) continue;
    const sla = slaSeconds(s.interval);
    const last = s.last_run ? Date.parse(s.last_run) : NaN;
    // never reported: only once the monitor has been around longer than the SLA
    const since = isNaN(last) ? (sensor.first_seen ? Date.parse(sensor.first_seen) : t) : last;
    if (t - since <= sla * 1000) continue;
    // A monitor older than this console doesn't have the part at all: that needs an update, not a restart.
    const caps = sensor.capabilities;
    const older = !s.last_run && !!caps && typeof caps === 'object' && Object.keys(caps).length > 0 && !(s.collector in caps);
    out[s.collector] = { label: s.label || s.collector, last_run: s.last_run || '', sla, older };
  }
  return out;
}

/** Apply freshness to one check result (mutates and returns it). */
function applyTo(result, stale) {
  if (result.state !== 'pass') return result;
  const old = restsOn(result.control).filter((c) => stale[c]);
  if (!old.length) return result;
  const s = stale[old[0]];
  result.state = 'unknown';
  result.reason = `out of date: ${s.label} ${s.last_run ? `last reported ${s.last_run.slice(0, 16).replace('T', ' ')} UTC` : 'has not reported yet'}`;
  result.stale = old;
  return result;
}

module.exports = { RESTS_ON, restsOn, slaSeconds, staleSources, applyTo, MIN_SLA_SECONDS };
