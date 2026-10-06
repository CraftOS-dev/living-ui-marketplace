/**
 * Typed client for NetSentry operations. Names match operations.json; the
 * route is the name with dots turned into dashes. Errors surface through the
 * kit client (toast) with the server's message.
 */
import { getPbClient } from '../../kit/index.ts';

const GET_OPS = new Set([
  'assets.impact',
  'assets.timeline',
  'findings.explain',
  'posture.overview',
  'audit.verify-chain',
  'audit.export',
  'sensors.install-info',
  'agent.presence',
  'catalogue.list',
  'installs.templates',
  'metrics.series',
  'home.overview',
  'help.pending',
  'accounts.reviews-due',
  'changes.list',
  'logs.result',
  'activity.stats',
  'incidents.untriaged',
  'incidents.context',
  'digest.preview',
  'remediations.suggest',
  'remediations.queue',
  'server.read-result',
  'terminal.sessions',
  'terminal.transcript',
]);

export type OpParams = Record<string, string | number | boolean | undefined>;

export async function runOp<T = Record<string, unknown>>(
  name: string,
  params: OpParams = {},
  opts: { silent?: boolean } = {},
): Promise<T> {
  const path = '/api/ops/' + name.replace(/\./g, '-');
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = v;
  return getPbClient().call(
    (pb) =>
      GET_OPS.has(name)
        ? pb.send<T>(path, { method: 'GET', query: clean })
        : pb.send<T>(path, { method: 'POST', body: clean }),
    opts,
  );
}

/** Pull the human message out of a failed op call. */
export function opError(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Something went wrong.';
}
