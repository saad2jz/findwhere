import { caseSchema } from './domain.mjs';

const DB = 'findwhere-investigations';
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cases', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('Browser storage is unavailable. Export your report to keep a copy.'));
  });
}
export async function loadCases() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('cases', 'readonly');
      const request = tx.objectStore('cases').getAll();
      request.onsuccess = () =>
        resolve(
          request.result
            .map((value) => caseSchema.safeParse(value))
            .filter((value) => value.success)
            .map((value) => value.data)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveCase(data) {
  const value = caseSchema.parse(data);
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('cases', 'readwrite');
      tx.objectStore('cases').put(value);
      tx.oncomplete = resolve;
      tx.onerror = () =>
        reject(new Error('Could not save this investigation. Export a report to keep your work.'));
      tx.onabort = () =>
        reject(new Error('Browser storage is full or unavailable. Export your report.'));
    });
  } finally {
    db.close();
  }
}
