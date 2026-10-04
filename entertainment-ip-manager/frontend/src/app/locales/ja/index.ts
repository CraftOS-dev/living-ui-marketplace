/**
 * The Japanese dictionary: one file per area so parallel work never collides.
 * A key may appear in more than one file only with the same translation
 * (the check script reports conflicts).
 */
import { JA_ENUMS } from './enums.ts';
import { JA_CORE } from './core.ts';
import { JA_WORK } from './work.ts';
import { JA_IP } from './ip.ts';
import { JA_MUSIC } from './music.ts';
import { JA_RIGHTS } from './rights.ts';
import { JA_LICENSING } from './licensing.ts';
import { JA_PROTECT } from './protect.ts';
import { JA_ORG } from './org.ts';
import { JA_PORTAL } from './portal.ts';

export const JA_PARTS: Record<string, Record<string, string>> = {
  enums: JA_ENUMS,
  core: JA_CORE,
  work: JA_WORK,
  ip: JA_IP,
  music: JA_MUSIC,
  rights: JA_RIGHTS,
  licensing: JA_LICENSING,
  protect: JA_PROTECT,
  org: JA_ORG,
  portal: JA_PORTAL,
};

export const JA: Record<string, string> = Object.assign({}, ...Object.values(JA_PARTS));
