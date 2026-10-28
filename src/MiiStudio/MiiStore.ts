
// Imported .glb models are too big for localStorage, so they live in IndexedDB.

const DB_NAME = 'MiiStudio';
const STORE = 'models';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    return openDB().then((db) => new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { resolve(req.result as T); db.close(); };
        tx.onerror = () => { reject(tx.error); db.close(); };
    }));
}

export async function saveModel(data: ArrayBuffer): Promise<string> {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await run('readwrite', (s) => s.put(data, id));
    return id;
}

export async function loadModel(id: string): Promise<ArrayBuffer> {
    const data = await run<ArrayBuffer | undefined>('readonly', (s) => s.get(id));
    if (data === undefined)
        throw new Error(`Modèle 3D introuvable dans ce navigateur.`);
    return data;
}

export function deleteModel(id: string): Promise<void> {
    return run('readwrite', (s) => s.delete(id));
}
