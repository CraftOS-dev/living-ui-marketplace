// IndexedDB survives refresh/reopen without putting source buffers in app exports.
const open = () =>
  new Promise((yes, no) => {
    const r = indexedDB.open("development-studio-buffers", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("buffers", { keyPath: "key" });
    r.onsuccess = () => yes(r.result);
    r.onerror = () => no(r.error);
  });
export async function recoverBuffers(project) {
  const db = await open();
  try {
    return await new Promise((yes, no) => {
      const r = db.transaction("buffers").objectStore("buffers").getAll();
      r.onsuccess = () => yes(r.result.filter((v) => v.project === project));
      r.onerror = () => no(r.error);
    });
  } finally {
    db.close();
  }
}
export async function persistBuffer(buffer) {
  const db = await open();
  try {
    await new Promise((yes, no) => {
      const t = db.transaction("buffers", "readwrite");
      t.objectStore("buffers").put({
        ...buffer,
        key: buffer.project + ":" + buffer.path,
      });
      t.oncomplete = yes;
      t.onerror = () => no(t.error);
    });
  } finally {
    db.close();
  }
}
export async function forgetBuffer(project, path) {
  const db = await open();
  try {
    await new Promise((yes, no) => {
      const t = db.transaction("buffers", "readwrite");
      t.objectStore("buffers").delete(project + ":" + path);
      t.oncomplete = yes;
      t.onerror = () => no(t.error);
    });
  } finally {
    db.close();
  }
}
