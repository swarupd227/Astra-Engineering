/**
 * Minimal IndexedDB key/value wrapper for large objects that don't fit in
 * localStorage (which is capped at ~5 MB and throws `QuotaExceededError`
 * synchronously when exceeded).
 *
 * IndexedDB has a multi-hundred-MB origin quota in every modern browser and
 * stores structured-cloneable values natively (no JSON round-trip required).
 *
 * Usage:
 *   await idbSet("sprint-agent:test-cases", testCases);
 *   const tcs = await idbGet<TestCase[]>("sprint-agent:test-cases");
 *   await idbRemove("sprint-agent:test-cases");
 */

const DB_NAME = "astra-qe-kv";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Reset cached promise if the DB is closed by the browser (e.g. tab discard)
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idbSet transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("idbSet transaction aborted"));
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("idbGet failed"));
  });
}

export async function idbRemove(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idbRemove transaction failed"));
  });
}

/** Best-effort feature check — returns true only if IndexedDB can be opened. */
export async function idbAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}
