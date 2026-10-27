/** Small actions several screens share. */
import { op } from './api.ts';
import { changed } from './live.ts';
import type { ConfirmKey } from './types.ts';

/** A founder ticks (or unticks) something only founders can confirm. */
export async function setConfirm(key: ConfirmKey, value: boolean): Promise<void> {
  await op('confirms.set', { [key]: value });
  changed('settings');
}
