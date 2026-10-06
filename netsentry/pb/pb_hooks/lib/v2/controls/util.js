/** Helpers shared by the checks (pure). */

const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function worst(list) {
  let best = 'info';
  for (const s of list) if (RANK[s] > RANK[best]) best = s;
  return best;
}

function bump(sev, by) {
  const names = Object.keys(RANK);
  return names[Math.max(0, Math.min(names.length - 1, RANK[sev] + by))];
}

/** Which set of instructions fits this app / machine (plan §22.4). */
function variantOf(subject, machine) {
  if (subject && subject.container) return subject.compose_project ? 'docker_compose' : 'docker_run';
  return (machine && machine.variant) || 'generic';
}

/** Machine OS → instruction variant. */
function machineVariant(osData) {
  const d = osData || {};
  const sys = String(d.system || '').toLowerCase();
  const label = String(d.label || '').toLowerCase();
  if (sys === 'windows') return 'windows_gui';
  if (sys === 'darwin') return 'macos';
  if (/ubuntu|debian|mint|raspbian|pop!_os/.test(label)) return 'ubuntu_debian';
  if (/red hat|rhel|rocky|alma|fedora|centos|oracle/.test(label)) return 'rhel_family';
  if (/alpine/.test(label)) return 'alpine';
  return sys === 'linux' ? 'linux' : 'generic';
}

/** "the main disk" / "the disk at /srv/media" */
function diskName(mount) {
  if (mount === '/var/lib/docker') return "Docker's disk";
  if (mount === '/' || /^[A-Za-z]:\\?$/.test(mount)) return mount === '/' ? 'the main disk' : `drive ${mount.slice(0, 2)}`;
  return `the disk at ${mount}`;
}

module.exports = { RANK, worst, bump, variantOf, machineVariant, diskName };
