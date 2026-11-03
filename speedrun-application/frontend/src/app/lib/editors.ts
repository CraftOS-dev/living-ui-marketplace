/** Review requests wait for editor autosaves without changing review scheduling. */
const editors = new Set<() => Promise<void>>();
const writes = new Set<Promise<unknown>>();
export function registerEditor(flush: () => Promise<void>): () => void {
  editors.add(flush);
  return () => { editors.delete(flush); };
}
export function trackSave<T>(work: Promise<T>): Promise<T> {
  writes.add(work);
  void work.then(() => writes.delete(work), () => writes.delete(work));
  return work;
}
export async function flushEditors(): Promise<void> {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await Promise.all([...editors].map((flush) => flush()));
  while (writes.size > 0) await Promise.all([...writes]);
}
