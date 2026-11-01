// storage.js - ukládání dat v prohlížeči (IndexedDB)
const Store = (() => {
  const DB_NAME = 'strength-tracker';
  const STORE_NAME = 'kv';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const req = fn(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const get = key => run('readonly', s => s.get(key));
  const set = (key, value) => run('readwrite', s => s.put(value, key));
  const remove = key => run('readwrite', s => s.delete(key));

  // požádá prohlížeč, aby data nemazal při nedostatku místa (nemusí to vždy projít)
  async function requestPersistent() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (e) { /* nevadí */ }
    return false;
  }

  return { get, set, remove, requestPersistent };
})();