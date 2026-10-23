/**
 * Build errors as people read them: a short title from the error's code, the
 * engine's own sentence (already written for people), and for geometry the
 * kernel refused, what usually fixes it for that kind of feature. Keyed by
 * the structured code and feature kind, never by the message text.
 */
import type { CadError, FeatureKind } from './types.ts';

export interface Friendly {
  title: string;
  message: string;
  tip: string | null;
  /** The pick field to redo when the problem is what was picked. */
  repick: boolean;
}

const TITLES: Record<string, string> = {
  param_invalid: 'A value needs fixing',
  sketch_invalid: 'The sketch has a problem',
  stale_reference: 'The picked geometry changed',
  reference_order: 'This uses something that comes later',
  kernel_failed: 'This shape cannot be made',
  empty_result: 'Nothing would be left',
  no_effect: 'This changes nothing',
  import_failed: 'The file could not be read',
  engine_unavailable: 'The geometry engine is not running',
  missing_param: 'Something is still missing',
};

const KERNEL_TIPS: Partial<Record<FeatureKind, string>> = {
  fillet: 'Try a smaller radius, or fewer edges at once.',
  chamfer: 'Try a smaller distance, or fewer edges at once.',
  shell: 'Try a thinner wall, or shell before adding fillets.',
  extrude: 'Check that the profile and the model overlap cleanly.',
  push_pull: 'Try a smaller distance.',
  revolve: 'Keep the profile on one side of the axis.',
  hole: 'Check that the hole fits inside the face.',
  boolean: 'Check that the bodies overlap.',
};

export function friendly(err: CadError, kind: FeatureKind | null): Friendly {
  const title = TITLES[err.code] ?? 'This does not build';
  let tip: string | null = null;
  if (err.code === 'kernel_failed' && kind !== null) tip = KERNEL_TIPS[kind] ?? null;
  if (err.code === 'stale_reference') tip = 'Pick it again in the view.';
  if (err.code === 'empty_result') tip = 'Reverse the direction, or use a smaller distance.';
  if (err.code === 'engine_unavailable') tip = 'It starts on its own; try again in a moment. On a new computer it is first set up once (Home shows the progress).';
  return { title, message: err.message, tip, repick: err.code === 'stale_reference' };
}
