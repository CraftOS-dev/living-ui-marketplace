/**
 * PURE — remediation lifecycle and plan validation.
 *
 *   plan_requested → planned → approved → executing → verifying → done
 *                         ↘ rejected       ↘ expired   ↘ failed → rolled_back
 *   (any open state) → cancelled
 * A plan edit after approval voids the approval (back to planned).
 */
const { stableStringify } = require('./util.js');

const NEXT = {
  plan_requested: ['planned', 'cancelled'],
  planned: ['planned', 'approved', 'rejected', 'cancelled'],
  approved: ['planned', 'executing', 'expired', 'cancelled'],
  executing: ['verifying', 'done', 'failed', 'rolled_back'],
  verifying: ['done', 'failed', 'expired', 'cancelled'], // cancelled: a person stops waiting (e.g. the host is gone)
  failed: ['rolled_back', 'planned', 'cancelled'],
  rolled_back: ['planned', 'cancelled'],
  rejected: ['planned', 'cancelled'],
  expired: ['planned', 'cancelled'],
  // v4 §7: a change that worked, undone afterwards by the monitor from what it recorded
  done: ['undone'],
  undone: [],
  cancelled: [],
};

const OPEN = ['plan_requested', 'planned', 'approved', 'executing', 'verifying'];

function canMove(from, to) {
  return (NEXT[from] || []).indexOf(to) >= 0;
}

const LIMITS = { steps: 25, description: 500, command: 2000, target: 255, rollback: 2000 };

/**
 * Validate and normalise an agent/person-written plan.
 * @param raw          { steps: [{ description, command?, target?, rollback? }] }
 * @param allowedTargets identifiers the plan may touch (the finding's asset tree)
 * @returns { plan } | { error }
 */
function validatePlan(raw, allowedTargets) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return { error: 'plan must be an object with a "steps" array.' };
  if (raw.steps.length === 0) return { error: 'A plan needs at least one step.' };
  if (raw.steps.length > LIMITS.steps) return { error: `A plan has at most ${LIMITS.steps} steps.` };
  const allowed = {};
  for (const t of allowedTargets || []) allowed[String(t).toLowerCase()] = true;
  const steps = [];
  for (let i = 0; i < raw.steps.length; i++) {
    const s = raw.steps[i] || {};
    const description = String(s.description || '').trim();
    if (!description) return { error: `steps[${i}].description is required.` };
    for (const k of ['description', 'command', 'target', 'rollback']) {
      if (s[k] !== undefined && String(s[k]).length > LIMITS[k]) return { error: `steps[${i}].${k} is longer than ${LIMITS[k]} characters.` };
    }
    const target = String(s.target || '').trim();
    if (target && !allowed[target.toLowerCase()]) {
      return { error: `steps[${i}].target "${target}" is outside this finding's asset (${Object.keys(allowed).join(', ') || 'none'}).` };
    }
    steps.push({ description, command: String(s.command || ''), target, rollback: String(s.rollback || '') });
  }
  return { plan: { steps } };
}

function planHash(sha256, plan) {
  return sha256(stableStringify(plan));
}

module.exports = { NEXT, OPEN, canMove, validatePlan, planHash, LIMITS };
