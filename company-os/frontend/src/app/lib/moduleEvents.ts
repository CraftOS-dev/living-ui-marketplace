/**
 * Small app-owned event bridge for module activation changes. We keep it in
 * the app layer so Company OS can force an immediate shell refresh without
 * editing the shared kit.
 */
export const MODULES_CHANGED_EVENT = 'company-os:modules-changed';

export function notifyModulesChanged(): void {
  window.dispatchEvent(new CustomEvent(MODULES_CHANGED_EVENT));
}
