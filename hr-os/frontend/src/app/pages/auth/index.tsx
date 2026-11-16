/**
 * The screens before the app (sign in, invite, recovery: SignIn.tsx) have no
 * routes inside the shell; the signed-in person's password, approval PIN and
 * recovery code live in Settings, Security (Security.tsx, used there).
 */
import type { RouteDef } from '../../lib/contract.ts';

export const routes: RouteDef[] = [];
