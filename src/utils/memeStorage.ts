/**
 * IndexedDB storage for User Meme Audio Blobs
 *
 * Persists user-uploaded audio files privately on device without localStorage size limitations.
 */

export interface StoredMeme {
  id: string;
  name: string;
  blob: Blob;
  duration?: number; // duration in seconds
  timestamp: number;
  slotId?: string; // If attached to a specific viral meme slot
}

const DB_NAME = 'vikmix_meme_db';
const STORE_NAME = 'meme_sounds';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function getAllStoredMemes(): Promise<StoredMeme[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        resolve(req.result || []);
      };
      req.onerror = () => {
        reject(req.error);
      };
    });
  } catch (err) {
    console.warn('Failed to load memes from IndexedDB:', err);
    return [];
  }
}

export async function saveMemeToStorage(meme: StoredMeme): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(meme);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to save meme to IndexedDB:', err);
  }
}

export async function deleteMemeFromStorage(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to delete meme from IndexedDB:', err);
  }
}
