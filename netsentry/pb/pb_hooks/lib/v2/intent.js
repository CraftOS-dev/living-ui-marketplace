/**
 * Intent (plan §15): "who should be able to reach this app?" — pure.
 * Vantages are ordered from closest to widest.
 */
const VANTAGES = ['this_machine', 'local_network', 'private_remote', 'internet'];

const ALLOWED = {
  this_machine: ['this_machine'],
  local_network: ['this_machine', 'local_network'],
  local_plus_private_remote: ['this_machine', 'local_network', 'private_remote'],
  // P0: specific networks are treated as the local network until segments exist (P3).
  specific_networks: ['this_machine', 'local_network'],
  internet: VANTAGES.slice(),
};

/** Words people read. `place` is "local" (the server's network) or "VPC" (a cloud machine). */
function reachWords(reach, place) {
  const p = place === 'VPC' ? 'the VPC' : 'your local network';
  return {
    this_machine: 'only this server',
    local_network: `${p} only`,
    local_plus_private_remote: `${p}, plus your own devices when away`,
    specific_networks: 'chosen networks only',
    internet: 'anyone on the internet',
  }[reach] || reach;
}

function vantageWords(v, place) {
  const p = place || 'local';
  return {
    this_machine: 'this server only',
    local_network: `everyone on your ${p} network`,
    private_remote: 'your own devices when away',
    internet: 'the whole internet',
  }[v] || v;
}

function widest(vantages) {
  let best = -1;
  for (const v of vantages) best = Math.max(best, VANTAGES.indexOf(v));
  return best < 0 ? null : VANTAGES[best];
}

/** actual vantages vs intent → { ok, beyond: [...], short: [...] } */
function compare(actual, reach) {
  const allowed = ALLOWED[reach] || ALLOWED.local_network;
  const beyond = actual.filter((v) => allowed.indexOf(v) < 0);
  // "not set up for away yet" only means something for "office/home + my devices away"; the internet covers away.
  const short = reach === 'local_plus_private_remote' ? allowed.filter((v) => v === 'private_remote' && actual.indexOf(v) < 0) : [];
  return { ok: beyond.length === 0, beyond, short };
}

module.exports = { VANTAGES, ALLOWED, compare, widest, reachWords, vantageWords };
