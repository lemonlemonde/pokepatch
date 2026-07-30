/**
 * Thin IndexedDB wrapper for in-progress studio work (uploaded photos as
 * `File`s, plus their crop/annotation/pair metadata). IndexedDB is used
 * instead of localStorage/sessionStorage (see `signedUrlCache.js` for that
 * pattern) because `File`/`Blob` values clone natively into it — a whole
 * formatter's state object can be stored and read back as-is, with no
 * manual (de)serialization of the underlying files.
 *
 * Every export fails soft: a browser without IndexedDB (some private
 * browsing modes) just doesn't persist, rather than breaking the studio.
 */

const DB_NAME = "pokepatch-studio-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function withStore(mode, run) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, mode);
    } catch {
      resolve(null);
      return;
    }
    const store = tx.objectStore(STORE_NAME);
    let result;
    try {
      result = run(store);
    } catch {
      resolve(null);
      return;
    }
    tx.oncomplete = () => resolve(result?.result ?? null);
    tx.onerror = () => resolve(null);
    tx.onabort = () => resolve(null);
  });
}

/** Stored `data` for `key`, or `null` if nothing's saved (or storage failed). */
export async function getDraft(key) {
  const record = await withStore("readonly", (store) => store.get(key));
  return record?.data ?? null;
}

/** Upsert `{ key, updatedAt, data }`. Best-effort — failures are swallowed. */
export async function putDraft(key, data) {
  await withStore("readwrite", (store) =>
    store.put({ key, updatedAt: Date.now(), data }),
  );
}

export async function deleteDraft(key) {
  await withStore("readwrite", (store) => store.delete(key));
}
