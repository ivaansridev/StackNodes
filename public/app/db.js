const DB_NAME = 'JotItDown';
const DB_VERSION = 3;
const STORE_CURRENT = 'state';
const STORE_VERSIONS = 'versions';
const CURRENT_KEY = 'current';
const MAX_VERSIONS = 50;

let _db = null;

function withDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CURRENT)) {
        db.createObjectStore(STORE_CURRENT);
      }
      if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
        db.createObjectStore(STORE_VERSIONS, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

function saveCurrent(state) {
  return withDB().then(db => {
    const tx = db.transaction(STORE_CURRENT, 'readwrite');
    const store = tx.objectStore(STORE_CURRENT);
    store.put(state, CURRENT_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  });
}

function loadCurrent() {
  return withDB().then(db => {
    const tx = db.transaction(STORE_CURRENT, 'readonly');
    const store = tx.objectStore(STORE_CURRENT);
    const req = store.get(CURRENT_KEY);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

function saveVersion(snapshot) {
  return withDB().then(db => {
    const tx = db.transaction(STORE_VERSIONS, 'readwrite');
    const store = tx.objectStore(STORE_VERSIONS);
    const version = {
      id: Date.now(),
      timestamp: new Date().toLocaleString(),
      snapshot: snapshot,
    };
    store.put(version);
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > MAX_VERSIONS) {
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const all = getAllReq.result.sort((a, b) => a.id - b.id);
          const toDelete = all.slice(0, all.length - MAX_VERSIONS);
          for (const v of toDelete) store.delete(v.id);
        };
      }
    };
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  });
}

function getVersions() {
  return withDB().then(db => {
    const tx = db.transaction(STORE_VERSIONS, 'readonly');
    const store = tx.objectStore(STORE_VERSIONS);
    const req = store.getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const results = req.result || [];
        resolve(results.sort((a, b) => b.id - a.id));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

function restoreVersion(id) {
  return withDB().then(db => {
    const tx = db.transaction(STORE_VERSIONS, 'readonly');
    const store = tx.objectStore(STORE_VERSIONS);
    const req = store.get(id);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result ? req.result.snapshot : null);
      req.onerror = (e) => reject(e.target.error);
    });
  });
}
